import { LambdaClient, InvokeCommand, UpdateFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const REGION = process.env.AWS_REGION ?? "us-east-1";
const PLAYER_ID = process.env.DEMO_PLAYER_ID ?? "demo-player-001";
const STATE_FILE = path.join(__dirname, ".demo-state.json");

const lambda = new LambdaClient({ region: REGION });
const cwl = new CloudWatchLogsClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

interface DemoState {
  campaignId?: string;
  characterName?: string;
  characterClass?: string;
}

function loadState(): DemoState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: DemoState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Terminal colors
const C = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
};

function neon(text: string): string {
  return `${C.cyan}${C.bright}${text}${C.reset}`;
}

function header(): void {
  console.log(`\n${C.magenta}${C.bright}┌─────────────────────────────────────────────────────────────┐${C.reset}`);
  console.log(`${C.magenta}${C.bright}│          THE NEON SCRATCH LOUNGE  ///  Neo-Pawsburg 2087      │${C.reset}`);
  console.log(`${C.magenta}${C.bright}└─────────────────────────────────────────────────────────────┘${C.reset}\n`);
}

async function typewriter(text: string, delayMs = 20): Promise<void> {
  for (const char of text) {
    process.stdout.write(char);
    await sleep(delayMs);
  }
  process.stdout.write("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHud(response: Record<string, unknown>): void {
  const stats = response.playerStats as Record<string, number>;
  const name = response.characterName as string;
  const cls = response.characterClass as string;
  const loc = response.location as string;
  const hpColor = stats.hp > stats.maxHp * 0.5 ? C.green : stats.hp > stats.maxHp * 0.25 ? C.yellow : C.red;

  const hpBar = buildHpBar(stats.hp, stats.maxHp);

  console.log(`\n${C.dim}────────────────────────────────────────────────────────────${C.reset}`);
  console.log(
    `${C.bright}[ ${C.cyan}${name}${C.reset}${C.bright} | ${C.magenta}${cls}${C.reset}${C.bright} | ${hpColor}HP: ${stats.hp}/${stats.maxHp}${C.reset} ${hpBar} ${C.bright}| LVL:${C.yellow}${stats.level}${C.reset}${C.bright} | ${C.yellow}💰 ${stats.gold}${C.reset}${C.bright} | ${C.blue}📍 ${loc}${C.reset}${C.bright} ]${C.reset}`
  );

  const special = response.specialAbilityState as Record<string, unknown>;
  const abilityHints: string[] = [];
  if (typeof special.vanishCooldownTurnsLeft === "number" && special.vanishCooldownTurnsLeft > 0) {
    abilityHints.push(`${C.yellow}SandstormVanish: ${special.vanishCooldownTurnsLeft}t cooldown${C.reset}`);
  } else if (typeof special.vanishCooldownTurnsLeft === "number") {
    abilityHints.push(`${C.green}SandstormVanish: READY${C.reset}`);
  }
  if (special.shieldUsedThisEncounter) {
    abilityHints.push(`${C.red}HolyHairballShield: USED${C.reset}`);
  }
  if (special.nineLivesUsed) {
    abilityHints.push(`${C.red}Nine Lives: USED${C.reset}`);
  }
  if (abilityHints.length > 0) {
    console.log(`  ${abilityHints.join("  |  ")}`);
  }

  const inventory = response.inventory as string[];
  if (inventory.length > 0) {
    console.log(`  ${C.dim}Inventory: ${inventory.join(", ")}${C.reset}`);
  }
  console.log(`${C.dim}────────────────────────────────────────────────────────────${C.reset}`);
}

function buildHpBar(hp: number, maxHp: number): string {
  const filledCount = Math.floor((hp / maxHp) * 10);
  const color = hp > maxHp * 0.5 ? C.green : hp > maxHp * 0.25 ? C.yellow : C.red;
  return `${color}[${"█".repeat(filledCount)}${"░".repeat(10 - filledCount)}]${C.reset}`;
}

function printDiceBox(diceRolls: Array<{ purpose: string; rolls: number[]; total: number; modifier: number; statBonus: number }>): void {
  if (!diceRolls || diceRolls.length === 0) return;

  for (const roll of diceRolls) {
    const rollStr = roll.rolls.map((r) => String(r)).join("+");
    const parts: string[] = [`d${20}: ${rollStr}`];
    if (roll.statBonus) parts.push(`stat:${roll.statBonus}`);
    if (roll.modifier) parts.push(`mod:${roll.modifier}`);

    const hit = roll.total >= 10;
    const resultIcon = hit ? `${C.green}✓ HIT${C.reset}` : `${C.red}✗ MISS${C.reset}`;
    const purposeUpper = roll.purpose.toUpperCase().replace(/-/g, " ");

    console.log(`\n${C.yellow}┌── DICE ROLL ──────────────────────────────────────────────┐${C.reset}`);
    console.log(`${C.yellow}│${C.reset}  [ ${C.bright}${parts.join(" + ")} = ${C.cyan}${roll.total}${C.reset} ]  ${resultIcon}  ${C.dim}${purposeUpper}${C.reset}`);
    console.log(`${C.yellow}└───────────────────────────────────────────────────────────┘${C.reset}`);
  }
}

async function invokeDungeonController(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await lambda.send(new InvokeCommand({
    FunctionName: "neon-scratch-dungeon-controller",
    Payload: Buffer.from(JSON.stringify(payload)),
  }));

  if (response.FunctionError) {
    const errorPayload = JSON.parse(Buffer.from(response.Payload!).toString());
    throw new Error(`Lambda error: ${errorPayload.errorMessage ?? JSON.stringify(errorPayload)}`);
  }

  return JSON.parse(Buffer.from(response.Payload!).toString());
}

// --- Commands ---

async function newGame(characterClass: string): Promise<void> {
  header();
  console.log(`${C.cyan}Initializing new campaign — Class: ${C.bright}${characterClass}${C.reset}\n`);

  const validClasses = ["TabbyWarrior", "SiameseMage", "MaineCoonPaladin", "SphinxRogue"];
  if (!validClasses.includes(characterClass)) {
    console.error(`${C.red}Invalid class. Choose from: ${validClasses.join(", ")}${C.reset}`);
    process.exit(1);
  }

  const result = await invokeDungeonController({
    playerId: PLAYER_ID,
    action: "new-game",
    characterClass,
  });

  const state: DemoState = {
    campaignId: result.campaignId as string,
    characterName: result.characterName as string,
    characterClass,
  };
  saveState(state);

  await typewriter(`\n${C.magenta}${result.narrative ?? "The neon flickers. Your story begins."}${C.reset}`);
  printDiceBox(result.diceRolls as []);
  printHud(result);

  if (result.questUpdate) {
    console.log(`\n${C.blue}📋 QUEST: ${result.questUpdate}${C.reset}`);
  }

  console.log(`\n${C.dim}Campaign ID: ${state.campaignId}${C.reset}`);
  console.log(`${C.dim}Run: npm run demo:explore  or  npm run demo:attack${C.reset}\n`);
}

async function sendAction(actionText?: string): Promise<void> {
  const state = loadState();
  if (!state.campaignId) {
    console.error(`${C.red}No active campaign. Run: npm run demo:new-game-rogue${C.reset}`);
    process.exit(1);
  }

  let action = actionText;
  if (!action) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    action = await new Promise<string>((resolve) => {
      rl.question(`${C.cyan}What does ${state.characterName} do? ${C.reset}`, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  console.log(`\n${C.dim}Sending action to Neo-Pawsburg...${C.reset}`);

  const result = await invokeDungeonController({
    campaignId: state.campaignId,
    playerId: PLAYER_ID,
    action,
  });

  await typewriter(`\n${C.magenta}${result.narrative}${C.reset}`);
  printDiceBox(result.diceRolls as []);
  printHud(result);

  if (result.leveledUp) {
    console.log(`\n${C.yellow}${C.bright}⭐ LEVEL UP! Now level ${result.newLevel}${C.reset}`);
  }
  if (result.questUpdate) {
    console.log(`\n${C.blue}📋 QUEST UPDATE: ${result.questUpdate}${C.reset}`);
  }
  if (result.gameOver) {
    const icon = result.gameOverReason === "victory" ? "🏆" : "💀";
    console.log(`\n${C.bright}${icon} GAME OVER: ${(result.gameOverReason as string | undefined)?.toUpperCase()}${C.reset}`);
    saveState({});
  }

  // Update state with latest character info
  saveState({
    ...state,
    characterName: result.characterName as string,
  });
}

async function triggerFailure(): Promise<void> {
  console.log(`\n${C.red}${C.bright}=== FAILURE INJECTION DEMO ===${C.reset}`);
  console.log(`${C.yellow}Injecting FORCE_TOOL_FAILURE=true into execute-tool Lambda...${C.reset}`);

  // Set the env var on execute-tool Lambda
  await lambda.send(new UpdateFunctionConfigurationCommand({
    FunctionName: "neon-scratch-execute-tool",
    Environment: {
      Variables: { FORCE_TOOL_FAILURE: "true" },
    },
  }));

  console.log(`${C.green}✓ Env var set. Sending action — Step Functions retries will be visible in console.${C.reset}`);
  console.log(`${C.dim}Open Step Functions console now: https://${REGION}.console.aws.amazon.com/states${C.reset}\n`);

  const state = loadState();
  if (!state.campaignId) {
    console.log(`${C.yellow}No active campaign — starting a new one for the failure demo.${C.reset}`);
    await newGame("SphinxRogue");
    const freshState = loadState();
    state.campaignId = freshState.campaignId;
  }

  // Fire action — retries will happen
  const actionPromise = invokeDungeonController({
    campaignId: state.campaignId,
    playerId: PLAYER_ID,
    action: "I attempt to pick the lock on the alley door",
  });

  console.log(`${C.dim}Waiting 5 seconds — watch Step Functions console for retries...${C.reset}`);
  await sleep(5000);

  // Reset the env var while the action is still retrying
  console.log(`${C.yellow}Resetting FORCE_TOOL_FAILURE — workflow will succeed on retry...${C.reset}`);
  await lambda.send(new UpdateFunctionConfigurationCommand({
    FunctionName: "neon-scratch-execute-tool",
    Environment: { Variables: {} },
  }));

  try {
    const result = await actionPromise;
    console.log(`\n${C.green}✓ Safe narrative delivered despite failure:${C.reset}`);
    await typewriter(`\n${C.magenta}${result.narrative}${C.reset}`);
    printHud(result);
  } catch (err) {
    console.log(`\n${C.red}Workflow failed completely (check DLQ):${C.reset}`, err);
  }
}

async function showLogs(): Promise<void> {
  console.log(`\n${C.cyan}Querying CloudWatch Logs Insights...${C.reset}\n`);

  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - 3600; // last hour

  const queryString = `
    fields @timestamp, campaignId, latencyMs, toolName, total as diceResult, hp, @message
    | filter ispresent(campaignId)
    | sort @timestamp desc
    | limit 20
  `;

  const startResp = await cwl.send(new StartQueryCommand({
    logGroupNames: [
      "/aws/lambda/neon-scratch-dungeon-controller",
      "/aws/lambda/neon-scratch-execute-tool",
      "/aws/lambda/neon-scratch-invoke-dungeon-master",
    ],
    startTime,
    endTime,
    queryString,
  }));

  const queryId = startResp.queryId!;
  let results: Array<Array<{ field: string; value: string }>> = [];

  // Poll for results
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const pollResp = await cwl.send(new GetQueryResultsCommand({ queryId }));
    if (pollResp.status === "Complete") {
      results = (pollResp.results ?? []) as Array<Array<{ field: string; value: string }>>;
      break;
    }
  }

  if (results.length === 0) {
    console.log(`${C.yellow}No log results found. Play a few turns first!${C.reset}`);
    return;
  }

  // Format as table
  console.log(`${C.bright}${"─".repeat(100)}${C.reset}`);
  console.log(
    `${C.bright}${padCol("TIMESTAMP", 25)}${padCol("CAMPAIGN", 12)}${padCol("LATENCY", 10)}${padCol("TOOL", 20)}${padCol("DICE", 8)}${padCol("HP", 8)}${C.reset}`
  );
  console.log(`${C.bright}${"─".repeat(100)}${C.reset}`);

  for (const row of results) {
    const rowMap: Record<string, string> = {};
    for (const field of row) rowMap[field.field] = field.value;

    const ts = (rowMap["@timestamp"] ?? "").substring(11, 19);
    const campaign = (rowMap["campaignId"] ?? "-").substring(0, 8);
    const latency = rowMap["latencyMs"] ? `${rowMap["latencyMs"]}ms` : "-";
    const tool = rowMap["toolName"] ?? "-";
    const dice = rowMap["diceResult"] ?? "-";
    const hp = rowMap["hp"] ?? "-";

    console.log(
      `${padCol(ts, 25)}${C.cyan}${padCol(campaign, 12)}${C.reset}${padCol(latency, 10)}${C.yellow}${padCol(tool, 20)}${C.reset}${padCol(dice, 8)}${padCol(hp, 8)}`
    );
  }
  console.log(`${C.bright}${"─".repeat(100)}${C.reset}\n`);
}

function padCol(value: string, width: number): string {
  return value.substring(0, width).padEnd(width);
}

async function showCampaign(): Promise<void> {
  const state = loadState();
  if (!state.campaignId) {
    console.error(`${C.red}No active campaign.${C.reset}`);
    process.exit(1);
  }

  const result = await ddb.send(new GetCommand({
    TableName: "neon-scratch-campaigns",
    Key: { campaignId: state.campaignId },
  }));

  if (!result.Item) {
    console.error(`${C.red}Campaign not found in DynamoDB.${C.reset}`);
    process.exit(1);
  }

  console.log(`\n${C.cyan}${C.bright}=== CAMPAIGN STATE ===${C.reset}\n`);
  console.log(JSON.stringify(result.Item, null, 2));
}

async function resetDemo(): Promise<void> {
  const state = loadState();

  if (state.campaignId) {
    try {
      await ddb.send(new DeleteCommand({
        TableName: "neon-scratch-campaigns",
        Key: { campaignId: state.campaignId },
      }));
      console.log(`${C.green}✓ Deleted campaign ${state.campaignId}${C.reset}`);
    } catch (err) {
      console.warn(`${C.yellow}Could not delete campaign: ${err}${C.reset}`);
    }
  }

  saveState({});
  console.log(`${C.green}✓ Demo state reset. Ready for next demo.${C.reset}`);
}

// --- CLI entrypoint ---

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  try {
    switch (command) {
      case "new":
        await newGame(args[0] ?? "SphinxRogue");
        break;
      case "action":
        await sendAction(args.join(" ") || undefined);
        break;
      case "failure":
        await triggerFailure();
        break;
      case "logs":
        await showLogs();
        break;
      case "campaign":
        await showCampaign();
        break;
      case "reset":
        await resetDemo();
        break;
      default:
        console.log(`
${neon("The Neon Scratch Lounge")} — Demo CLI

Commands:
  new <Class>    Start a new campaign (TabbyWarrior | SiameseMage | MaineCoonPaladin | SphinxRogue)
  action <text>  Send player action (omit text to prompt interactively)
  failure        Inject tool failure and show Step Functions retries
  logs           Show CloudWatch Logs Insights table
  campaign       Print full campaign state JSON
  reset          Clear demo state

npm scripts:
  npm run demo:new-game-rogue
  npm run demo:attack
  npm run demo:explore
  npm run demo:trigger-failure
  npm run demo:show-logs
        `);
    }
  } catch (err) {
    console.error(`\n${C.red}${C.bright}Error: ${err instanceof Error ? err.message : String(err)}${C.reset}\n`);
    process.exit(1);
  }
}

main();
