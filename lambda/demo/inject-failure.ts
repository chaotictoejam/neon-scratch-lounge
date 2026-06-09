/**
 * DEMO-ONLY — remove before any production use.
 *
 * Sets/clears FORCE_TOOL_FAILURE env var on the invoke-dungeon-master Lambda
 * to trigger the Step Functions retry animation in the UI.
 *
 * clearHandler polls until the function returns to Active state so callers
 * know the next invocation will see the cleared env var.
 */
import {
  LambdaClient,
  GetFunctionConfigurationCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";

const lambda = new LambdaClient({});
const INVOKE_DM_FN = process.env.INVOKE_DM_FUNCTION_NAME!;

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

async function waitForActive(maxWaitMs = 20000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800));
    const cfg = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: INVOKE_DM_FN }));
    if (cfg.State === "Active") return;
  }
}

export const injectHandler = async (): Promise<{ statusCode: number; headers: typeof HEADERS; body: string }> => {
  const config = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: INVOKE_DM_FN }));
  const env = config.Environment?.Variables ?? {};
  await lambda.send(new UpdateFunctionConfigurationCommand({
    FunctionName: INVOKE_DM_FN,
    Environment: { Variables: { ...env, FORCE_TOOL_FAILURE: "true" } },
  }));
  await waitForActive();
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ injected: true }) };
};

export const clearHandler = async (): Promise<{ statusCode: number; headers: typeof HEADERS; body: string }> => {
  const config = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: INVOKE_DM_FN }));
  const env = { ...(config.Environment?.Variables ?? {}) };
  delete env.FORCE_TOOL_FAILURE;
  await lambda.send(new UpdateFunctionConfigurationCommand({
    FunctionName: INVOKE_DM_FN,
    Environment: { Variables: env },
  }));
  await waitForActive();
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ cleared: true }) };
};
