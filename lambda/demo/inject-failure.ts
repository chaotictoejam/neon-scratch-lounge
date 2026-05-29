/**
 * DEMO-ONLY — remove before any production use.
 *
 * Sets/clears FORCE_TOOL_FAILURE env var on the execute-tool Lambda
 * to trigger the Step Functions retry animation in the UI.
 */
import { LambdaClient, GetFunctionConfigurationCommand, UpdateFunctionConfigurationCommand } from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({});
const EXECUTE_TOOL_FN = process.env.EXECUTE_TOOL_FUNCTION_NAME!;

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

export const injectHandler = async (): Promise<{ statusCode: number; headers: typeof HEADERS; body: string }> => {
  const config = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: EXECUTE_TOOL_FN }));
  const env = config.Environment?.Variables ?? {};
  await lambda.send(new UpdateFunctionConfigurationCommand({
    FunctionName: EXECUTE_TOOL_FN,
    Environment: { Variables: { ...env, FORCE_TOOL_FAILURE: "true" } },
  }));
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ injected: true }) };
};

export const clearHandler = async (): Promise<{ statusCode: number; headers: typeof HEADERS; body: string }> => {
  const config = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: EXECUTE_TOOL_FN }));
  const env = { ...(config.Environment?.Variables ?? {}) };
  delete env.FORCE_TOOL_FAILURE;
  await lambda.send(new UpdateFunctionConfigurationCommand({
    FunctionName: EXECUTE_TOOL_FN,
    Environment: { Variables: env },
  }));
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ cleared: true }) };
};
