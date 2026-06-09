#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DataStack } from "../stacks/data-stack";
import { KnowledgeBaseStack } from "../stacks/knowledge-base-stack";
import { WorkflowStack } from "../stacks/workflow-stack";
import { ObservabilityStack } from "../stacks/observability-stack";
import { ApiStack } from "../stacks/api-stack";

const app = new cdk.App();

// Pass -c envName=dev to deploy a dev environment alongside prod.
// Prod (default) keeps existing resource names unchanged.
const envName: string = app.node.tryGetContext("envName") ?? "prod";
const stackSuffix = envName === "prod" ? "" : `-${envName.charAt(0).toUpperCase()}${envName.slice(1)}`;

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

const dataStack = new DataStack(app, `NeonScratchData${stackSuffix}`, { env, envName });

const kbStack = new KnowledgeBaseStack(app, `NeonScratchKnowledgeBase${stackSuffix}`, { env, envName });

const workflowStack = new WorkflowStack(app, `NeonScratchWorkflow${stackSuffix}`, {
  env,
  envName,
  campaignsTable: dataStack.campaignsTable,
  toolResultsTable: dataStack.toolResultsTable,
  turnResultsTable: dataStack.turnResultsTable,
  knowledgeBaseId: kbStack.knowledgeBaseId || undefined,
});
workflowStack.addDependency(dataStack);
workflowStack.addDependency(kbStack);

const obsStack = new ObservabilityStack(app, `NeonScratchObservability${stackSuffix}`, {
  env,
  envName,
  dungeonControllerFunction: workflowStack.dungeonControllerFunction,
  invokeDmFunctionName: workflowStack.invokeDmFunction.functionName,
  stateMachine: workflowStack.stateMachine,
  dlq: workflowStack.dlq,
});
obsStack.addDependency(workflowStack);

const apiStack = new ApiStack(app, `NeonScratchApi${stackSuffix}`, {
  env,
  envName,
  dungeonControllerFunction: workflowStack.dungeonControllerFunction,
  invokeDmFunctionName: workflowStack.invokeDmFunction.functionName,
  turnResultsTable: dataStack.turnResultsTable,
});
apiStack.addDependency(workflowStack);

app.synth();
