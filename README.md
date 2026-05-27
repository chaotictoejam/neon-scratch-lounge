# The Neon Scratch Lounge

**Neo-Pawsburg, 2087.** A cyberpunk cat RPG running on production-grade AWS infrastructure — demonstrating five reliability patterns with an AI agent DM powered by Amazon Bedrock.

The contrast between "cyberpunk cat adventure" and "enterprise distributed systems" is intentional. That's the point.

---

## Architecture

```
Player Action
     │
     ▼
dungeon-controller (Lambda)
     │  publishes PlayerAction to EventBridge
     │  starts Express Workflow synchronously
     ▼
Step Functions Express Workflow
     │
     ├── RetrieveLore          → bedrock.retrieve() from Knowledge Base
     ├── InvokeDungeonMaster   → bedrock.InvokeModel (claude-sonnet-4)
     │     └── retry: DMOutputValidationError (MaxAttempts: 3, FULL jitter)
     ├── ValidateAndRoute      → filter ALLOWED_TOOLS
     ├── ExecuteTools (Map)    → run each tool call
     │     └── retry: States.TaskFailed (MaxAttempts: 3, FULL jitter)
     │     └── catch → DLQ + SafeNarrative
     ├── PersistCampaign       → DynamoDB, summarize if >20 turns
     └── FormatResponse        → typed response to player
```

**Five reliability patterns demonstrated:**
1. **Bedrock Knowledge Base** — structured lore retrieval via `bedrock.retrieve()`
2. **Step Functions retries** — exponential backoff with full jitter on DM validation errors
3. **Dead Letter Queue** — tool failures caught after 3 retries, safe narrative returned
4. **Idempotency** — tool results cached in DynamoDB with TTL scoped to `campaignId:turnId:toolName`
5. **Structured observability** — every Lambda emits JSON logs; CloudWatch Insights queries, custom metrics, alarms

---

## Prerequisites

- AWS CLI configured with appropriate permissions
- CDK bootstrapped: `cdk bootstrap`
- **Bedrock model access enabled** in us-east-1:
  - `anthropic.claude-sonnet-4-20250514`
  - `amazon.titan-embed-text-v1`
- OpenSearch Serverless service-linked role:
  ```bash
  aws iam create-service-linked-role --aws-service-name observability.aoss.amazonaws.com
  ```
- Node 18+

---

## Deploy

```bash
npm install
npm run build
cdk deploy --all
```

Wait **3-5 minutes** for the Bedrock Knowledge Base ingestion job to complete after deploy. The CDK custom resource fires `startIngestionJob` automatically — you can watch progress in the Bedrock console under Knowledge Bases.

---

## Play the game

```bash
# Start a new campaign
npm run demo:new-game-rogue       # SphinxRogue — high stealth, SandstormVanish
npm run demo:new-game-warrior     # TabbyWarrior — tank, NineLifesPassive
npm run demo:new-game-mage        # SiameseMage — glass cannon, LaserFocusSpell
npm run demo:new-game-paladin     # MaineCoonPaladin — HolyHairballShield

# Take actions (uses your active campaign)
npm run demo:explore              # "I slip into the shadows of Chrome Alley"
npm run demo:attack               # "I slash at the Roomba drone with my HackingClaws"
npm run demo:use-item             # "I crack open the Mystery Can of Tuna"
npm run demo:action               # Prompt for custom action interactively
```

---

## On-stage demo script — four beats, under 4 minutes

### Beat 1 — New game + first action

```bash
npm run demo:new-game-rogue
```
*Output: character name "Sandpaw", starting stats, location: NeonScratchLounge*

```bash
npm run demo:explore
```
*Output: narrative, dice roll box, HUD update*

> "This is Bedrock Knowledge Bases retrieving lore about Chrome Alley, passing it as context, and Claude narrating the result. The campaign state is in DynamoDB — the model remembers nothing itself."

---

### Beat 2 — Combat + observability

```bash
npm run demo:attack
```
*Output:*
```
┌── DICE ROLL ──────────────────────────────────────────────┐
│  [ d20: 14 + stat:9 = 23 ]  ✓ HIT  ATTACK-ROOMBADRONE    │
└───────────────────────────────────────────────────────────┘
```

```bash
npm run demo:show-logs
```
*Output: formatted table — step | latencyMs | toolName | diceResult | hp | success*

> "Every log line is structured JSON. That query took 2 seconds. In production you'd have this as a saved query in CloudWatch — you know exactly what happened on every turn."

---

### Beat 3 — Trigger failure + retry

```bash
npm run demo:trigger-failure
```

The script:
1. Sets `FORCE_TOOL_FAILURE=true` on the execute-tool Lambda
2. Sends an action — Step Functions retries are visible in the console
3. Waits 5 seconds
4. Resets the env var — workflow succeeds on retry
5. Player receives a coherent response

> *Switch to Step Functions console — retries visible in execution graph. Show DLQ receiving message.*

> "The player got a coherent response. The retry happened transparently. The DLQ caught the failure after three attempts. None of this required custom retry logic — Step Functions handled it."

---

### Beat 4 — Observability dashboard

*Switch to CloudWatch dashboard: `NeonScratchLounge`*

Widgets to call out:
- **Active Campaigns** — actions per hour
- **Dice Roll Distribution** — avg/min/max d20 totals — verify the dice are fair from this graph
- **Bedrock Token Usage** — average input tokens per DM invocation
- **Monsters Defeated Per Hour** — metric filter on `enemyDefeated` log field
- **DLQ Depth** — should be non-zero from Beat 3
- **Alarm Status** — DLQ alarm is red

> "Active campaigns. Token usage. Dice roll distribution — you can verify the dice are fair from this graph. Monsters defeated per hour. And there's the DLQ depth alarm from the failure we just triggered."

---

## Character classes

| Class | HP | Str | Agi | Arc | Stl | Gold | Special |
|---|---|---|---|---|---|---|---|
| TabbyWarrior | 120 | 8 | 5 | 2 | 4 | 10 | NineLifesPassive |
| SiameseMage | 70 | 3 | 6 | 9 | 5 | 15 | LaserFocusSpell |
| MaineCoonPaladin | 100 | 6 | 3 | 5 | 2 | 20 | HolyHairballShield |
| SphinxRogue | 80 | 4 | 9 | 4 | 9 | 25 | SandstormVanish |

**Special abilities:**
- **NineLifesPassive** — survives one killing blow per campaign with 1hp
- **LaserFocusSpell** — spend 10hp for 3× arcane damage on next attack (declare before roll)
- **HolyHairballShield** — block up to 15 damage once per combat encounter
- **SandstormVanish** — all enemies miss for one turn; 3-turn cooldown

---

## Locations in Neo-Pawsburg

| Location | Danger | Notable |
|---|---|---|
| NeonScratchLounge | Safe | Resistance HQ, Madame Fluffington |
| ChromeAlley | High | RoombaCore patrols, laser graffiti |
| NightMarket | Low | Merchants, info brokers |
| SewersOfForgetfulness | Medium | Mutant rats, feral cats |
| RoombaCoreTower | Extreme | Final dungeon, CEO Roomba |

---

## Configuration

All tunable parameters live in `cdk.json` under `context.neonScratch`:

```json
{
  "maxConversationHistory": 20,
  "campaignTtlDays": 30,
  "toolResultTtlSeconds": 3600,
  "xpPerLevel": 100,
  "historyTrimCount": 5,
  "retryMaxAttempts": 3,
  "retryIntervalSeconds": 2,
  "retryBackoffRate": 2,
  "bedrockModelId": "anthropic.claude-sonnet-4-20250514"
}
```

---

## Tests

```bash
npm test
```

Test files:
- `test/dice.test.ts` — dice ranges, stat bonuses, idempotency key format
- `test/idempotency.test.ts` — cache hit/miss, TTL expiry, cross-turn isolation
- `test/validate-tools.test.ts` — ALLOWED_TOOLS filtering, unknown tool rejection
- `test/campaign-summary.test.ts` — summary triggers at 20 turns, history trimming
- `test/special-abilities.test.ts` — NineLifes, Shield, Vanish cooldown mechanics
- `test/integration/workflow.test.ts` — CDK synth assertions, class stat invariants

---

## File structure

```
├── bin/app.ts                          CDK entry point
├── lib/stacks/
│   ├── data-stack.ts                  DynamoDB tables
│   ├── knowledge-base-stack.ts        S3 + OpenSearch + Bedrock KB
│   ├── workflow-stack.ts              Lambdas + Step Functions + EventBridge
│   └── observability-stack.ts         CloudWatch dashboard + alarms
├── lambda/
│   ├── shared/                        types.ts, logger.ts, idempotency.ts
│   ├── dungeon-controller/index.ts    API entry point
│   └── workflow/                      retrieve-lore, invoke-dm, validate-route,
│                                      execute-tool, persist-campaign, format-response
├── lore/                              locations.json, enemies.json, items.json, classes.json
├── scripts/demo.ts                    On-stage demo CLI
├── test/                              Unit + CDK synth tests
├── cdk.json                           CDK config + context variables
└── README.md                          This file
```

---

## Cleanup

```bash
cdk destroy --all
```

Note: S3 buckets and DynamoDB tables use `RemovalPolicy.DESTROY` for easy teardown after the demo.
