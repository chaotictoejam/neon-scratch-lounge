import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface ObservabilityStackProps extends cdk.StackProps {
  dungeonControllerFunction: lambda.Function;
  invokeDmFunctionName: string;
  stateMachine: sfn.StateMachine;
  dlq: sqs.Queue;
  envName?: string;
}

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const envName = props.envName ?? "prod";
    const s = envName === "prod" ? "" : `-${envName}`;
    const ns = `NeonScratch${envName === "prod" ? "" : envName.charAt(0).toUpperCase() + envName.slice(1)}`;

    // SNS topic for alerts
    const alertTopic = new sns.Topic(this, "NeonScratchAlerts", {
      topicName: `NeonScratchAlerts${s}`,
      displayName: "Neon Scratch Lounge Alerts",
    });

    // Log groups are owned by WorkflowStack (defined alongside their Lambda functions).
    // Reference them here by name — WorkflowStack deploys first via addDependency.
    const controllerLogGroup = logs.LogGroup.fromLogGroupName(
      this, "ControllerLogGroup",
      `/aws/lambda/${props.dungeonControllerFunction.functionName}`,
    );
    const dmLogGroup = logs.LogGroup.fromLogGroupName(
      this, "DmLogGroup",
      `/aws/lambda/${props.invokeDmFunctionName}`,
    );
    const formatResponseLogGroup = logs.LogGroup.fromLogGroupName(
      this, "FormatResponseLogGroup",
      `/aws/lambda/neon-scratch-format-response${s}`,
    );

    // Metric filters
    new logs.MetricFilter(this, "ActiveCampaignsFilter", {
      logGroup: controllerLogGroup,
      metricNamespace: ns,
      metricName: "PlayerActionReceived",
      filterPattern: logs.FilterPattern.exists("$.campaignId"),
      metricValue: "1",
    });

    new logs.MetricFilter(this, "ControllerLatencyFilter", {
      logGroup: formatResponseLogGroup,
      metricNamespace: ns,
      metricName: "ControllerLatencyMs",
      filterPattern: logs.FilterPattern.exists("$.latencyMs"),
      metricValue: "$.latencyMs",
    });

    // Dice rolls now happen inside invoke-dungeon-master (agentic loop)
    new logs.MetricFilter(this, "DiceRollFilter", {
      logGroup: dmLogGroup,
      metricNamespace: ns,
      metricName: "DiceRollTotal",
      filterPattern: logs.FilterPattern.literal('{ $.toolName = "roll-dice" }'),
      metricValue: "$.total",
    });

    new logs.MetricFilter(this, "MonstersDefeatedFilter", {
      logGroup: dmLogGroup,
      metricNamespace: ns,
      metricName: "MonstersDefeated",
      filterPattern: logs.FilterPattern.exists("$.enemyDefeated"),
      metricValue: "1",
    });

    new logs.MetricFilter(this, "TokenUsageFilter", {
      logGroup: dmLogGroup,
      metricNamespace: ns,
      metricName: "BedrockInputTokens",
      filterPattern: logs.FilterPattern.exists("$.inputTokens"),
      metricValue: "$.inputTokens",
    });

    new logs.MetricFilter(this, "DmLatencyFilter", {
      logGroup: dmLogGroup,
      metricNamespace: ns,
      metricName: "DmLatencyMs",
      filterPattern: logs.FilterPattern.exists("$.latencyMs"),
      metricValue: "$.latencyMs",
    });

    // CloudWatch dashboard
    const dashboard = new cloudwatch.Dashboard(this, "NeonScratchDashboard", {
      dashboardName: `NeonScratchLounge${s}`,
      defaultInterval: cdk.Duration.hours(1),
    });

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `# The Neon Scratch Lounge — ${envName === "prod" ? "Production" : envName.toUpperCase()} Dashboard\n*Neo-Pawsburg 2087 | Powered by AWS*`,
        width: 24,
        height: 2,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: "Active Campaigns (Last Hour)",
        metrics: [
          new cloudwatch.Metric({
            namespace: ns,
            metricName: "PlayerActionReceived",
            statistic: "Sum",
            period: cdk.Duration.hours(1),
            label: "Player Actions",
          }),
        ],
        width: 8,
        height: 4,
      }),
      new cloudwatch.SingleValueWidget({
        title: "Monsters Defeated (Last Hour)",
        metrics: [
          new cloudwatch.Metric({
            namespace: ns,
            metricName: "MonstersDefeated",
            statistic: "Sum",
            period: cdk.Duration.hours(1),
            label: "Monsters",
          }),
        ],
        width: 8,
        height: 4,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "p99 Controller Latency (target: <10s)",
        left: [
          new cloudwatch.Metric({
            namespace: ns,
            metricName: "ControllerLatencyMs",
            statistic: "p99",
            period: cdk.Duration.minutes(5),
            label: "p99 Latency (ms)",
          }),
        ],
        leftAnnotations: [{ value: 10000, color: "#ff0000", label: "10s SLO" }],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: "p99 DM Invocation Latency (target: <28s)",
        left: [
          new cloudwatch.Metric({
            namespace: ns,
            metricName: "DmLatencyMs",
            statistic: "p99",
            period: cdk.Duration.minutes(5),
            label: "p99 DM Latency (ms)",
          }),
        ],
        leftAnnotations: [{ value: 28000, color: "#ff0000", label: "28s alarm threshold" }],
        width: 12,
        height: 6,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Bedrock Token Usage Per Turn",
        left: [
          new cloudwatch.Metric({
            namespace: ns,
            metricName: "BedrockInputTokens",
            statistic: "Average",
            period: cdk.Duration.minutes(5),
            label: "Avg Input Tokens",
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: "Dice Roll Distribution (d20 totals — verify fairness)",
        left: [
          new cloudwatch.Metric({
            namespace: ns,
            metricName: "DiceRollTotal",
            statistic: "Average",
            period: cdk.Duration.minutes(5),
            label: "Avg Roll",
          }),
          new cloudwatch.Metric({
            namespace: ns,
            metricName: "DiceRollTotal",
            statistic: "Minimum",
            period: cdk.Duration.minutes(5),
            label: "Min Roll",
          }),
          new cloudwatch.Metric({
            namespace: ns,
            metricName: "DiceRollTotal",
            statistic: "Maximum",
            period: cdk.Duration.minutes(5),
            label: "Max Roll",
          }),
        ],
        width: 12,
        height: 6,
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Workflow Executions",
        left: [
          new cloudwatch.Metric({
            namespace: "AWS/States",
            metricName: "ExecutionsSucceeded",
            dimensionsMap: { StateMachineArn: props.stateMachine.stateMachineArn },
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
            label: "Succeeded",
            color: cloudwatch.Color.GREEN,
          }),
          new cloudwatch.Metric({
            namespace: "AWS/States",
            metricName: "ExecutionsFailed",
            dimensionsMap: { StateMachineArn: props.stateMachine.stateMachineArn },
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
            label: "Failed",
            color: cloudwatch.Color.RED,
          }),
          new cloudwatch.Metric({
            namespace: "AWS/States",
            metricName: "ExecutionsTimedOut",
            dimensionsMap: { StateMachineArn: props.stateMachine.stateMachineArn },
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
            label: "Timed Out",
            color: cloudwatch.Color.ORANGE,
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: "Monsters Defeated Per Hour",
        left: [
          new cloudwatch.Metric({
            namespace: ns,
            metricName: "MonstersDefeated",
            statistic: "Sum",
            period: cdk.Duration.hours(1),
            label: "Monsters Defeated",
            color: cloudwatch.Color.PURPLE,
          }),
        ],
        width: 12,
        height: 6,
      })
    );

    // Alarms
    const controllerP99Alarm = new cloudwatch.Alarm(this, "ControllerLatencyAlarm", {
      alarmName: `NeonScratch${s}-ControllerP99LatencyHigh`,
      alarmDescription: "p99 dungeon-controller latency exceeded 10s",
      metric: new cloudwatch.Metric({
        namespace: ns,
        metricName: "ControllerLatencyMs",
        statistic: "p99",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10000,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    controllerP99Alarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    const dmP99Alarm = new cloudwatch.Alarm(this, "DmLatencyAlarm", {
      alarmName: `NeonScratch${s}-DmP99LatencyHigh`,
      alarmDescription: "p99 invoke-dungeon-master latency exceeded 28s",
      metric: new cloudwatch.Metric({
        namespace: ns,
        metricName: "DmLatencyMs",
        statistic: "p99",
        period: cdk.Duration.minutes(5),
      }),
      threshold: 28000,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dmP99Alarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    const dlqDepthAlarm = new cloudwatch.Alarm(this, "DlqDepthAlarm", {
      alarmName: `NeonScratch${s}-DlqDepthAboveZero`,
      alarmDescription: "DLQ has messages — tool execution failed after all retries",
      metric: new cloudwatch.Metric({
        namespace: "AWS/SQS",
        metricName: "ApproximateNumberOfMessagesVisible",
        dimensionsMap: { QueueName: props.dlq.queueName },
        statistic: "Maximum",
        period: cdk.Duration.minutes(1),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqDepthAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    const errorRateAlarm = new cloudwatch.Alarm(this, "ErrorRateAlarm", {
      alarmName: `NeonScratch${s}-HighErrorRate`,
      alarmDescription: "Step Functions failure rate exceeded 10% over 5 minutes",
      metric: new cloudwatch.MathExpression({
        expression: "failures / (successes + failures) * 100",
        usingMetrics: {
          failures: new cloudwatch.Metric({
            namespace: "AWS/States",
            metricName: "ExecutionsFailed",
            dimensionsMap: { StateMachineArn: props.stateMachine.stateMachineArn },
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
          }),
          successes: new cloudwatch.Metric({
            namespace: "AWS/States",
            metricName: "ExecutionsSucceeded",
            dimensionsMap: { StateMachineArn: props.stateMachine.stateMachineArn },
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
          }),
        },
        period: cdk.Duration.minutes(5),
        label: "Error Rate %",
      }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    errorRateAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));

    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: "Active Alarms",
        alarms: [controllerP99Alarm, dmP99Alarm, dlqDepthAlarm, errorRateAlarm],
        width: 24,
        height: 4,
      })
    );

    new cdk.CfnOutput(this, "DashboardUrl", {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=NeonScratchLounge${s}`,
      description: "CloudWatch dashboard URL",
    });
    new cdk.CfnOutput(this, "AlertTopicArn", { value: alertTopic.topicArn });
  }
}
