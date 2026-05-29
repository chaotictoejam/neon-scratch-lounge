import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

export class DataStack extends cdk.Stack {
  public readonly campaignsTable: dynamodb.Table;
  public readonly toolResultsTable: dynamodb.Table;
  public readonly turnResultsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = this.node.tryGetContext("neonScratch") ?? {};
    const campaignTtlDays: number = config.campaignTtlDays ?? 30;

    this.campaignsTable = new dynamodb.Table(this, "CampaignsTable", {
      tableName: "neon-scratch-campaigns",
      partitionKey: { name: "campaignId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.campaignsTable.addGlobalSecondaryIndex({
      indexName: "playerId-index",
      partitionKey: { name: "playerId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "campaignId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.toolResultsTable = new dynamodb.Table(this, "ToolResultsTable", {
      tableName: "neon-scratch-tool-results",
      partitionKey: { name: "idempotencyKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.turnResultsTable = new dynamodb.Table(this, "TurnResultsTable", {
      tableName: "neon-scratch-turn-results",
      partitionKey: { name: "turnId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cdk.CfnOutput(this, "CampaignsTableName", { value: this.campaignsTable.tableName });
    new cdk.CfnOutput(this, "ToolResultsTableName", { value: this.toolResultsTable.tableName });
    new cdk.CfnOutput(this, "CampaignTtlDays", { value: String(campaignTtlDays) });
  }
}
