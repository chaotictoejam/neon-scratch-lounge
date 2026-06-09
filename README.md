# The Neon Scratch Lounge (Demo for AWS Summit Los Angeles 2026)

**Neo-Pawsburg, 2087.** A cyberpunk cat RPG running on production-grade AWS infrastructure — demonstrating five reliability patterns with an AI Dungeon Master powered by Amazon Bedrock.

Built as a live conference demo for AWS LA Summit 2026. The contrast between "cyberpunk cat adventure" and "enterprise distributed systems" is intentional. That's the point.

---

## What this is

A fully-deployed, playable RPG where every player action flows through a real AWS architecture: API Gateway → Lambda → Step Functions → Bedrock (Claude) → DynamoDB. The UI shows the AWS mechanics in real time alongside the game — Step Functions workflow trace, CloudWatch log events, token counts, and dice rolls.

The demo illustrates five reliability patterns you'd find in any serious AI agent system:

1. **Retrieval-Augmented Generation** — lore retrieved and injected as context before every Bedrock call
2. **Step Functions retries** — exponential backoff with full jitter on named errors (`DemoForcedFailure`, `DMOutputValidationError`)
   - The DM uses Bedrock's native tool-use loop to call dice/combat/inventory tools and see real results before writing narrative
3. **Dead Letter Queue** — DM invocation failures caught after all retries, failed state sent to SQS DLQ, safe narrative returned to the player via FormatResponse
4. **Idempotency** — tool results cached in DynamoDB with TTL, scoped to `campaignId:turnId:toolName`
5. **Structured observability** — every Lambda emits one JSON log line per request, queryable via CloudWatch Logs Insights

---

## Architecture

```
Player Action
     │
     ▼
API Gateway REST API
     │  POST /action
     ▼
dungeon-controller (Lambda)
     │  publishes PlayerAction to EventBridge (audit trail)
     │  starts Express Workflow async → returns turnId immediately
     │  player polls GET /action/status?turnId=... for result
     ▼
Step Functions Express Workflow
     │
     ├── RetrieveLore          → lore context injected before DM call (see modes below)
     ├── InvokeDungeonMaster   → Bedrock native tool-use agentic loop (Claude Sonnet 4)
     │     │   DM calls game tools → sees real results → calls finalize-response
     │     ├── retry: DemoForcedFailure    (MaxAttempts: 3, FULL jitter)
     │     ├── retry: DMOutputValidationError (MaxAttempts: 3, FULL jitter)
     │     └── catch: States.ALL → SQS DLQ → safe narrative → FormatResponse
     ├── PersistCampaign       → DynamoDB put; summarise if history > 20 turns
     └── FormatResponse        → typed FormattedResponse written to DynamoDB, turnId resolved
```

### Agentic tool-use loop in InvokeDungeonMaster

`invoke-dungeon-master` runs a multi-turn Bedrock conversation loop rather than a single-shot prompt. The DM is given 9 tools:

| Tool | Purpose |
|---|---|
| `roll-dice` | Roll dN (d4/d6/d8/d10/d12/d20) — d20 enforced for skill checks |
| `apply-damage` | Apply damage or healing to a combatant |
| `update-inventory` | Add or remove items from player inventory |
| `award-xp` | Grant XP and trigger level-up if threshold reached |
| `update-location` | Move player to a new location |
| `apply-effect` | Apply status effects with duration |
| `use-special-ability` | Activate class special ability |
| `update-quest-log` | Record quest progress |
| `finalize-response` | **Required last call** — carries the narrative, combat summary, and game state |

The loop runs until the DM calls `finalize-response` (max 12 tool iterations). All tool execution happens inside the Lambda via `lambda/shared/tool-runner.ts`, so the DM always sees real dice totals before writing narrative.

```
invoke-dungeon-master loop:
  send message to Bedrock (tools array)
       │
       ▼
  stop_reason == "tool_use"?
  │  yes → execute each tool via tool-runner.ts
  │         write tool_result blocks
  │         send next message with tool results
  │         └── repeat
  │
  └── stop_reason == "end_turn" after finalize-response
       → extract DMOutput from finalize-response args
       → return to Step Functions
```

### RetrieveLore — two modes

**Default (`useBedrockKnowledgeBase: false`)**
```
RetrieveLore Lambda
     └── keyword scoring against bundled JSON (locations + enemies + items + classes, ~16 KB)
         returns top-5 matching lore entries + guaranteed current location entry
```

**AOSS mode (`useBedrockKnowledgeBase: true`)**
```
RetrieveLore Lambda
     └── bedrock.retrieve() → Bedrock Knowledge Base
                                    └── OpenSearch Serverless (VECTORSEARCH collection)
                                          └── kNN index (HNSW/faiss, titan-embed-text-v1, dim 1536)
```

### Supporting infrastructure

```
EventBridge custom bus (neon-scratch-events)
     └── PlayerAction rule → SFN StartExecution (async, audit trail only)

DynamoDB (on-demand)
     ├── neon-scratch-campaigns    (campaignId PK, playerId GSI, TTL 30 days)
     ├── neon-scratch-tool-results (idempotencyKey PK, TTL 1 hour)
     └── neon-scratch-turn-results (turnId PK, TTL)

SQS Dead Letter Queue
     └── neon-scratch-dungeon-dlq (14-day retention)

CloudWatch
     ├── Log groups per Lambda (1-week retention)
     ├── Metric filters (token usage, dice rolls, monsters defeated, active campaigns)
     ├── Dashboard: NeonScratchLounge
     └── Alarms (DLQ depth, DM p99 latency, controller p99 latency, error rate)

API Gateway (REST, prod stage)
     ├── POST /action              → dungeon-controller
     ├── POST /demo/inject-failure → sets FORCE_TOOL_FAILURE=true on invoke-dungeon-master
     ├── POST /demo/clear-failure  → clears the env var
     └── GET  /demo/logs           → CloudWatch Logs Insights query for a campaignId
```

---

## Prerequisites

- AWS CLI configured with deploy permissions
- CDK bootstrapped in your target account/region: `cdk bootstrap`
- **Bedrock model access enabled** in us-east-1:
  - `us.anthropic.claude-sonnet-4-5-20250929-v1:0` (cross-region inference profile)
  - `amazon.titan-embed-text-v1` (only if `useBedrockKnowledgeBase: true`)
- OpenSearch Serverless service-linked role (only if `useBedrockKnowledgeBase: true`):
  ```bash
  aws iam create-service-linked-role --aws-service-name observability.aoss.amazonaws.com
  ```
- Node 20+

---

## Deploy

### Production

```bash
npm install
cd infra
npx cdk deploy --all
```

The deploy outputs `NeonScratchApi.ApiUrl` — you'll need that for the UI.

### Dev environment

All physical resource names are suffixed (`-dev`), so dev and prod can coexist in the same account without collision:

```bash
cd infra
npx cdk deploy --all -c envName=dev
```

Stack names get a capitalised suffix (`NeonScratchData-Dev`, `NeonScratchWorkflow-Dev`, etc.). CloudWatch metrics use the `NeonScratchDev` namespace. To destroy the dev environment independently:

```bash
npx cdk destroy --all -c envName=dev
```

---

## UI

The `ui/` directory is a React + Vite app. Left panel is the game; right panel shows the AWS mechanics live (Step Functions trace, CloudWatch log stream, token counts).

```bash
cd ui
npm install
cp .env.local.example .env.local
# Set VITE_API_GATEWAY_URL to the ApiUrl output from cdk deploy
npm run dev
```

The CloudWatch Logs panel polls `GET /demo/logs?campaignId=<id>` after each turn and displays the actual Lambda invocation records filtered to the active campaign.

For a production static hosting setup:

```bash
npm run build
aws s3 sync dist/ s3://your-bucket
```

---

## Demo: failure injection

The failure injection demo shows Step Functions retrying the `InvokeDungeonMaster` task after a forced error.

**How it works:**

1. `POST /demo/inject-failure` — sets `FORCE_TOOL_FAILURE=true` as an environment variable on the `invoke-dungeon-master` Lambda.
2. On the next player action, `invoke-dungeon-master` throws a `DemoForcedFailure` named error the first time it tries to execute a tool.
3. Step Functions catches `DemoForcedFailure` and retries the task up to 3 times with exponential backoff and full jitter.
4. `POST /demo/clear-failure` — clears the env var so subsequent turns succeed.

The UI shows the retry animation in the workflow trace while the DM is being re-invoked.

---

## Character classes

| Class | HP | STR | AGI | ARC | STL | Gold | Special ability |
|---|---|---|---|---|---|---|---|
| TabbyWarrior | 120 | 8 | 5 | 2 | 4 | 10 | NineLifesPassive |
| SiameseMage | 70 | 3 | 6 | 9 | 5 | 15 | LaserFocusSpell |
| MaineCoonPaladin | 100 | 6 | 3 | 5 | 2 | 20 | HolyHairballShield |
| SphinxRogue | 80 | 4 | 9 | 4 | 9 | 25 | SandstormVanish |

- **NineLifesPassive** — survives one killing blow per campaign with 1 HP
- **LaserFocusSpell** — spend 10 HP for 3× arcane damage on next attack (declare before roll)
- **HolyHairballShield** — blocks up to 15 damage once per combat encounter
- **SandstormVanish** — all enemies miss for one turn; 3-turn cooldown

---

## Locations in Neo-Pawsburg

| Location | Danger | Notes |
|---|---|---|
| NeonScratchLounge | Safe | Resistance HQ, Madame Fluffington |
| ChromeAlley | High | RoombaCore patrols, laser graffiti |
| NightMarket | Low | Merchants, info brokers |
| SewersOfForgetfulness | Medium | Mutant rats, feral cats |
| RoombaCoreTower | Extreme | Final dungeon, CEO Roomba |

---

## Configuration

All tunable parameters are in `infra/cdk.json` under `context.neonScratch`:

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
  "bedrockRegion": "us-east-1",
  "bedrockModelId": "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "useBedrockKnowledgeBase": false
}
```

### Switching lore retrieval modes

**Bundled JSON (default)** — no extra cost, works immediately:
```json
"useBedrockKnowledgeBase": false
```

**Bedrock Knowledge Base + AOSS** — semantic vector search, ~$701/month idle (4 OCU minimum):
```json
"useBedrockKnowledgeBase": true
```
Requires `amazon.titan-embed-text-v1` model access. After deploy, wait 3–5 minutes for the ingestion job to finish before the KB returns results.

---

## Tests

```bash
npm test
```

- `test/dice.test.ts` — dice ranges, stat bonuses, idempotency key format
- `test/idempotency.test.ts` — cache hit/miss, TTL expiry, cross-turn isolation
- `test/validate-tools.test.ts` — tool schema validation, unknown tool rejection
- `test/campaign-summary.test.ts` — summary triggers at 20 turns, history trimming
- `test/special-abilities.test.ts` — NineLifes, Shield, Vanish cooldown mechanics
- `test/integration/workflow.test.ts` — CDK synth assertions, class stat invariants

---

## File structure

```
├── infra/
│   ├── bin/app.ts                     CDK entry point (reads envName from context)
│   ├── stacks/
│   │   ├── data-stack.ts             DynamoDB tables
│   │   ├── knowledge-base-stack.ts   AOSS + Bedrock KB (only when useBedrockKnowledgeBase: true)
│   │   ├── workflow-stack.ts         Lambdas + Step Functions + EventBridge
│   │   ├── api-stack.ts              API Gateway + demo endpoints
│   │   └── observability-stack.ts    CloudWatch dashboard + alarms
│   └── cdk.json                      Config + context variables
├── lambda/
│   ├── shared/
│   │   ├── types.ts                  Shared TypeScript types
│   │   ├── logger.ts                 Structured JSON logger
│   │   ├── idempotency.ts            DynamoDB idempotency cache
│   │   └── tool-runner.ts            All 8 game tool functions + runTool() dispatcher
│   ├── dungeon-controller/index.ts   API entry point, starts SFN async, returns turnId
│   ├── demo/
│   │   ├── inject-failure.ts         Injects/clears FORCE_TOOL_FAILURE on invoke-dungeon-master
│   │   └── fetch-logs.ts             CloudWatch Logs Insights query helper
│   └── workflow/
│       ├── retrieve-lore.ts          RAG or bundled JSON lore retrieval
│       ├── invoke-dungeon-master.ts  Bedrock agentic loop — calls tools, writes finalize-response
│       ├── execute-tool.ts           Thin wrapper over tool-runner (deployed, not in SFN chain)
│       ├── persist-campaign.ts       DynamoDB campaign state write + history summarisation
│       └── format-response.ts        Shapes final typed response for the player
├── lore/                             locations.json, enemies.json, items.json, classes.json
├── scripts/demo.ts                   CLI helper used during the live demo
├── test/
├── ui/                               React + Vite + Tailwind game UI
└── README.md
```

---

## Cost estimate

Estimates in USD/month. Claude Sonnet 4 at $3.00/1M input, $15.00/1M output.

The agentic loop runs multiple Bedrock turns per player action (DM calls tools, receives results, calls `finalize-response`). Typical turns use ~3,000 input + 800 output tokens across all loop iterations.

| Service | Idle (no AOSS) | 500 req/mo | 5,000 req/mo |
|---|---|---|---|
| Amazon Bedrock | — | ~$12.00 | ~$120.00 |
| CloudWatch (dashboard + 4 alarms) | $3.50 | $3.50 | $3.50 |
| Lambda (6 fns × ~2s avg × 512 MB) | — | $0.02 | $0.25 |
| Step Functions Express | — | $0.04 | $0.40 |
| DynamoDB + API GW + EventBridge + SQS | — | $0.01 | $0.10 |
| **Total** | **~$3.52** | **~$15.57** | **~$124.25** |

Add ~$701/month for the AOSS mode (4 OCU minimum regardless of traffic).

Bedrock cost per request ≈ $0.021 (3,000 input + 800 output tokens across the agentic loop, plus an amortised summarise call every 20 turns). Verify current pricing at [aws.amazon.com/bedrock/pricing](https://aws.amazon.com/bedrock/pricing/).

---

## Cleanup

```bash
cd infra
npx cdk destroy --all
# or for dev environment:
npx cdk destroy --all -c envName=dev
```

S3 buckets and DynamoDB tables use `RemovalPolicy.DESTROY` for easy teardown.

---

## TODO

- **Item stat bonuses** — inventory is currently a flat string array; equipping gear (e.g. `HackingClaws`) does not modify `playerStats`. Add a static item registry in `tool-runner.ts` that applies/reverses stat deltas on pickup/drop (auto-equip on pickup first, then explicit equip action).
