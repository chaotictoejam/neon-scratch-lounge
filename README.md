# The Neon Scratch Lounge

**Neo-Pawsburg, 2087.** A cyberpunk cat RPG running on production-grade AWS infrastructure — demonstrating five reliability patterns with an AI agent DM powered by Amazon Bedrock.

The contrast between "cyberpunk cat adventure" and "enterprise distributed systems" is intentional. That's the point.

---

## Architecture

```
Player Action
     │
     ▼
API Gateway REST API
     │  /action POST
     ▼
dungeon-controller (Lambda)
     │  publishes PlayerAction to EventBridge (audit trail)
     │  starts Express Workflow synchronously
     ▼
Step Functions Express Workflow
     │
     ├── RetrieveLore          → lore context injected before DM call (see modes below)
     ├── InvokeDungeonMaster   → bedrock.InvokeModel (claude-sonnet-4)
     │     └── retry: DMOutputValidationError (MaxAttempts: 3, FULL jitter)
     ├── ValidateAndRoute      → filter ALLOWED_TOOLS
     ├── ExecuteTools (Map)    → run each tool call in sequence
     │     └── retry: States.TaskFailed (MaxAttempts: 3, FULL jitter)
     │     └── catch → SQS DLQ + SafeNarrative pass state
     ├── PersistCampaign       → DynamoDB put; bedrock.InvokeModel summarize if history > 20 turns
     └── FormatResponse        → typed FormattedResponse to player
          │
          ▼
     dungeon-controller returns response synchronously to API Gateway
```

### RetrieveLore — two modes

**Default (`useBedrockKnowledgeBase: false`)**
```
RetrieveLore Lambda
     └── keyword scoring against bundled JSON (locations + enemies + items + classes, 16 KB total)
         returns top-5 matching lore entries + guaranteed current location entry
```

**AOSS mode (`useBedrockKnowledgeBase: true`)**
```
RetrieveLore Lambda
     └── bedrock.retrieve() → Bedrock Knowledge Base
                                    └── OpenSearch Serverless (VECTORSEARCH collection)
                                          └── kNN index (HNSW/faiss, titan-embed-text-v1, dim 1536)
                                                └── S3 bucket (lore JSON files, chunked at 512 tokens)
```

AOSS mode is deployed by `KnowledgeBaseStack`. A CDK custom resource creates the vector index before the Knowledge Base is created (AOSS data-plane bootstrapping), then triggers a Bedrock ingestion job to embed and index the lore.

### Supporting infrastructure

```
EventBridge custom bus (neon-scratch-events)
     └── PlayerAction rule → SFN StartExecution (async, for audit — workflow also runs synchronously)

DynamoDB (on-demand)
     ├── neon-scratch-campaigns    (campaignId PK, playerId GSI, TTL)
     └── neon-scratch-tool-results (idempotencyKey PK, TTL)

SQS Dead Letter Queue
     └── neon-scratch-dungeon-dlq (14-day retention)

CloudWatch
     ├── Log groups per Lambda (1-week retention)
     ├── Metric filters (token usage, dice rolls, monsters defeated, active campaigns)
     ├── Dashboard: NeonScratchLounge
     └── Alarms (DLQ depth, DM error rate, controller latency p99)

API Gateway (REST)
     ├── POST /action              → dungeon-controller
     ├── POST /demo/inject-failure → inject-failure Lambda  (DEMO ONLY)
     └── POST /demo/clear-failure  → clear-failure Lambda   (DEMO ONLY)
```

**Five reliability patterns demonstrated:**
1. **Retrieval-Augmented Generation** — lore retrieved and injected as context before every DM call
2. **Step Functions retries** — exponential backoff with full jitter on DM validation errors
3. **Dead Letter Queue** — tool failures caught after 3 retries, safe narrative returned
4. **Idempotency** — tool results cached in DynamoDB with TTL scoped to `campaignId:turnId:toolName`
5. **Structured observability** — every Lambda emits one JSON log line per request, queryable in CloudWatch Logs Insights

---

## Prerequisites

- AWS CLI configured with appropriate permissions
- CDK bootstrapped: `cdk bootstrap`
- **Bedrock model access enabled** in us-east-1:
  - `anthropic.claude-sonnet-4-20250514` (required)
  - `amazon.titan-embed-text-v1` (only if `useBedrockKnowledgeBase: true`)
- OpenSearch Serverless service-linked role (only if `useBedrockKnowledgeBase: true`):
  ```bash
  aws iam create-service-linked-role --aws-service-name observability.aoss.amazonaws.com
  ```
- Node 20+

---

## Deploy

```bash
npm install
cd infra
cdk deploy --all
```

---

## UI (conference demo screen)

The `ui/` directory is a React app with a cyberpunk neon aesthetic — a two-panel split showing the game on the left and live AWS mechanics (Step Functions trace, Lambda telemetry, token counts) on the right.

```bash
cd ui
npm install
cp .env.local.example .env.local
# Paste your API Gateway URL into VITE_API_GATEWAY_URL in .env.local
# The ApiUrl output from `cdk deploy NeonScratchApi` has the value.
npm run dev
# Open http://localhost:5173
```

For production build (S3 + CloudFront):

```bash
npm run build
aws s3 sync dist/ s3://your-ui-bucket
```

**On-stage browser setup:**
- Zoom to 110% for projector readability
- Pre-start a SphinxRogue game (Sandpaw — high AGI/STL makes dice rolls dramatic)
- Press `Ctrl+Shift+F` in the browser to toggle failure injection mode for Beat 3 (red banner appears; auto-disables after 3 s)

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

All tunable parameters live in `infra/cdk.json` under `context.neonScratch`:

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
├── infra/                             All CDK infrastructure code
│   ├── bin/app.ts                     CDK entry point
│   ├── stacks/
│   │   ├── data-stack.ts             DynamoDB tables
│   │   ├── knowledge-base-stack.ts   stub (lore is bundled JSON, no AOSS)
│   │   ├── workflow-stack.ts         Lambdas + Step Functions + EventBridge
│   │   ├── api-stack.ts              API Gateway + demo endpoints
│   │   └── observability-stack.ts    CloudWatch dashboard + alarms
│   └── cdk.json                      CDK config + context variables
├── lambda/
│   ├── shared/                        types.ts, logger.ts, idempotency.ts
│   ├── dungeon-controller/index.ts    API entry point
│   └── workflow/                      retrieve-lore, invoke-dm, validate-route,
│                                      execute-tool, persist-campaign, format-response
├── lore/                              locations.json, enemies.json, items.json, classes.json
├── scripts/demo.ts                    On-stage demo CLI
├── test/                              Unit + CDK synth tests
├── package.json                       Node.js project (shared by infra, lambda, scripts, tests)
└── README.md                          This file
```

---

## Cost breakdown

All figures are estimates in USD per month. Bedrock prices used: Claude Sonnet 4 at $3.00/1M input tokens, $15.00/1M output tokens.

| Service | Idle (AOSS) | Idle (no AOSS) | 500 req/mo | 5,000 req/mo |
|---|---|---|---|---|
| OpenSearch Serverless | $700.80 | — | — | — |
| Amazon Bedrock | — | — | ~$6.20 | ~$62.00 |
| CloudWatch (dashboard + 3 alarms) | $3.33 | $3.33 | $3.33 | $3.33 |
| Lambda (7 fns × ~400 ms × 512 MB) | — | — | $0.02 | $0.23 |
| Step Functions Express | — | — | $0.04 | $0.40 |
| DynamoDB + API GW + EventBridge + SQS | — | — | $0.01 | $0.10 |
| **Total / month** | **~$704** | **~$3.35** | **~$9.60** | **~$66.06** |

**Notes:**
- AOSS idle cost is 4 OCUs minimum (2 indexing + 2 search) at $0.24/OCU-hr × 730 hrs
- The 500 req and 5,000 req columns assume **bundled-JSON mode** (no AOSS, the default)
- To run AOSS mode, add ~$701 to either request column
- Bedrock cost per request ≈ $0.012 (1,500 input tokens + 400 output tokens for invoke-dm, plus amortised summarise call every 20 turns)
- Bedrock pricing varies by region — verify at the [AWS Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/) before budgeting

### Switching between modes

**Default (bundled JSON)** — no AOSS, no setup beyond CDK deploy:
```json
// infra/cdk.json
"neonScratch": { "useBedrockKnowledgeBase": false }
```

**AOSS + Bedrock Knowledge Base** — semantic vector search, ~$701/month idle:
```json
"neonScratch": { "useBedrockKnowledgeBase": true }
```
Also requires `amazon.titan-embed-text-v1` model access in Bedrock console. After `cdk deploy`, wait 3–5 minutes for the ingestion job to complete before the KB returns results.

---

## Cleanup

```bash
cd infra
cdk destroy --all
```

Note: S3 buckets and DynamoDB tables use `RemovalPolicy.DESTROY` for easy teardown after the demo.
