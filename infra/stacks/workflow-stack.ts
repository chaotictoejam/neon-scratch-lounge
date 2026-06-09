import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
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
  envName?: string;
}

export class WorkflowStack extends cdk.Stack {
  public readonly dungeonControllerFunction: lambda.Function;
  public readonly executeToolFunction: lambda.Function;
  public readonly invokeDmFunction: lambda.Function;
  public readonly stateMachine: sfn.StateMachine;
  public readonly dlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: WorkflowStackProps) {
    super(scope, id, props);

    const envName = props.envName ?? "prod";
    const s = envName === "prod" ? "" : `-${envName}`;

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
      invokeDm: config.invokeDmTimeoutSeconds ?? 90, // agentic loop: multiple Bedrock calls
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
      queueName: `neon-scratch-dungeon-dlq${s}`,
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
      functionName: `neon-scratch-retrieve-lore${s}`,
      entry: path.join(__dirname, "../../lambda/workflow/retrieve-lore.ts"),
      timeout: cdk.Duration.seconds(timeouts.retrieveLore + 5),
      environment: commonEnv,
    });

    // invoke-dungeon-master Lambda
    const invokeDmLogGroup = new logs.LogGroup(this, "DmLogGroup", {
      logGroupName: `/aws/lambda/neon-scratch-invoke-dungeon-master${s}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const invokeDmFn = new lambdaNodejs.NodejsFunction(this, "InvokeDungeonMaster", {
      ...commonLambdaProps,
      functionName: `neon-scratch-invoke-dungeon-master${s}`,
      entry: path.join(__dirname, "../../lambda/workflow/invoke-dungeon-master.ts"),
      timeout: cdk.Duration.seconds(timeouts.invokeDm + 5),
      environment: commonEnv,
      logGroup: invokeDmLogGroup,
    });
    this.invokeDmFunction = invokeDmFn;
    invokeDmFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:*::foundation-model/${bedrockBaseModelId}`,
        `arn:aws:bedrock:${bedrockRegion}:${this.account}:inference-profile/${bedrockModelId}`,
      ],
    }));

    // execute-tool Lambda — kept for demo failure injection (not part of main workflow)
    const executeToolLogGroup = new logs.LogGroup(this, "ExecuteToolLogGroup", {
      logGroupName: `/aws/lambda/neon-scratch-execute-tool${s}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const executeToolFn = new lambdaNodejs.NodejsFunction(this, "ExecuteTool", {
      ...commonLambdaProps,
      functionName: `neon-scratch-execute-tool${s}`,
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
      functionName: `neon-scratch-persist-campaign${s}`,
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
    const formatResponseLogGroup = new logs.LogGroup(this, "FormatResponseLogGroup", {
      logGroupName: `/aws/lambda/neon-scratch-format-response${s}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const formatResponseFn = new lambdaNodejs.NodejsFunction(this, "FormatResponse", {
      ...commonLambdaProps,
      functionName: `neon-scratch-format-response${s}`,
      entry: path.join(__dirname, "../../lambda/workflow/format-response.ts"),
      timeout: cdk.Duration.seconds(10),
      environment: { ...commonEnv, TURN_RESULTS_TABLE: props.turnResultsTable.tableName },
      logGroup: formatResponseLogGroup,
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

    // Grant read access to retrieve-lore; invoke-dm needs full read/write for inline tool execution
    props.campaignsTable.grantReadData(retrieveLoreFn);
    props.campaignsTable.grantReadWriteData(invokeDmFn);
    props.toolResultsTable.grantReadWriteData(invokeDmFn);

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
        "startedAt.$": "$.startedAt",
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
    invokeDmTask.addRetry({
      errors: ["DemoForcedFailure"],
      maxAttempts: retries.maxAttempts,
      interval: cdk.Duration.seconds(retries.intervalSeconds),
      backoffRate: retries.backoffRate,
      jitterStrategy: sfn.JitterType.FULL,
    });
    invokeDmTask.addRetry({
      errors: ["States.Timeout"],
      maxAttempts: 2,
      interval: cdk.Duration.seconds(3),
      backoffRate: 2.0,
      jitterStrategy: sfn.JitterType.FULL,
    });

    // Safe narrative fallback — merges dmOutput into existing state so FormatResponse can run normally
    const safeNarrativeState = new sfn.Pass(this, "ReturnSafeNarrative", {
      parameters: {
        narrative: "The neon flickers and goes dark for a moment. The city holds its breath. Your campaign continues, operative — but the system needs a moment to recover. Try your action again.",
        "characterName.$": "$.campaign.characterName",
        toolCalls: [],
        nextLocation: null,
        questUpdate: null,
        combatOccurred: false,
        enemyDefeated: null,
        combatants: [],
        gameOver: false,
        gameOverReason: null,
        dmInternalNote: "DLQ safe narrative fallback",
      },
      resultPath: "$.dmOutput",
    });

    // Send to DLQ
    const sendToDlqTask = new tasks.SqsSendMessage(this, "SendToDlq", {
      queue: this.dlq,
      messageBody: sfn.TaskInput.fromJsonPathAt("$"),
    });

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

    // DLQ path: send failed state to queue, inject safe narrative, then run FormatResponse normally
    const dlqAndRecover = sendToDlqTask.next(safeNarrativeState).next(formatResponseTask);

    // Write status: "error" to DynamoDB when the workflow fails before format-response
    const writeErrorResult = new tasks.DynamoUpdateItem(this, "WriteErrorResult", {
      table: props.turnResultsTable,
      key: {
        turnId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt("$.correlationId")),
      },
      updateExpression: "SET #s = :s",
      expressionAttributeNames: { "#s": "status" },
      expressionAttributeValues: {
        ":s": tasks.DynamoAttributeValue.fromString("error"),
      },
      resultPath: sfn.JsonPath.DISCARD,
    });
    retrieveLoreTask.addCatch(writeErrorResult, { errors: ["States.ALL"], resultPath: "$.error" });
    invokeDmTask.addCatch(dlqAndRecover, { errors: ["States.ALL"], resultPath: "$.error" });
    persistCampaignTask.addCatch(writeErrorResult, { errors: ["States.ALL"], resultPath: "$.error" });

    // Chain the workflow — invoke-dm now runs the agentic tool-use loop internally
    const definition = retrieveLoreTask
      .next(invokeDmTask)
      .next(persistCampaignTask)
      .next(formatResponseTask);

    // Step Functions Express Workflow
    this.stateMachine = new sfn.StateMachine(this, "DungeonWorkflow", {
      stateMachineName: `neon-scratch-dungeon-workflow${s}`,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      stateMachineType: sfn.StateMachineType.EXPRESS,
      timeout: cdk.Duration.seconds(180),
      tracingEnabled: true,
      logs: {
        destination: new cdk.aws_logs.LogGroup(this, "StateMachineLogs", {
          logGroupName: `/aws/states/neon-scratch-dungeon${s}`,
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
    persistCampaignFn.grantInvoke(this.stateMachine);
    formatResponseFn.grantInvoke(this.stateMachine);
    this.dlq.grantSendMessages(this.stateMachine);
    props.turnResultsTable.grantWriteData(this.stateMachine);

    // Dungeon Controller Lambda — receives player actions, publishes to EventBridge
    const controllerLogGroup = new logs.LogGroup(this, "ControllerLogGroup", {
      logGroupName: `/aws/lambda/neon-scratch-dungeon-controller${s}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.dungeonControllerFunction = new lambdaNodejs.NodejsFunction(this, "DungeonController", {
      ...commonLambdaProps,
      functionName: `neon-scratch-dungeon-controller${s}`,
      entry: path.join(__dirname, "../../lambda/dungeon-controller/index.ts"),
      timeout: cdk.Duration.seconds(10),
      environment: {
        ...commonEnv,
        EVENT_BUS_NAME: `neon-scratch-events${s}`,
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
      eventBusName: `neon-scratch-events${s}`,
    });

    // Grant controller permission to put events
    this.dungeonControllerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["events:PutEvents"],
      resources: [eventBus.eventBusArn],
    }));

    // EventBridge rule — audit only, no target (workflow is started directly by the controller)
    new events.Rule(this, "PlayerActionRule", {
      eventBus,
      ruleName: `neon-scratch-player-action${s}`,
      description: "Captures PlayerAction events for audit trail",
      eventPattern: {
        source: ["neon-scratch-lounge"],
        detailType: ["PlayerAction"],
      },
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
