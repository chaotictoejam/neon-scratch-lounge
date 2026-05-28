#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DataStack } from "../stacks/data-stack";
import { KnowledgeBaseStack } from "../stacks/knowledge-base-stack";
import { WorkflowStack } from "../stacks/workflow-stack";
import { ObservabilityStack } from "../stacks/observability-stack";
import { ApiStack } from "../stacks/api-stack";

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

const apiStack = new ApiStack(app, "NeonScratchApi", {
  env,
  dungeonControllerFunction: workflowStack.dungeonControllerFunction,
  executeToolFunctionName: workflowStack.executeToolFunction.functionName,
});
apiStack.addDependency(workflowStack);

app.synth();
