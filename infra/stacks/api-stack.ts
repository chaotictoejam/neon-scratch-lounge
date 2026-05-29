import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";
import * as path from "path";

export interface ApiStackProps extends cdk.StackProps {
  dungeonControllerFunction: lambda.Function;
  executeToolFunctionName: string;
}

export class ApiStack extends cdk.Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const demoBundling: lambdaNodejs.BundlingOptions = {
      forceDockerBundling: false,
    };

    // DEMO-ONLY Lambdas — inject / clear failure on execute-tool
    // Remove these before any production deployment.
    const injectFailureFn = new lambdaNodejs.NodejsFunction(this, "InjectFailure", {
      functionName: "neon-scratch-demo-inject-failure",
      entry: path.join(__dirname, "../../lambda/demo/inject-failure.ts"),
      handler: "injectHandler",
      runtime: lambda.Runtime.NODEJS_LATEST,
      timeout: cdk.Duration.seconds(30),
      bundling: demoBundling,
      environment: {
        EXECUTE_TOOL_FUNCTION_NAME: props.executeToolFunctionName,
      },
    });
    injectFailureFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["lambda:GetFunctionConfiguration", "lambda:UpdateFunctionConfiguration"],
      resources: [
        `arn:aws:lambda:${this.region}:${this.account}:function:${props.executeToolFunctionName}`,
      ],
    }));

    const fetchLogsFn = new lambdaNodejs.NodejsFunction(this, "FetchLogs", {
      functionName: "neon-scratch-demo-fetch-logs",
      entry: path.join(__dirname, "../../lambda/demo/fetch-logs.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_LATEST,
      timeout: cdk.Duration.seconds(15),
      bundling: demoBundling,
    });
    fetchLogsFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["logs:StartQuery", "logs:GetQueryResults"],
      resources: ["*"],
    }));

    const clearFailureFn = new lambdaNodejs.NodejsFunction(this, "ClearFailure", {
      functionName: "neon-scratch-demo-clear-failure",
      entry: path.join(__dirname, "../../lambda/demo/inject-failure.ts"),
      handler: "clearHandler",
      runtime: lambda.Runtime.NODEJS_LATEST,
      timeout: cdk.Duration.seconds(30),
      bundling: demoBundling,
      environment: {
        EXECUTE_TOOL_FUNCTION_NAME: props.executeToolFunctionName,
      },
    });
    clearFailureFn.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["lambda:GetFunctionConfiguration", "lambda:UpdateFunctionConfiguration"],
      resources: [
        `arn:aws:lambda:${this.region}:${this.account}:function:${props.executeToolFunctionName}`,
      ],
    }));

    const api = new apigw.RestApi(this, "NeonScratchApi", {
      restApiName: "neon-scratch-api",
      description: "The Neon Scratch Lounge — API Gateway",
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 10,
        throttlingBurstLimit: 20,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    // POST /action
    const actionResource = api.root.addResource("action");
    actionResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(props.dungeonControllerFunction, {
        proxy: true,
        timeout: cdk.Duration.seconds(29),
      }),
      { apiKeyRequired: false }
    );

    // POST /demo/inject-failure  (DEMO-ONLY)
    const demoResource = api.root.addResource("demo");
    const injectResource = demoResource.addResource("inject-failure");
    injectResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(injectFailureFn, { proxy: true, timeout: cdk.Duration.seconds(29) })
    );

    const clearResource = demoResource.addResource("clear-failure");
    clearResource.addMethod(
      "POST",
      new apigw.LambdaIntegration(clearFailureFn, { proxy: true, timeout: cdk.Duration.seconds(29) })
    );

    const logsResource = demoResource.addResource("logs");
    logsResource.addMethod(
      "GET",
      new apigw.LambdaIntegration(fetchLogsFn, { proxy: true })
    );

    this.apiUrl = api.url;

    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "API Gateway URL — set as VITE_API_GATEWAY_URL in ui/.env.local",
    });
  }
}
