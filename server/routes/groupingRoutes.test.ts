import fs from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestContext {
  analyzeQueue: AnalyzeQueue;
  analyzeReviews: (items: ReviewRow[]) => Promise<void>;
  analyzeUpload: AnalyzeUpload;
  baseUrl: string;
  db: Database;
  env: Env;
  schema: SchemaModule;
  server: Server;
  testWorkerStartedPath: string;
}

type Database = Awaited<typeof import("../db/client")>["db"];
type Env = Awaited<typeof import("../env")>["env"];
type SchemaModule = Awaited<typeof import("../db/schema")>;
type ReviewRow = SchemaModule["reviews"]["$inferSelect"];
type AnalyzeQueue = Awaited<typeof import("../jobs/queue")>["analyzeQueue"];
type AnalyzeUpload = Awaited<typeof import("../jobs/analyze")>["analyzeUpload"];

describe("grouping regression routes", () => {
  let context: TestContext | undefined;

  beforeEach(async () => {
    context = await setupTestContext();
  });

  afterEach(async () => {
    if (context) {
      await context.analyzeQueue.shutdown();
      await closeServer(context.server);
    }
  });

  it("blocks cross-shop evidence and spec-stat lookups", async () => {
    const currentContext = requireContext(context);
    const shopA = await seedPainPointBundle(currentContext, "A");
    const shopB = await seedPainPointBundle(currentContext, "B");
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const evidenceResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points/${shopB.painPointId}/evidence?shopId=${shopA.shopId}`,
      { headers: { cookie } },
    );
    expect(evidenceResponse.status).toBe(404);

    const specStatsResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points/${shopB.painPointId}/spec-stats?shopId=${shopA.shopId}`,
      { headers: { cookie } },
    );
    expect(specStatsResponse.status).toBe(404);
  });

  it("returns an empty review result when painPointId belongs to another shop", async () => {
    const currentContext = requireContext(context);
    const shopA = await seedPainPointBundle(currentContext, "A");
    const shopB = await seedPainPointBundle(currentContext, "B");
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const crossShopResponse = await fetch(
      `${currentContext.baseUrl}/api/reviews?shopId=${shopA.shopId}&painPointId=${shopB.painPointId}&page=1&pageSize=20`,
      { headers: { cookie } },
    );
    expect(crossShopResponse.status).toBe(200);
    expect(await readJson<ReviewListApiResponse>(crossShopResponse)).toEqual({
      ok: true,
      data: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      },
    });

    const sameShopResponse = await fetch(
      `${currentContext.baseUrl}/api/reviews?shopId=${shopA.shopId}&painPointId=${shopA.painPointId}&page=1&pageSize=20`,
      { headers: { cookie } },
    );
    expect(sameShopResponse.status).toBe(200);

    const sameShopPayload = await readJson<ReviewListApiResponse>(sameShopResponse);
    expect(sameShopPayload.ok).toBe(true);
    if (!sameShopPayload.ok) {
      throw new Error("expected a successful review payload");
    }

    expect(sameShopPayload.data.total).toBe(1);
    expect(sameShopPayload.data.items).toHaveLength(1);
    expect(sameShopPayload.data.items[0]?.id).toBe(shopA.reviewId);
  });

  it("requires shop scoping for upload reads and blocks cross-shop access", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedUploadDeleteFixture(currentContext);
    const otherFixture = await seedQueuedUploadFixture(currentContext);
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const listWithoutShopResponse = await fetch(`${currentContext.baseUrl}/api/uploads`, {
      headers: { cookie },
    });
    expect(listWithoutShopResponse.status).toBe(400);

    const scopedListResponse = await fetch(`${currentContext.baseUrl}/api/uploads?shopId=${fixture.shopId}`, {
      headers: { cookie },
    });
    expect(scopedListResponse.status).toBe(200);

    const scopedListPayload = await readJson<UploadListApiResponse>(scopedListResponse);
    expect(scopedListPayload.ok).toBe(true);
    if (!scopedListPayload.ok) {
      throw new Error("expected a successful upload payload");
    }

    expect(scopedListPayload.data).toHaveLength(2);
    expect(scopedListPayload.data.map(item => item.id)).toEqual([fixture.survivingUploadId, fixture.deletedUploadId]);

    const otherShopListResponse = await fetch(`${currentContext.baseUrl}/api/uploads?shopId=${otherFixture.shopId}`, {
      headers: { cookie },
    });
    expect(otherShopListResponse.status).toBe(200);

    const otherShopListPayload = await readJson<UploadListApiResponse>(otherShopListResponse);
    expect(otherShopListPayload.ok).toBe(true);
    if (!otherShopListPayload.ok) {
      throw new Error("expected a successful upload payload");
    }

    expect(otherShopListPayload.data).toHaveLength(1);
    expect(otherShopListPayload.data[0]?.id).toBe(otherFixture.uploadId);

    const detailWithoutShopResponse = await fetch(`${currentContext.baseUrl}/api/uploads/${fixture.deletedUploadId}`, {
      headers: { cookie },
    });
    expect(detailWithoutShopResponse.status).toBe(400);

    const crossShopDetailResponse = await fetch(
      `${currentContext.baseUrl}/api/uploads/${fixture.deletedUploadId}?shopId=${otherFixture.shopId}`,
      { headers: { cookie } },
    );
    expect(crossShopDetailResponse.status).toBe(404);

    const scopedDetailResponse = await fetch(
      `${currentContext.baseUrl}/api/uploads/${fixture.deletedUploadId}?shopId=${fixture.shopId}`,
      { headers: { cookie } },
    );
    expect(scopedDetailResponse.status).toBe(200);

    const scopedDetailPayload = await readJson<UploadDetailApiResponse>(scopedDetailResponse);
    expect(scopedDetailPayload.ok).toBe(true);
    if (!scopedDetailPayload.ok) {
      throw new Error("expected a successful upload payload");
    }

    expect(scopedDetailPayload.data.id).toBe(fixture.deletedUploadId);
    expect(scopedDetailPayload.data.originalFilename).toBe("delete-batch.xlsx");
  });

  it("deletes upload batch reviews and rebuilds grouped analytics from surviving uploads", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedUploadDeleteFixture(currentContext);
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const beforeResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&productGroupId=${fixture.groupId}&mode=historical`,
      { headers: { cookie } },
    );
    expect(beforeResponse.status).toBe(200);

    const beforePayload = await readJson<PainPointListApiResponse>(beforeResponse);
    expect(beforePayload.ok).toBe(true);
    if (!beforePayload.ok) {
      throw new Error("expected a successful pain point payload");
    }

    expect(beforePayload.data).toHaveLength(1);
    expect(beforePayload.data[0]?.occurrenceCount).toBe(2);

    expect(fs.existsSync(fixture.deletedUploadPath)).toBe(true);
    expect(fs.existsSync(fixture.survivingUploadPath)).toBe(true);

    const deleteResponse = await fetch(`${currentContext.baseUrl}/api/uploads/${fixture.deletedUploadId}?shopId=${fixture.shopId}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleteResponse.status).toBe(200);

    const deletePayload = await readJson<DeleteApiResponse>(deleteResponse);
    expect(deletePayload).toEqual({
      ok: true,
      data: { id: fixture.deletedUploadId, deleted: true },
    });

    expect(fs.existsSync(fixture.deletedUploadPath)).toBe(false);
    expect(fs.existsSync(fixture.survivingUploadPath)).toBe(true);

    const uploadsResponse = await fetch(`${currentContext.baseUrl}/api/uploads?shopId=${fixture.shopId}`, {
      headers: { cookie },
    });
    expect(uploadsResponse.status).toBe(200);

    const uploadsPayload = await readJson<UploadListApiResponse>(uploadsResponse);
    expect(uploadsPayload.ok).toBe(true);
    if (!uploadsPayload.ok) {
      throw new Error("expected a successful upload payload");
    }

    expect(uploadsPayload.data).toHaveLength(1);
    expect(uploadsPayload.data[0]?.id).toBe(fixture.survivingUploadId);

    const reviewsResponse = await fetch(
      `${currentContext.baseUrl}/api/reviews?shopId=${fixture.shopId}&productGroupId=${fixture.groupId}&page=1&pageSize=20`,
      { headers: { cookie } },
    );
    expect(reviewsResponse.status).toBe(200);

    const reviewsPayload = await readJson<ReviewListApiResponse>(reviewsResponse);
    expect(reviewsPayload.ok).toBe(true);
    if (!reviewsPayload.ok) {
      throw new Error("expected a successful review payload");
    }

    expect(reviewsPayload.data.total).toBe(1);
    expect(reviewsPayload.data.items).toHaveLength(1);
    expect(reviewsPayload.data.items[0]?.id).toBe(fixture.survivingReviewId);

    const productsResponse = await fetch(`${currentContext.baseUrl}/api/shops/${fixture.shopId}/products`, {
      headers: { cookie },
    });
    expect(productsResponse.status).toBe(200);

    const productsPayload = await readJson<ProductListApiResponse>(productsResponse);
    expect(productsPayload.ok).toBe(true);
    if (!productsPayload.ok) {
      throw new Error("expected a successful product payload");
    }

    expect(productsPayload.data.map(product => product.id)).toEqual([fixture.survivingProductId]);

    const groupsResponse = await fetch(`${currentContext.baseUrl}/api/shops/${fixture.shopId}/products/groups`, {
      headers: { cookie },
    });
    expect(groupsResponse.status).toBe(200);

    const groupsPayload = await readJson<ProductGroupListApiResponse>(groupsResponse);
    expect(groupsPayload.ok).toBe(true);
    if (!groupsPayload.ok) {
      throw new Error("expected a successful product group payload");
    }

    expect(groupsPayload.data.map(group => group.id)).toEqual([fixture.groupId]);

    const deletedOnlyPainPointsResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&productGroupId=${fixture.deletedOnlyGroupId}&mode=historical`,
      { headers: { cookie } },
    );
    expect(deletedOnlyPainPointsResponse.status).toBe(200);

    const deletedOnlyPainPointsPayload = await readJson<PainPointListApiResponse>(deletedOnlyPainPointsResponse);
    expect(deletedOnlyPainPointsPayload).toEqual({
      ok: true,
      data: [],
    });

    const statsResponse = await fetch(`${currentContext.baseUrl}/api/stats/overview?shopId=${fixture.shopId}`, {
      headers: { cookie },
    });
    expect(statsResponse.status).toBe(200);

    const statsPayload = await readJson<StatsApiResponse>(statsResponse);
    expect(statsPayload.ok).toBe(true);
    if (!statsPayload.ok) {
      throw new Error("expected a successful stats payload");
    }

    expect(statsPayload.data.totalReviews).toBe(1);
    expect(statsPayload.data.painPoints.historical).toBe(1);

    const afterPainPointsResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&productGroupId=${fixture.groupId}&mode=historical`,
      { headers: { cookie } },
    );
    expect(afterPainPointsResponse.status).toBe(200);

    const afterPainPointsPayload = await readJson<PainPointListApiResponse>(afterPainPointsResponse);
    expect(afterPainPointsPayload.ok).toBe(true);
    if (!afterPainPointsPayload.ok) {
      throw new Error("expected a successful pain point payload");
    }

    expect(afterPainPointsPayload.data).toHaveLength(1);
    expect(afterPainPointsPayload.data[0]?.occurrenceCount).toBe(1);
    expect(afterPainPointsPayload.data[0]?.topEvidence).toHaveLength(1);
    expect(afterPainPointsPayload.data[0]?.topEvidence?.[0]?.reviewId).toBe(fixture.survivingReviewId);

    const rebuiltPainPointId = afterPainPointsPayload.data[0]?.id;
    expect(rebuiltPainPointId).toBeTruthy();

    const evidenceResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points/${rebuiltPainPointId}/evidence?shopId=${fixture.shopId}`,
      { headers: { cookie } },
    );
    expect(evidenceResponse.status).toBe(200);

    const evidencePayload = await readJson<PainPointEvidenceApiResponse>(evidenceResponse);
    expect(evidencePayload.ok).toBe(true);
    if (!evidencePayload.ok) {
      throw new Error("expected a successful evidence payload");
    }

    expect(evidencePayload.data).toHaveLength(1);
    expect(evidencePayload.data[0]?.reviewId).toBe(fixture.survivingReviewId);

    const specStatsResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points/${rebuiltPainPointId}/spec-stats?shopId=${fixture.shopId}`,
      { headers: { cookie } },
    );
    expect(specStatsResponse.status).toBe(200);

    const specStatsPayload = await readJson<SpecStatApiResponse>(specStatsResponse);
    expect(specStatsPayload).toEqual({
      ok: true,
      data: [{ spec: fixture.survivingSpec, count: 1 }],
    });
  });

  it("keeps auth login responsive while upload analysis runs in a worker", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedQueuedUploadFixture(currentContext);

    process.env.ANALYZE_WORKER_ENTRY = path.join(process.cwd(), "server", "jobs", "testWorker.ts");
    process.env.ANALYZE_WORKER_BLOCK_MS = "1200";
    process.env.ANALYZE_WORKER_STARTED_FILE = currentContext.testWorkerStartedPath;

    currentContext.analyzeQueue.enqueueUpload(fixture.uploadId);
    await waitForFile(currentContext.testWorkerStartedPath);

    const startedAt = Date.now();
    const response = await fetch(`${currentContext.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: currentContext.env.APP_PASSWORD }),
    });
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(elapsedMs).toBeLessThan(1000);
  }, 10000);

  it("marks a running upload as failed when canceled", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedQueuedUploadFixture(currentContext);

    process.env.ANALYZE_WORKER_ENTRY = path.join(process.cwd(), "server", "jobs", "testWorker.ts");
    process.env.ANALYZE_WORKER_DELAY_MS = "3000";
    process.env.ANALYZE_WORKER_STARTED_FILE = currentContext.testWorkerStartedPath;

    currentContext.analyzeQueue.enqueueUpload(fixture.uploadId);
    await waitForFile(currentContext.testWorkerStartedPath);

    expect(currentContext.analyzeQueue.cancel(String(fixture.uploadId))).toBe(true);
    await waitForUploadStatus(currentContext, fixture.uploadId, "failed");

    const [upload] = await currentContext.db
      .select({
        error: currentContext.schema.uploads.error,
        status: currentContext.schema.uploads.status,
      })
      .from(currentContext.schema.uploads)
      .where(eq(currentContext.schema.uploads.id, fixture.uploadId))
      .limit(1);

    expect(upload?.status).toBe("failed");
    expect(upload?.error).toContain("已取消");
  }, 10000);

  it("deletes a queued upload before analysis starts without recreating reviews", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedQueuedUploadFixture(currentContext);
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);
    const blocker = createDeferred<void>();

    currentContext.analyzeQueue.enqueue({
      id: `block-${fixture.uploadId}`,
      run: async () => {
        await blocker.promise;
      },
    });

    currentContext.analyzeQueue.enqueueUpload(fixture.uploadId);

    const deleteResponse = await fetch(`${currentContext.baseUrl}/api/uploads/${fixture.uploadId}?shopId=${fixture.shopId}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleteResponse.status).toBe(200);

    blocker.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));

    const uploadsResponse = await fetch(`${currentContext.baseUrl}/api/uploads?shopId=${fixture.shopId}`, {
      headers: { cookie },
    });
    expect(uploadsResponse.status).toBe(200);

    const uploadsPayload = await readJson<UploadListApiResponse>(uploadsResponse);
    expect(uploadsPayload).toEqual({
      ok: true,
      data: [],
    });

    const reviewsResponse = await fetch(
      `${currentContext.baseUrl}/api/reviews?shopId=${fixture.shopId}&productGroupId=${fixture.groupId}&page=1&pageSize=20`,
      { headers: { cookie } },
    );
    expect(reviewsResponse.status).toBe(200);

    const reviewsPayload = await readJson<ReviewListApiResponse>(reviewsResponse);
    expect(reviewsPayload.ok).toBe(true);
    if (!reviewsPayload.ok) {
      throw new Error("expected a successful review payload");
    }

    expect(reviewsPayload.data.total).toBe(0);

    const painPointsResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&productGroupId=${fixture.groupId}&mode=historical`,
      { headers: { cookie } },
    );
    expect(painPointsResponse.status).toBe(200);

    const painPointsPayload = await readJson<PainPointListApiResponse>(painPointsResponse);
    expect(painPointsPayload).toEqual({
      ok: true,
      data: [],
    });

    expect(fs.existsSync(fixture.uploadPath)).toBe(false);
  });

  it("derives concise short names and reuses product groups during upload analysis", async () => {
    const currentContext = requireContext(context);
    const [shop] = await currentContext.db
      .insert(currentContext.schema.shops)
      .values({ name: "Auto grouping shop" })
      .returning({ id: currentContext.schema.shops.id });

    const uploadPath = path.join(currentContext.env.UPLOADS_DIR, "auto-grouping.xlsx");
    fs.mkdirSync(currentContext.env.UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(uploadPath, "placeholder");

    const [upload] = await currentContext.db
      .insert(currentContext.schema.uploads)
      .values({
        shopId: shop.id,
        originalFilename: "auto-grouping.xlsx",
        storedPath: uploadPath,
        status: "queued",
      })
      .returning({ id: currentContext.schema.uploads.id });

    const parseExcelSpy = vi.spyOn(await import("../jobs/parseExcel"), "parseExcel").mockReturnValue([
      {
        orderId: "order-1",
        productId: "product-1",
        productName: "山西纯碱烤馍传统特产手工健康小花卷养胃干馍馒头馍片早餐零食",
        productSpec: "原味",
        rating: 5,
        level: "好评",
        content: "味道还行",
        appendContent: null,
        reviewTime: 1_710_000_001,
        appendTime: null,
        userNick: "A",
        merchantReplied: false,
        replyContent: null,
        shopExternalId: null,
        shopName: null,
      },
      {
        orderId: "order-2",
        productId: "product-2",
        productName: "山西纯碱烤馍传统特产手工健康小花卷养胃干馍馒头馍片早餐零食礼盒装",
        productSpec: "芝麻味",
        rating: 4,
        level: "好评",
        content: "偏硬",
        appendContent: null,
        reviewTime: 1_710_000_002,
        appendTime: null,
        userNick: "B",
        merchantReplied: false,
        replyContent: null,
        shopExternalId: null,
        shopName: null,
      },
      {
        orderId: "order-3",
        productId: "product-3",
        productName: "香葱牛轧饼干牛乳夹心葱香苏打饼干咸甜酥脆Q软拉丝休闲零食",
        productSpec: "葱香味",
        rating: 4,
        level: "好评",
        content: "有点贵",
        appendContent: null,
        reviewTime: 1_710_000_003,
        appendTime: null,
        userNick: "C",
        merchantReplied: false,
        replyContent: null,
        shopExternalId: null,
        shopName: null,
      },
    ]);

    try {
      await currentContext.analyzeUpload(upload.id);
    } finally {
      parseExcelSpy.mockRestore();
    }

    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const productsResponse = await fetch(`${currentContext.baseUrl}/api/shops/${shop.id}/products`, {
      headers: { cookie },
    });
    expect(productsResponse.status).toBe(200);

    const productsPayload = await readJson<ProductListApiResponse>(productsResponse);
    expect(productsPayload.ok).toBe(true);
    if (!productsPayload.ok) {
      throw new Error("expected a successful product payload");
    }

    expect(productsPayload.data).toHaveLength(3);
    expect(productsPayload.data.map(item => item.shortName).sort()).toEqual([
      "烤馍",
      "烤馍",
      "香葱牛轧饼干",
    ]);

    const uniqueGroupIds = new Set(productsPayload.data.map(item => item.productGroupId));
    expect(uniqueGroupIds.size).toBe(2);

    const groupsResponse = await fetch(`${currentContext.baseUrl}/api/shops/${shop.id}/products/groups`, {
      headers: { cookie },
    });
    expect(groupsResponse.status).toBe(200);

    const groupsPayload = await readJson<ProductGroupListApiResponse>(groupsResponse);
    expect(groupsPayload.ok).toBe(true);
    if (!groupsPayload.ok) {
      throw new Error("expected a successful product group payload");
    }

    expect(groupsPayload.data.map(group => group.shortName).sort()).toEqual(["烤馍", "香葱牛轧饼干"]);
    expect(groupsPayload.data.map(group => group.name).sort()).toEqual(["烤馍", "香葱牛轧饼干"]);
  });
});

interface SeededPainPointBundle {
  painPointId: number;
  reviewId: number;
  shopId: number;
}

interface SeededQueuedUploadFixture {
  groupId: number;
  shopId: number;
  uploadId: number;
  uploadPath: string;
}

interface SeededUploadDeleteFixture {
  deletedOnlyGroupId: number;
  deletedOnlyProductId: number;
  deletedUploadId: number;
  deletedUploadPath: string;
  groupId: number;
  shopId: number;
  survivingProductId: number;
  survivingReviewId: number;
  survivingSpec: string;
  survivingUploadId: number;
  survivingUploadPath: string;
}

interface DeletePayload {
  deleted: boolean;
  id: number;
}

interface DeleteApiResponse {
  ok: boolean;
  data: DeletePayload;
}

interface UploadItem {
  id: number;
  originalFilename?: string;
}

interface UploadDetailApiResponse {
  ok: boolean;
  data: UploadItem;
}

interface UploadListApiResponse {
  ok: boolean;
  data: UploadItem[];
}

interface ProductListItem {
  id: number;
  productGroupId: number | null;
  shortName: string | null;
}

interface ProductListApiResponse {
  ok: boolean;
  data: ProductListItem[];
}

interface ProductGroupListItem {
  id: number;
  name: string;
  shortName: string;
}

interface ProductGroupListApiResponse {
  ok: boolean;
  data: ProductGroupListItem[];
}

interface StatsPayload {
  totalReviews: number;
  painPoints: {
    historical: number;
    new7d: number;
  };
}

interface StatsApiResponse {
  ok: boolean;
  data: StatsPayload;
}

interface ReviewListItem {
  id: number;
}

interface ReviewListPayload {
  items: ReviewListItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface ReviewListApiResponse {
  ok: boolean;
  data: ReviewListPayload;
}

interface PainPointEvidenceApiItem {
  reviewId: number;
}

interface PainPointEvidenceApiResponse {
  ok: boolean;
  data: PainPointEvidenceApiItem[];
}

interface PainPointListItem {
  id: number;
  occurrenceCount: number;
  topEvidence?: PainPointEvidenceApiItem[];
}

interface PainPointListApiResponse {
  ok: boolean;
  data: PainPointListItem[];
}

interface SpecStatPayload {
  count: number;
  spec: string;
}

interface SpecStatApiResponse {
  ok: boolean;
  data: SpecStatPayload[];
}

function requireContext(context: TestContext | undefined): TestContext {
  if (!context) {
    throw new Error("expected test context to be initialized");
  }

  return context;
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(currentResolve => {
    resolve = currentResolve;
  });

  return { promise, resolve };
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 20));
  }

  throw new Error(`timed out waiting for ${filePath}`);
}

async function waitForUploadStatus(context: TestContext, uploadId: number, expectedStatus: string): Promise<void> {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    const [upload] = await context.db
      .select({ status: context.schema.uploads.status })
      .from(context.schema.uploads)
      .where(eq(context.schema.uploads.id, uploadId))
      .limit(1);

    if (upload?.status === expectedStatus) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 20));
  }

  throw new Error(`timed out waiting for upload ${uploadId} to reach ${expectedStatus}`);
}

async function setupTestContext(): Promise<TestContext> {
  const dataDir = path.join(os.tmpdir(), `doudian-review-insight-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const testWorkerStartedPath = path.join(dataDir, "worker-started.txt");

  process.env.NODE_ENV = "test";
  process.env.DATA_DIR = dataDir;
  process.env.APP_PASSWORD = "test-password-123";
  process.env.SESSION_SECRET = "12345678901234567890123456789012";
  process.env.OPENAI_API_KEY = "";
  delete process.env.ANALYZE_WORKER_ENTRY;
  delete process.env.ANALYZE_WORKER_BLOCK_MS;
  delete process.env.ANALYZE_WORKER_DELAY_MS;
  delete process.env.ANALYZE_WORKER_STARTED_FILE;

  vi.resetModules();

  const [{ createApp }, dbClient, schema, painPointAggregation, envModule, queueModule, analyzeModule] = await Promise.all([
    import("../index"),
    import("../db/client"),
    import("../db/schema"),
    import("../services/painPointAggregation"),
    import("../env"),
    import("../jobs/queue"),
    import("../jobs/analyze"),
  ]);

  await dbClient.initializeDatabase();
  await migrate(dbClient.db, { migrationsFolder: "./drizzle" });

  const server = createServer(createApp());
  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected a TCP server address");
  }

  return {
    analyzeQueue: queueModule.analyzeQueue,
    analyzeReviews: painPointAggregation.analyzeReviews,
    analyzeUpload: analyzeModule.analyzeUpload,
    baseUrl: `http://127.0.0.1:${address.port}`,
    db: dbClient.db,
    env: envModule.env,
    schema,
    server,
    testWorkerStartedPath,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function login(baseUrl: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  expect(response.status).toBe(200);

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("expected auth login to return a session cookie");
  }

  return setCookie.split(";", 1)[0] ?? setCookie;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function seedPainPointBundle(context: TestContext, suffix: string): Promise<SeededPainPointBundle> {
  const now = 1_710_000_000 + suffix.charCodeAt(0);
  const [shop] = await context.db
    .insert(context.schema.shops)
    .values({ name: `Shop ${suffix}` })
    .returning({ id: context.schema.shops.id });

  const [group] = await context.db
    .insert(context.schema.productGroups)
    .values({
      shopId: shop.id,
      name: `Group ${suffix}`,
      shortName: `group-${suffix.toLowerCase()}`,
      updatedAt: now,
    })
    .returning({ id: context.schema.productGroups.id });

  const [product] = await context.db
    .insert(context.schema.products)
    .values({
      shopId: shop.id,
      productGroupId: group.id,
      doudianProductId: `product-${suffix}`,
      rawName: `测试商品 ${suffix}`,
      shortName: `group-${suffix.toLowerCase()}`,
      classificationSource: "auto",
      classificationLocked: false,
      updatedAt: now,
    })
    .returning({ id: context.schema.products.id });

  const [review] = await context.db
    .insert(context.schema.reviews)
    .values({
      shopId: shop.id,
      productRefId: product.id,
      productGroupId: group.id,
      doudianOrderId: `order-${suffix}`,
      doudianProductId: `product-${suffix}`,
      productName: `测试商品 ${suffix}`,
      productSpec: `${suffix} 规格`,
      content: `${suffix} 商品碎了`,
      reviewTime: now,
      merchantReplied: false,
    })
    .returning({ id: context.schema.reviews.id });

  const [painPoint] = await context.db
    .insert(context.schema.painPoints)
    .values({
      shopId: shop.id,
      productRefId: product.id,
      productGroupId: group.id,
      canonicalLabel: "包装破损",
      category: "质量",
      firstSeenAt: now,
      lastSeenAt: now,
      occurrenceCount: 1,
      source: "rule",
      status: "active",
    })
    .returning({ id: context.schema.painPoints.id });

  await context.db.insert(context.schema.painPointEvidence).values({
    painPointId: painPoint.id,
    reviewId: review.id,
    excerpt: "碎了",
  });

  await context.db.insert(context.schema.painPointSpecStats).values({
    painPointId: painPoint.id,
    productSpec: `${suffix} 规格`,
    count: 1,
  });

  return {
    painPointId: painPoint.id,
    reviewId: review.id,
    shopId: shop.id,
  };
}

async function seedUploadDeleteFixture(context: TestContext): Promise<SeededUploadDeleteFixture> {
  const now = 1_710_200_000;
  const [shop] = await context.db
    .insert(context.schema.shops)
    .values({ name: "Upload Delete Fixture Shop" })
    .returning({ id: context.schema.shops.id });

  const [sharedGroup] = await context.db
    .insert(context.schema.productGroups)
    .values({
      shopId: shop.id,
      name: "Upload Shared Group",
      shortName: "upload-shared-group",
      updatedAt: now,
    })
    .returning({ id: context.schema.productGroups.id });

  const [deletedOnlyGroup] = await context.db
    .insert(context.schema.productGroups)
    .values({
      shopId: shop.id,
      name: "Deleted Only Group",
      shortName: "deleted-only-group",
      updatedAt: now,
    })
    .returning({ id: context.schema.productGroups.id });

  const [firstProduct] = await context.db
    .insert(context.schema.products)
    .values({
      shopId: shop.id,
      productGroupId: sharedGroup.id,
      doudianProductId: "upload-delete-me",
      rawName: "待删除批次商品",
      shortName: "upload-shared-group",
      classificationSource: "auto",
      classificationLocked: false,
      updatedAt: now,
    })
    .returning({ id: context.schema.products.id });

  const [secondProduct] = await context.db
    .insert(context.schema.products)
    .values({
      shopId: shop.id,
      productGroupId: sharedGroup.id,
      doudianProductId: "upload-keep-me",
      rawName: "保留批次商品",
      shortName: "upload-shared-group",
      classificationSource: "auto",
      classificationLocked: false,
      updatedAt: now,
    })
    .returning({ id: context.schema.products.id });

  const [deletedOnlyProduct] = await context.db
    .insert(context.schema.products)
    .values({
      shopId: shop.id,
      productGroupId: deletedOnlyGroup.id,
      doudianProductId: "upload-delete-only",
      rawName: "仅删除批次商品",
      shortName: "deleted-only-group",
      classificationSource: "auto",
      classificationLocked: false,
      updatedAt: now,
    })
    .returning({ id: context.schema.products.id });

  const uploadsDir = context.env.UPLOADS_DIR;
  fs.mkdirSync(uploadsDir, { recursive: true });
  const deletedUploadPath = path.join(uploadsDir, "delete-batch.xlsx");
  const survivingUploadPath = path.join(uploadsDir, "keep-batch.xlsx");
  fs.writeFileSync(deletedUploadPath, "delete upload fixture");
  fs.writeFileSync(survivingUploadPath, "surviving upload fixture");

  const uploadRows = await context.db
    .insert(context.schema.uploads)
    .values([
      {
        shopId: shop.id,
        originalFilename: "delete-batch.xlsx",
        storedPath: deletedUploadPath,
        fileHash: "delete-batch-hash",
        fileSize: 10,
        status: "done",
      },
      {
        shopId: shop.id,
        originalFilename: "keep-batch.xlsx",
        storedPath: survivingUploadPath,
        fileHash: "keep-batch-hash",
        fileSize: 11,
        status: "done",
      },
    ])
    .returning({ id: context.schema.uploads.id, storedPath: context.schema.uploads.storedPath });

  const [deletedUpload, survivingUpload] = uploadRows;
  if (!deletedUpload || !survivingUpload) {
    throw new Error("expected seeded uploads to be created");
  }

  const reviewRows = await context.db
    .insert(context.schema.reviews)
    .values([
      {
        shopId: shop.id,
        productRefId: firstProduct.id,
        productGroupId: sharedGroup.id,
        uploadId: deletedUpload.id,
        doudianOrderId: "upload-order-delete",
        doudianProductId: "upload-delete-me",
        productName: "待删除批次商品",
        productSpec: "删除规格",
        content: "包装碎了，整盒都坏了",
        reviewTime: now,
        merchantReplied: false,
      },
      {
        shopId: shop.id,
        productRefId: deletedOnlyProduct.id,
        productGroupId: deletedOnlyGroup.id,
        uploadId: deletedUpload.id,
        doudianOrderId: "upload-order-delete-only",
        doudianProductId: "upload-delete-only",
        productName: "仅删除批次商品",
        productSpec: "独占规格",
        content: "这一批只有它，收到时严重破损",
        reviewTime: now + 1,
        merchantReplied: false,
      },
      {
        shopId: shop.id,
        productRefId: secondProduct.id,
        productGroupId: sharedGroup.id,
        uploadId: survivingUpload.id,
        doudianOrderId: "upload-order-keep",
        doudianProductId: "upload-keep-me",
        productName: "保留批次商品",
        productSpec: "保留批次规格",
        content: "收到时碎了，但是还能看出另一批还在",
        reviewTime: now + 2,
        merchantReplied: false,
      },
    ])
    .returning();

  await context.analyzeReviews(reviewRows);

  const survivingReview = reviewRows.find(review => review.uploadId === survivingUpload.id);
  if (!survivingReview) {
    throw new Error("expected to find the surviving upload review row");
  }

  return {
    deletedOnlyGroupId: deletedOnlyGroup.id,
    deletedOnlyProductId: deletedOnlyProduct.id,
    deletedUploadId: deletedUpload.id,
    deletedUploadPath,
    groupId: sharedGroup.id,
    shopId: shop.id,
    survivingProductId: secondProduct.id,
    survivingReviewId: survivingReview.id,
    survivingSpec: "保留批次规格",
    survivingUploadId: survivingUpload.id,
    survivingUploadPath,
  };
}

async function seedQueuedUploadFixture(context: TestContext): Promise<SeededQueuedUploadFixture> {
  const now = 1_710_300_000;
  const [shop] = await context.db
    .insert(context.schema.shops)
    .values({ name: "Queued Upload Fixture Shop" })
    .returning({ id: context.schema.shops.id });

  const [group] = await context.db
    .insert(context.schema.productGroups)
    .values({
      shopId: shop.id,
      name: "Queued Upload Group",
      shortName: "queued-upload-group",
      updatedAt: now,
    })
    .returning({ id: context.schema.productGroups.id });

  const uploadsDir = context.env.UPLOADS_DIR;
  fs.mkdirSync(uploadsDir, { recursive: true });
  const uploadPath = path.join(uploadsDir, "queued-delete.xlsx");
  fs.writeFileSync(uploadPath, "queued upload fixture");

  const [upload] = await context.db
    .insert(context.schema.uploads)
    .values({
      shopId: shop.id,
      originalFilename: "queued-delete.xlsx",
      storedPath: uploadPath,
      fileHash: "queued-delete-hash",
      fileSize: 12,
      status: "queued",
    })
    .returning({ id: context.schema.uploads.id });

  return {
    groupId: group.id,
    shopId: shop.id,
    uploadId: upload.id,
    uploadPath,
  };
}
