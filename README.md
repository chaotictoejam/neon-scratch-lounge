# The Neon Scratch Lounge (Demo for AWS Summit, Los Angeles)

**Neo-Pawsburg, 2087.** A cyberpunk cat RPG running on production-grade AWS infrastructure — demonstrating five reliability patterns with an AI Dungeon Master powered by Amazon Bedrock.

Built as a live conference demo for AWS LA Summit 2026. The contrast between "cyberpunk cat adventure" and "enterprise distributed systems" is intentional. That's the point.

---

## What this is

A fully-deployed, playable RPG where every player action flows through a real AWS architecture: API Gateway → Lambda → Step Functions → Bedrock (Claude) → DynamoDB. The UI shows the AWS mechanics in real time alongside the game — Step Functions workflow trace, CloudWatch log events, token counts, and dice rolls.

The demo was used to illustrate five reliability patterns you'd find in any serious AI agent system:

1. **Retrieval-Augmented Generation** — lore retrieved and injected as context before every Bedrock call
2. **Step Functions retries** — exponential backoff with full jitter on DM validation errors
3. **Dead Letter Queue** — tool failures caught after 3 retries, safe narrative returned to the player
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
     ├── PersistCampaign       → DynamoDB put; summarise if history > 20 turns
     └── FormatResponse        → typed FormattedResponse returned to player
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
     └── neon-scratch-tool-results (idempotencyKey PK, TTL 1 hour)

SQS Dead Letter Queue
     └── neon-scratch-dungeon-dlq (14-day retention)

CloudWatch
     ├── Log groups per Lambda (1-week retention)
     ├── Metric filters (token usage, dice rolls, monsters defeated, active campaigns)
     ├── Dashboard: NeonScratchLounge
     └── Alarms (DLQ depth, DM error rate, controller latency p99)

API Gateway (REST, prod stage)
     ├── POST /action              → dungeon-controller
     ├── POST /demo/inject-failure → toggles FORCE_TOOL_FAILURE env var on execute-tool
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

```bash
npm install
cd infra
npx cdk deploy --all
```

The deploy outputs `NeonScratchApi.ApiUrl` — you'll need that for the UI.

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

The CloudWatch Logs panel in the UI polls `GET /demo/logs?campaignId=<id>` after each turn and displays the actual Lambda invocation records filtered to the active campaign.

For a production static hosting setup:

```bash
npm run build
aws s3 sync dist/ s3://your-bucket
```

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
- `test/validate-tools.test.ts` — ALLOWED_TOOLS filtering, unknown tool rejection
- `test/campaign-summary.test.ts` — summary triggers at 20 turns, history trimming
- `test/special-abilities.test.ts` — NineLifes, Shield, Vanish cooldown mechanics
- `test/integration/workflow.test.ts` — CDK synth assertions, class stat invariants

---

## File structure

```
├── infra/
│   ├── bin/app.ts                     CDK entry point
│   ├── stacks/
│   │   ├── data-stack.ts             DynamoDB tables
│   │   ├── knowledge-base-stack.ts   AOSS + Bedrock KB (only when useBedrockKnowledgeBase: true)
│   │   ├── workflow-stack.ts         Lambdas + Step Functions + EventBridge
│   │   ├── api-stack.ts              API Gateway + demo endpoints
│   │   └── observability-stack.ts    CloudWatch dashboard + alarms
│   └── cdk.json                      Config + context variables
├── lambda/
│   ├── shared/                        types.ts, logger.ts, idempotency.ts
│   ├── dungeon-controller/index.ts    API entry point, synchronous SFN caller
│   ├── demo/                          inject-failure.ts, fetch-logs.ts
│   └── workflow/                      retrieve-lore, invoke-dm, validate-route,
│                                      execute-tool, persist-campaign, format-response
├── lore/                              locations.json, enemies.json, items.json, classes.json
├── scripts/demo.ts                    CLI helper used during the live demo
├── test/
├── ui/                                React + Vite + Tailwind game UI
└── README.md
```

---

## Cost estimate

Estimates in USD/month. Claude Sonnet 4 at $3.00/1M input, $15.00/1M output.

| Service | Idle (no AOSS) | 500 req/mo | 5,000 req/mo |
|---|---|---|---|
| Amazon Bedrock | — | ~$6.20 | ~$62.00 |
| CloudWatch (dashboard + 3 alarms) | $3.33 | $3.33 | $3.33 |
| Lambda (7 fns × ~400 ms × 512 MB) | — | $0.02 | $0.23 |
| Step Functions Express | — | $0.04 | $0.40 |
| DynamoDB + API GW + EventBridge + SQS | — | $0.01 | $0.10 |
| **Total** | **~$3.35** | **~$9.60** | **~$66.06** |

Add ~$701/month for the AOSS mode (4 OCU minimum regardless of traffic).

Bedrock cost per request ≈ $0.012 (1,500 input + 400 output tokens for invoke-dm, plus an amortised summarise call every 20 turns). Verify current pricing at [aws.amazon.com/bedrock/pricing](https://aws.amazon.com/bedrock/pricing/).

---

## Cleanup

```bash
cd infra
npx cdk destroy --all
```

S3 buckets and DynamoDB tables use `RemovalPolicy.DESTROY` for easy teardown.
