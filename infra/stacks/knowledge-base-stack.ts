import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

/**
 * Lore is now bundled directly into the retrieve-lore Lambda (16KB of JSON),
 * so there is no OpenSearch Serverless collection or Bedrock Knowledge Base.
 *
 * This stub exists so bin/app.ts and WorkflowStack keep the same interface.
 * knowledgeBaseId / knowledgeBaseArn are empty strings — retrieve-lore no
 * longer reads these env vars.
 */
export class KnowledgeBaseStack extends cdk.Stack {
  public readonly knowledgeBaseId: string = "";
  public readonly knowledgeBaseArn: string = "";

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    new cdk.CfnOutput(this, "LoreStrategy", {
      value: "bundled-json",
      description: "Lore retrieval strategy — JSON bundled into Lambda, no AOSS required",
    });
  }
}
