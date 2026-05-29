import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import * as path from "path";

export interface WorkflowStackProps extends cdk.StackProps {
  campaignsTable: dynamodb.Table;
  toolResultsTable: dynamodb.Table;
  turnResultsTable: dynamodb.Table;
  knowledgeBaseId?: string;
}

export class WorkflowStack extends cdk.Stack {
  public readonly dungeonControllerFunction: lambda.Function;
  public readonly executeToolFunction: lambda.Function;
  public readonly stateMachine: sfn.StateMachine;
  public readonly dlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: WorkflowStackProps) {
    super(scope, id, props);

    const config = this.node.tryGetContext("neonScratch") ?? {};
    const bedrockRegion: string = config.bedrockRegion ?? "us-east-1";
    const bedrockModelId: string = config.bedrockModelId ?? "us.anthropic.claude-sonnet-4-20250514-v1:0";
    // Strip cross-region prefix to get the base foundation-model ID for IAM resource ARNs
    const bedrockBaseModelId: string = bedrockModelId.replace(/^(us|eu|ap)\./, "");
    const toolResultTtlSeconds: number = config.toolResultTtlSeconds ?? 3600;
    const maxConversationHistory: number = config.maxConversationHistory ?? 20;
    const xpPerLevel: number = config.xpPerLevel ?? 100;
    const historyTrimCount: number = config.historyTrimCount ?? 5;
    const campaignTtlDays: number = config.campaignTtlDays ?? 30;

    const timeouts = {
      retrieveLore: config.retrieveLoreTimeoutSeconds ?? 10,
      invokeDm: config.invokeDmTimeoutSeconds ?? 30,
      validateRoute: config.validateRouteTimeoutSeconds ?? 5,
      executeTool: config.executeToolTimeoutSeconds ?? 15,
      persistCampaign: config.persistCampaignTimeoutSeconds ?? 10,
    };

    const retries = {
      maxAttempts: config.retryMaxAttempts ?? 3,
      intervalSeconds: config.retryIntervalSeconds ?? 2,
      backoffRate: config.retryBackoffRate ?? 2,
    };

    // Dead Letter Queue
    this.dlq = new sqs.Queue(this, "DungeonDlq", {
      queueName: "neon-scratch-dungeon-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    // Common Lambda environment
    const commonEnv: Record<string, string> = {
      CAMPAIGNS_TABLE: props.campaignsTable.tableName,
      TOOL_RESULTS_TABLE: props.toolResultsTable.tableName,
      TOOL_RESULT_TTL_SECONDS: String(toolResultTtlSeconds),

      BEDROCK_REGION: bedrockRegion,
      BEDROCK_MODEL_ID: bedrockModelId,
      MAX_CONVERSATION_HISTORY: String(maxConversationHistory),
      XP_PER_LEVEL: String(xpPerLevel),
      HISTORY_TRIM_COUNT: String(historyTrimCount),
      CAMPAIGN_TTL_DAYS: String(campaignTtlDays),
      ...(props.knowledgeBaseId ? { KNOWLEDGE_BASE_ID: props.knowledgeBaseId } : {}),
    };

    const commonLambdaProps: Partial<lambdaNodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_LATEST,
      memorySize: 512,
      tracing: lambda.Tracing.ACTIVE,

      bundling: {
        externalModules: [],
        minify: false,
        sourceMap: true,
        forceDockerBundling: false,
      },
    };

    // retrieve-lore Lambda
    const retrieveLoreFn = new lambdaNodejs.NodejsFunction(this, "RetrieveLore", {
      ...commonLambdaProps,
      functionName: "neon-scratch-retrieve-lore",
      entry: path.join(__dirname, "../../lambda/workflow/retrieve-lore.ts"),
      timeout: cdk.Duration.seconds(timeouts.retrieveLore + 5),
      environment: commonEnv,
    });

    // invoke-dungeon-master Lambda
    const invokeDmLogGroup = new logs.LogGroup(this, "DmLogGroup", {
      logGroupName: "/aws/lambda/neon-scratch-invoke-dungeon-master",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const invokeDmFn = new lambdaNodejs.NodejsFunction(this, "InvokeDungeonMaster", {
      ...commonLambdaProps,
      functionName: "neon-scratch-invoke-dungeon-master",
      entry: path.join(__dirname, "../../lambda/workflow/invoke-dungeon-master.ts"),
      timeout: cdk.Duration.seconds(timeouts.invokeDm + 5),
      environment: commonEnv,
      logGroup: invokeDmLogGroup,
    });
    invokeDmFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:*::foundation-model/${bedrockBaseModelId}`,
        `arn:aws:bedrock:${bedrockRegion}:${this.account}:inference-profile/${bedrockModelId}`,
      ],
    }));

    // validate-and-route Lambda
    const validateRouteFn = new lambdaNodejs.NodejsFunction(this, "ValidateAndRoute", {
      ...commonLambdaProps,
      functionName: "neon-scratch-validate-and-route",
      entry: path.join(__dirname, "../../lambda/workflow/validate-and-route.ts"),
      timeout: cdk.Duration.seconds(timeouts.validateRoute + 5),
      environment: commonEnv,
    });

    // execute-tool Lambda (also exposed as public for demo failure injection)
    const executeToolLogGroup = new logs.LogGroup(this, "ExecuteToolLogGroup", {
      logGroupName: "/aws/lambda/neon-scratch-execute-tool",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const executeToolFn = new lambdaNodejs.NodejsFunction(this, "ExecuteTool", {
      ...commonLambdaProps,
      functionName: "neon-scratch-execute-tool",
      entry: path.join(__dirname, "../../lambda/workflow/execute-tool.ts"),
      timeout: cdk.Duration.seconds(timeouts.executeTool + 5),
      environment: commonEnv,
      logGroup: executeToolLogGroup,
    });
    props.campaignsTable.grantReadWriteData(executeToolFn);
    props.toolResultsTable.grantReadWriteData(executeToolFn);
    this.executeToolFunction = executeToolFn;

    // persist-campaign Lambda
    const persistCampaignFn = new lambdaNodejs.NodejsFunction(this, "PersistCampaign", {
      ...commonLambdaProps,
      functionName: "neon-scratch-persist-campaign",
      entry: path.join(__dirname, "../../lambda/workflow/persist-campaign.ts"),
      timeout: cdk.Duration.seconds(timeouts.persistCampaign + 5),
      environment: commonEnv,
    });
    props.campaignsTable.grantReadWriteData(persistCampaignFn);
    persistCampaignFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:*::foundation-model/${bedrockBaseModelId}`,
        `arn:aws:bedrock:${bedrockRegion}:${this.account}:inference-profile/${bedrockModelId}`,
      ],
    }));

    // format-response Lambda
    const formatResponseFn = new lambdaNodejs.NodejsFunction(this, "FormatResponse", {
      ...commonLambdaProps,
      functionName: "neon-scratch-format-response",
      entry: path.join(__dirname, "../../lambda/workflow/format-response.ts"),
      timeout: cdk.Duration.seconds(10),
      environment: { ...commonEnv, TURN_RESULTS_TABLE: props.turnResultsTable.tableName },
    });
    props.turnResultsTable.grantWriteData(formatResponseFn);

    // Bedrock Knowledge Base retrieve permission (only when KB mode is enabled)
    if (props.knowledgeBaseId) {
      retrieveLoreFn.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:Retrieve"],
        resources: [`arn:aws:bedrock:${bedrockRegion}:*:knowledge-base/${props.knowledgeBaseId}`],
      }));
    }

    // Grant read access to retrieve-lore and invoke-dm (read campaigns for context)
    props.campaignsTable.grantReadData(retrieveLoreFn);
    props.campaignsTable.grantReadData(invokeDmFn);
    props.campaignsTable.grantReadData(validateRouteFn);

    // Step Functions state definitions
    const retrieveLoreTask = new tasks.LambdaInvoke(this, "RetrieveLoreTask", {
      lambdaFunction: retrieveLoreFn,
      outputPath: "$.Payload",
      retryOnServiceExceptions: false,
      taskTimeout: sfn.Timeout.duration(cdk.Duration.seconds(timeouts.retrieveLore)),
    });

    const invokeDmTask = new tasks.LambdaInvoke(this, "InvokeDungeonMasterTask", {
      lambdaFunction: invokeDmFn,
      // Inject SFN retry context alongside the existing workflow state
      payload: sfn.TaskInput.fromObject({
        "retryCount.$": "$$.State.RetryCount",
        "campaignId.$": "$.campaignId",
        "playerId.$": "$.playerId",
        "action.$": "$.action",
        "campaign.$": "$.campaign",
        "correlationId.$": "$.correlationId",
        "loreChunks.$": "$.loreChunks",
      }),
      outputPath: "$.Payload",
      retryOnServiceExceptions: false,
      taskTimeout: sfn.Timeout.duration(cdk.Duration.seconds(timeouts.invokeDm)),
    });
    invokeDmTask.addRetry({
      errors: ["DMOutputValidationError"],
      maxAttempts: retries.maxAttempts,
      interval: cdk.Duration.seconds(retries.intervalSeconds),
      backoffRate: retries.backoffRate,
      jitterStrategy: sfn.JitterType.FULL,
    });

    const validateRouteTask = new tasks.LambdaInvoke(this, "ValidateAndRouteTask", {
      lambdaFunction: validateRouteFn,
      outputPath: "$.Payload",
      retryOnServiceExceptions: false,
      taskTimeout: sfn.Timeout.duration(cdk.Duration.seconds(timeouts.validateRoute)),
    });

    // Safe narrative fallback state for DLQ catch
    const safeNarrativeState = new sfn.Pass(this, "ReturnSafeNarrative", {
      result: sfn.Result.fromObject({
        narrative:
          "The neon flickers and goes dark for a moment. The city holds its breath. Your campaign continues, operative — but the system needs a moment to recover. Try your action again.",
        gameOver: false,
        gameOverReason: null,
        error: true,
      }),
    });

    // Send to DLQ
    const sendToDlqTask = new tasks.SqsSendMessage(this, "SendToDlq", {
      queue: this.dlq,
      messageBody: sfn.TaskInput.fromJsonPathAt("$"),
    });

    const dlqAndRecover = sendToDlqTask.next(safeNarrativeState);

    // Execute tools as a Map state iterating over validated tool calls
    const executeToolTask = new tasks.LambdaInvoke(this, "ExecuteToolTask", {
      lambdaFunction: executeToolFn,
      outputPath: "$.Payload",
      retryOnServiceExceptions: false,
      taskTimeout: sfn.Timeout.duration(cdk.Duration.seconds(timeouts.executeTool)),
    });
    executeToolTask.addRetry({
      errors: ["States.TaskFailed", "States.Timeout"],
      maxAttempts: retries.maxAttempts,
      interval: cdk.Duration.seconds(retries.intervalSeconds),
      backoffRate: retries.backoffRate,
      jitterStrategy: sfn.JitterType.FULL,
    });
    executeToolTask.addCatch(dlqAndRecover, {
      errors: ["States.ALL"],
      resultPath: "$.error",
    });

    const executeToolsMap = new sfn.Map(this, "ExecuteToolsMap", {
      itemsPath: "$.validatedToolCalls",
      resultPath: "$.toolResults",
      maxConcurrency: 1,
    });
    executeToolsMap.itemProcessor(executeToolTask);

    const persistCampaignTask = new tasks.LambdaInvoke(this, "PersistCampaignTask", {
      lambdaFunction: persistCampaignFn,
      outputPath: "$.Payload",
      retryOnServiceExceptions: false,
      taskTimeout: sfn.Timeout.duration(cdk.Duration.seconds(timeouts.persistCampaign)),
    });

    const formatResponseTask = new tasks.LambdaInvoke(this, "FormatResponseTask", {
      lambdaFunction: formatResponseFn,
      outputPath: "$.Payload",
      retryOnServiceExceptions: false,
    });

    // Chain the workflow
    const definition = retrieveLoreTask
      .next(invokeDmTask)
      .next(validateRouteTask)
      .next(executeToolsMap)
      .next(persistCampaignTask)
      .next(formatResponseTask);

    // Step Functions Express Workflow
    this.stateMachine = new sfn.StateMachine(this, "DungeonWorkflow", {
      stateMachineName: "neon-scratch-dungeon-workflow",
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineType: sfn.StateMachineType.EXPRESS,
      timeout: cdk.Duration.seconds(120),
      tracingEnabled: true,
      logs: {
        destination: new cdk.aws_logs.LogGroup(this, "StateMachineLogs", {
          logGroupName: "/aws/states/neon-scratch-dungeon",
          retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    // Grant state machine permissions
    retrieveLoreFn.grantInvoke(this.stateMachine);
    invokeDmFn.grantInvoke(this.stateMachine);
    validateRouteFn.grantInvoke(this.stateMachine);
    executeToolFn.grantInvoke(this.stateMachine);
    persistCampaignFn.grantInvoke(this.stateMachine);
    formatResponseFn.grantInvoke(this.stateMachine);
    this.dlq.grantSendMessages(this.stateMachine);

    // Dungeon Controller Lambda — receives player actions, publishes to EventBridge
    const controllerLogGroup = new logs.LogGroup(this, "ControllerLogGroup", {
      logGroupName: "/aws/lambda/neon-scratch-dungeon-controller",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.dungeonControllerFunction = new lambdaNodejs.NodejsFunction(this, "DungeonController", {
      ...commonLambdaProps,
      functionName: "neon-scratch-dungeon-controller",
      entry: path.join(__dirname, "../../lambda/dungeon-controller/index.ts"),
      timeout: cdk.Duration.seconds(10),
      environment: {
        ...commonEnv,
        EVENT_BUS_NAME: "neon-scratch-events",
        STATE_MACHINE_ARN: this.stateMachine.stateMachineArn,
        TURN_RESULTS_TABLE: props.turnResultsTable.tableName,
      },
      logGroup: controllerLogGroup,
    });
    props.campaignsTable.grantReadWriteData(this.dungeonControllerFunction);
    props.turnResultsTable.grantReadWriteData(this.dungeonControllerFunction);
    this.stateMachine.grantStartExecution(this.dungeonControllerFunction);

    // EventBridge custom bus
    const eventBus = new events.EventBus(this, "NeonScratchEventBus", {
      eventBusName: "neon-scratch-events",
    });

    // Grant controller permission to put events
    this.dungeonControllerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["events:PutEvents"],
      resources: [eventBus.eventBusArn],
    }));

    // EventBridge rule — PlayerAction → start Step Functions execution
    const sfnRole = new iam.Role(this, "EventBridgeSfnRole", {
      assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
      inlinePolicies: {
        StartExecution: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["states:StartExecution"],
              resources: [this.stateMachine.stateMachineArn],
            }),
          ],
        }),
      },
    });

    new events.Rule(this, "PlayerActionRule", {
      eventBus,
      ruleName: "neon-scratch-player-action",
      description: "Routes PlayerAction events to the dungeon workflow",
      eventPattern: {
        source: ["neon-scratch-lounge"],
        detailType: ["PlayerAction"],
      },
      targets: [
        new eventTargets.SfnStateMachine(this.stateMachine, {
          role: sfnRole,
          input: events.RuleTargetInput.fromEventPath("$.detail"),
        }),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, "DungeonControllerArn", {
      value: this.dungeonControllerFunction.functionArn,
    });
    new cdk.CfnOutput(this, "StateMachineArn", {
      value: this.stateMachine.stateMachineArn,
    });
    new cdk.CfnOutput(this, "DlqUrl", { value: this.dlq.queueUrl });
    new cdk.CfnOutput(this, "EventBusArn", { value: eventBus.eventBusArn });
  }
}
