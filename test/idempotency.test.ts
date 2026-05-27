// Tests for idempotency cache logic (without DynamoDB)

function makeIdempotencyKey(campaignId: string, turnId: string, toolName: string, purpose: string): string {
  return `${campaignId}:${turnId}:${toolName}:${purpose}`;
}

// In-memory cache for testing
class InMemoryIdempotencyCache {
  private store = new Map<string, { result: unknown; ttl: number }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.ttl < Math.floor(Date.now() / 1000)) {
      this.store.delete(key);
      return null;
    }
    return entry.result as T;
  }

  async set<T>(key: string, result: T, ttlSeconds = 3600): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + ttlSeconds;
    this.store.set(key, { result, ttl });
  }

  size(): number {
    return this.store.size;
  }
}

describe("Idempotency cache", () => {
  let cache: InMemoryIdempotencyCache;

  beforeEach(() => {
    cache = new InMemoryIdempotencyCache();
  });

  test("cache miss returns null", async () => {
    const result = await cache.get("nonexistent-key");
    expect(result).toBeNull();
  });

  test("cache hit returns stored result", async () => {
    const key = makeIdempotencyKey("camp-1", "5", "roll-dice", "attack");
    const storedResult = { rolls: [17], modifier: 0, statBonus: 9, total: 26, purpose: "attack" };
    await cache.set(key, storedResult);

    const retrieved = await cache.get<typeof storedResult>(key);
    expect(retrieved).toEqual(storedResult);
  });

  test("expired entry returns null", async () => {
    const key = "expiring-key";
    // Store with TTL in the past
    const entry = { result: { data: "old" }, ttl: Math.floor(Date.now() / 1000) - 1 };
    (cache as unknown as { store: Map<string, unknown> }).store.set(key, entry);

    const result = await cache.get(key);
    expect(result).toBeNull();
  });

  test("different turn IDs do not collide (cross-turn isolation)", async () => {
    const result1 = { rolls: [5], total: 5 };
    const result2 = { rolls: [18], total: 18 };

    const key1 = makeIdempotencyKey("camp-1", "3", "roll-dice", "attack");
    const key2 = makeIdempotencyKey("camp-1", "4", "roll-dice", "attack");

    await cache.set(key1, result1);
    await cache.set(key2, result2);

    expect(await cache.get(key1)).toEqual(result1);
    expect(await cache.get(key2)).toEqual(result2);
  });

  test("same key returns same result (true idempotency)", async () => {
    const key = makeIdempotencyKey("camp-abc", "7", "apply-damage", "attack-drone");
    const result = { previousHp: 100, newHp: 70, damageBlocked: 0, nineLivesTrigger: false, isDead: false };

    await cache.set(key, result);

    // Retrieve twice — should return identical result
    const first = await cache.get(key);
    const second = await cache.get(key);
    expect(first).toEqual(result);
    expect(second).toEqual(result);
  });

  test("different campaigns with same turnId do not collide", async () => {
    const key1 = makeIdempotencyKey("camp-A", "1", "award-xp", "defeat-drone");
    const key2 = makeIdempotencyKey("camp-B", "1", "award-xp", "defeat-drone");

    await cache.set(key1, { xp: 50 });
    await cache.set(key2, { xp: 75 });

    const r1 = await cache.get<{ xp: number }>(key1);
    const r2 = await cache.get<{ xp: number }>(key2);
    expect(r1?.xp).toBe(50);
    expect(r2?.xp).toBe(75);
  });
});
