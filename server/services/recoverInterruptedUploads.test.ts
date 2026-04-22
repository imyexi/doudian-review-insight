import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../jobs/llmProductName", () => ({
  extractProductNamesWithLlm: vi.fn(async () => ({})),
}));

type Database = Awaited<typeof import("../db/client")>["db"];
type SchemaModule = Awaited<typeof import("../db/schema")>;

interface TestState {
  db: Database;
  schema: SchemaModule;
  recoverInterruptedUploads: () => Promise<number>;
}

describe("recoverInterruptedUploads", () => {
  let state: TestState | undefined;

  beforeEach(async () => {
    const dataDir = path.join(os.tmpdir(), `doudian-recover-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    process.env.NODE_ENV = "test";
    process.env.DATA_DIR = dataDir;
    process.env.APP_PASSWORD = "test-password-123";
    process.env.SESSION_SECRET = "12345678901234567890123456789012";
    process.env.OPENAI_API_KEY = "";

    vi.resetModules();

    const [dbClient, schema, recoverModule] = await Promise.all([
      import("../db/client"),
      import("../db/schema"),
      import("../services/recoverInterruptedUploads"),
    ]);

    await dbClient.initializeDatabase();
    await migrate(dbClient.db, { migrationsFolder: "./drizzle" });

    state = {
      db: dbClient.db,
      schema,
      recoverInterruptedUploads: recoverModule.recoverInterruptedUploads,
    };
  });

  afterEach(() => {
    state = undefined;
  });

  function requireState(): TestState {
    if (!state) {
      throw new Error("expected test state to be initialized");
    }
    return state;
  }

  it("marks queued uploads as failed on startup", async () => {
    const { db, schema, recoverInterruptedUploads } = requireState();

    const [shop] = await db.insert(schema.shops).values({ name: "Recover Shop" }).returning({ id: schema.shops.id });

    await db.insert(schema.uploads).values({
      shopId: shop.id,
      originalFilename: "stranded.xlsx",
      storedPath: "/tmp/stranded.xlsx",
      status: "queued",
    });

    const count = await recoverInterruptedUploads();
    expect(count).toBe(1);

    const [upload] = await db.select().from(schema.uploads).where(eq(schema.uploads.shopId, shop.id)).limit(1);
    expect(upload?.status).toBe("failed");
    expect(upload?.error).toContain("继续分析");
    expect(upload?.finishedAt).toBeTypeOf("number");
  });

  it("marks analyzing and parsing uploads as failed", async () => {
    const { db, schema, recoverInterruptedUploads } = requireState();

    const [shop] = await db.insert(schema.shops).values({ name: "Multi Recover Shop" }).returning({ id: schema.shops.id });

    await db.insert(schema.uploads).values([
      { shopId: shop.id, originalFilename: "parsing.xlsx", storedPath: "/tmp/parsing.xlsx", status: "parsing" },
      { shopId: shop.id, originalFilename: "analyzing.xlsx", storedPath: "/tmp/analyzing.xlsx", status: "analyzing" },
    ]);

    const count = await recoverInterruptedUploads();
    expect(count).toBe(2);

    const rows = await db.select({ status: schema.uploads.status }).from(schema.uploads).where(eq(schema.uploads.shopId, shop.id));
    expect(rows.every(row => row.status === "failed")).toBe(true);
  });

  it("does not touch done or failed uploads", async () => {
    const { db, schema, recoverInterruptedUploads } = requireState();

    const [shop] = await db.insert(schema.shops).values({ name: "Clean Shop" }).returning({ id: schema.shops.id });

    await db.insert(schema.uploads).values([
      { shopId: shop.id, originalFilename: "done.xlsx", storedPath: "/tmp/done.xlsx", status: "done", finishedAt: 1_710_000_000 },
      { shopId: shop.id, originalFilename: "failed.xlsx", storedPath: "/tmp/failed.xlsx", status: "failed", error: "old error", finishedAt: 1_710_000_001 },
    ]);

    const count = await recoverInterruptedUploads();
    expect(count).toBe(0);

    const rows = await db.select({ status: schema.uploads.status, error: schema.uploads.error }).from(schema.uploads).where(eq(schema.uploads.shopId, shop.id));
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.status === "done")).toBeTruthy();

    const failedRow = rows.find(row => row.status === "failed");
    expect(failedRow?.error).toBe("old error");
  });
});
