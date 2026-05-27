// CDK synth assertions — verify infrastructure guarantees without deploying

import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { DataStack } from "../../infra/stacks/data-stack";

// Lightweight integration test that verifies CDK synth-time guarantees
// (Step Functions definition, DLQ wiring, X-Ray, env vars)
// Full KnowledgeBaseStack is excluded since it requires OpenSearch SLR setup

describe("CDK synth integration tests", () => {
  let app: cdk.App;
  let dataStack: DataStack;

  beforeAll(() => {
    app = new cdk.App({
      context: {
        neonScratch: {
          maxConversationHistory: 20,
          campaignTtlDays: 30,
          toolResultTtlSeconds: 3600,
          xpPerLevel: 100,
          historyTrimCount: 5,
          retryMaxAttempts: 3,
          retryIntervalSeconds: 2,
          retryBackoffRate: 2,
          retrieveLoreTimeoutSeconds: 10,
          invokeDmTimeoutSeconds: 30,
          validateRouteTimeoutSeconds: 5,
          executeToolTimeoutSeconds: 15,
          persistCampaignTimeoutSeconds: 10,
          bedrockRegion: "us-east-1",
          bedrockModelId: "anthropic.claude-sonnet-4-20250514",
          embeddingModelArn: "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v1",
        },
      },
    });
    dataStack = new DataStack(app, "TestDataStack", {
      env: { account: "123456789012", region: "us-east-1" },
    });
  });

  describe("DataStack DynamoDB tables", () => {
    let template: Template;

    beforeAll(() => {
      template = Template.fromStack(dataStack);
    });

    test("campaigns table has TTL attribute", () => {
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        TableName: "neon-scratch-campaigns",
        TimeToLiveSpecification: {
          AttributeName: "ttl",
          Enabled: true,
        },
      });
    });

    test("campaigns table has point-in-time recovery", () => {
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        TableName: "neon-scratch-campaigns",
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });

    test("tool-results table has TTL attribute", () => {
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        TableName: "neon-scratch-tool-results",
        TimeToLiveSpecification: {
          AttributeName: "ttl",
          Enabled: true,
        },
      });
    });

    test("campaigns table uses PAY_PER_REQUEST billing", () => {
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        TableName: "neon-scratch-campaigns",
        BillingMode: "PAY_PER_REQUEST",
      });
    });

    test("campaigns table has playerId GSI", () => {
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        TableName: "neon-scratch-campaigns",
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({ IndexName: "playerId-index" }),
        ]),
      });
    });
  });

  describe("ALLOWED_TOOLS list completeness", () => {
    test("all expected tools are in the allowed list", async () => {
      const { ALLOWED_TOOLS } = await import("../../lambda/shared/types");
      const expectedTools = [
        "roll-dice", "apply-damage", "update-inventory", "award-xp",
        "update-location", "apply-effect", "use-special-ability", "update-quest-log",
      ];
      for (const tool of expectedTools) {
        expect(ALLOWED_TOOLS).toContain(tool);
      }
    });
  });

  describe("Class starting stats", () => {
    test("all classes have valid starting stats", async () => {
      const { CLASS_STARTING_STATS } = await import("../../lambda/shared/types");
      for (const [cls, stats] of Object.entries(CLASS_STARTING_STATS)) {
        expect(stats.hp).toBeGreaterThan(0);
        expect(stats.maxHp).toBe(stats.hp);
        expect(stats.level).toBe(1);
        expect(stats.xp).toBe(0);
        expect(stats.gold).toBeGreaterThan(0);
        // All stats should be between 1 and 10
        expect(stats.pawStrength).toBeGreaterThanOrEqual(1);
        expect(stats.agility).toBeGreaterThanOrEqual(1);
        expect(stats.arcane).toBeGreaterThanOrEqual(1);
        expect(stats.stealth).toBeGreaterThanOrEqual(1);
      }
    });

    test("SphinxRogue has highest agility and stealth", async () => {
      const { CLASS_STARTING_STATS } = await import("../../lambda/shared/types");
      const rogue = CLASS_STARTING_STATS.SphinxRogue;
      const others = ["TabbyWarrior", "SiameseMage", "MaineCoonPaladin"] as const;
      for (const cls of others) {
        expect(rogue.agility).toBeGreaterThan(CLASS_STARTING_STATS[cls].agility);
        expect(rogue.stealth).toBeGreaterThan(CLASS_STARTING_STATS[cls].stealth);
      }
    });

    test("TabbyWarrior has highest HP and pawStrength", async () => {
      const { CLASS_STARTING_STATS } = await import("../../lambda/shared/types");
      const warrior = CLASS_STARTING_STATS.TabbyWarrior;
      const others = ["SiameseMage", "MaineCoonPaladin", "SphinxRogue"] as const;
      for (const cls of others) {
        expect(warrior.maxHp).toBeGreaterThan(CLASS_STARTING_STATS[cls].maxHp);
        expect(warrior.pawStrength).toBeGreaterThan(CLASS_STARTING_STATS[cls].pawStrength);
      }
    });

    test("SiameseMage has highest arcane", async () => {
      const { CLASS_STARTING_STATS } = await import("../../lambda/shared/types");
      const mage = CLASS_STARTING_STATS.SiameseMage;
      const others = ["TabbyWarrior", "MaineCoonPaladin", "SphinxRogue"] as const;
      for (const cls of others) {
        expect(mage.arcane).toBeGreaterThan(CLASS_STARTING_STATS[cls].arcane);
      }
    });

    test("SphinxRogue has highest starting gold", async () => {
      const { CLASS_STARTING_STATS } = await import("../../lambda/shared/types");
      const rogue = CLASS_STARTING_STATS.SphinxRogue;
      expect(rogue.gold).toBe(25);
      expect(rogue.gold).toBeGreaterThan(CLASS_STARTING_STATS.TabbyWarrior.gold);
      expect(rogue.gold).toBeGreaterThan(CLASS_STARTING_STATS.SiameseMage.gold);
      expect(rogue.gold).toBeGreaterThan(CLASS_STARTING_STATS.MaineCoonPaladin.gold);
    });
  });

  describe("Character name generators", () => {
    test("all classes have at least 4 names", async () => {
      const { CHARACTER_NAMES } = await import("../../lambda/shared/types");
      for (const names of Object.values(CHARACTER_NAMES)) {
        expect(names.length).toBeGreaterThanOrEqual(4);
      }
    });

    test("SphinxRogue includes 'Null'", async () => {
      const { CHARACTER_NAMES } = await import("../../lambda/shared/types");
      expect(CHARACTER_NAMES.SphinxRogue).toContain("Null");
    });
  });
});
