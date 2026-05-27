#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DataStack } from "../lib/stacks/data-stack";
import { KnowledgeBaseStack } from "../lib/stacks/knowledge-base-stack";
import { WorkflowStack } from "../lib/stacks/workflow-stack";
import { ObservabilityStack } from "../lib/stacks/observability-stack";

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const dataStack = new DataStack(app, "NeonScratchData", { env });

const kbStack = new KnowledgeBaseStack(app, "NeonScratchKnowledgeBase", { env });

const workflowStack = new WorkflowStack(app, "NeonScratchWorkflow", {
  env,
  campaignsTable: dataStack.campaignsTable,
  toolResultsTable: dataStack.toolResultsTable,
  knowledgeBaseId: kbStack.knowledgeBaseId,
  knowledgeBaseArn: kbStack.knowledgeBaseArn,
});
workflowStack.addDependency(dataStack);
workflowStack.addDependency(kbStack);

const obsStack = new ObservabilityStack(app, "NeonScratchObservability", {
  env,
  dungeonControllerFunction: workflowStack.dungeonControllerFunction,
  stateMachine: workflowStack.stateMachine,
  dlq: workflowStack.dlq,
});
obsStack.addDependency(workflowStack);

app.synth();
