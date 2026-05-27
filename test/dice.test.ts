// Tests for dice rolling mechanics and stat bonus application
export {};

// Extracted dice logic for testing without DynamoDB dependency
function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

function rollDice(sides: number, count: number, modifier: number, statBonus: number): {
  rolls: number[];
  modifier: number;
  statBonus: number;
  total: number;
} {
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(rollDie(sides));
  const total = rolls.reduce((a, b) => a + b, 0) + modifier + statBonus;
  return { rolls, modifier, statBonus, total };
}

function makeIdempotencyKey(campaignId: string, turnId: string, toolName: string, purpose: string): string {
  return `${campaignId}:${turnId}:${toolName}:${purpose}`;
}

describe("Dice rolling", () => {
  const SAMPLE_SIZE = 1000;

  test.each([4, 6, 8, 10, 20])("d%i always returns value in range [1, %i]", (sides) => {
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const roll = rollDie(sides);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(sides);
    }
  });

  test("rollDice sums multiple dice correctly", () => {
    for (let i = 0; i < 100; i++) {
      const result = rollDice(6, 3, 0, 0);
      expect(result.rolls).toHaveLength(3);
      for (const r of result.rolls) {
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(6);
      }
      const expectedTotal = result.rolls.reduce((a, b) => a + b, 0);
      expect(result.total).toBe(expectedTotal);
    }
  });

  test("stat bonus is added to total correctly", () => {
    const result = rollDice(20, 1, 0, 9);
    expect(result.statBonus).toBe(9);
    expect(result.total).toBe(result.rolls[0] + 9);
  });

  test("modifier is added to total correctly", () => {
    const result = rollDice(6, 1, 5, 0);
    expect(result.modifier).toBe(5);
    expect(result.total).toBe(result.rolls[0] + 5);
  });

  test("stat bonus AND modifier both applied", () => {
    const result = rollDice(8, 2, 3, 4);
    const sumOfRolls = result.rolls.reduce((a, b) => a + b, 0);
    expect(result.total).toBe(sumOfRolls + 3 + 4);
  });

  test("d20 distribution is roughly uniform across 1000 rolls", () => {
    const buckets = new Array(20).fill(0);
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const roll = rollDie(20);
      buckets[roll - 1]++;
    }
    // Each bucket should have roughly 50 results — allow wide tolerance
    for (const count of buckets) {
      expect(count).toBeGreaterThan(10);
      expect(count).toBeLessThan(150);
    }
  });
});

describe("Idempotency key generation", () => {
  test("key is deterministic for same inputs", () => {
    const key1 = makeIdempotencyKey("camp-1", "5", "roll-dice", "attack-RoombaDrone");
    const key2 = makeIdempotencyKey("camp-1", "5", "roll-dice", "attack-RoombaDrone");
    expect(key1).toBe(key2);
  });

  test("key differs by campaignId", () => {
    const key1 = makeIdempotencyKey("camp-1", "5", "roll-dice", "attack");
    const key2 = makeIdempotencyKey("camp-2", "5", "roll-dice", "attack");
    expect(key1).not.toBe(key2);
  });

  test("key differs by turnId (cross-turn isolation)", () => {
    const key1 = makeIdempotencyKey("camp-1", "3", "roll-dice", "attack");
    const key2 = makeIdempotencyKey("camp-1", "4", "roll-dice", "attack");
    expect(key1).not.toBe(key2);
  });

  test("key differs by toolName", () => {
    const key1 = makeIdempotencyKey("camp-1", "5", "roll-dice", "attack");
    const key2 = makeIdempotencyKey("camp-1", "5", "apply-damage", "attack");
    expect(key1).not.toBe(key2);
  });

  test("key format is campaignId:turnId:toolName:purpose", () => {
    const key = makeIdempotencyKey("abc", "7", "award-xp", "defeat-drone");
    expect(key).toBe("abc:7:award-xp:defeat-drone");
  });
});
