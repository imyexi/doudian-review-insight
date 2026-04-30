import fs from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PainPointCategory } from "@shared/types";
import type { LlmPainPointCandidate } from "../jobs/llm";

const { extractProductNamesMock, extractPainPointsMock } = vi.hoisted(() => ({
  extractProductNamesMock: vi.fn(async () => ({} as Record<string, string>)),
  extractPainPointsMock: vi.fn(async () => ({} as Record<number, LlmPainPointCandidate[]>)),
}));

vi.mock("../jobs/llm", () => ({
  extractPainPointsWithLlm: extractPainPointsMock,
}));

vi.mock("../jobs/llmProductName", () => ({
  extractProductNamesWithLlm: extractProductNamesMock,
}));

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
    extractProductNamesMock.mockReset();
    extractProductNamesMock.mockResolvedValue({});
    extractPainPointsMock.mockReset();
    extractPainPointsMock.mockResolvedValue({});
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

  it("filters cross-shop evidence out of pain-point summaries", async () => {
    const currentContext = requireContext(context);
    const shopA = await seedPainPointBundle(currentContext, "A");
    const shopB = await seedPainPointBundle(currentContext, "B");
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    await currentContext.db.insert(currentContext.schema.painPointEvidence).values({
      painPointId: shopA.painPointId,
      reviewId: shopB.reviewId,
      excerpt: "cross-shop leak",
    });

    const response = await fetch(
      `${currentContext.baseUrl}/api/pain-points?shopId=${shopA.shopId}&mode=historical`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);

    const payload = await readJson<PainPointListApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful pain point payload");
    }

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.recent7dOccurrenceCount).toBe(0);
    expect(payload.data[0]?.topEvidence).toHaveLength(1);
    expect(payload.data[0]?.topEvidence?.[0]?.reviewId).toBe(shopA.reviewId);
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

  it("ignores cross-shop evidence rows when listing reviews for a pain point", async () => {
    const currentContext = requireContext(context);
    const shopA = await seedPainPointBundle(currentContext, "A");
    const shopB = await seedPainPointBundle(currentContext, "B");
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    await currentContext.db.insert(currentContext.schema.painPointEvidence).values({
      painPointId: shopA.painPointId,
      reviewId: shopB.reviewId,
      excerpt: "cross-shop leak",
    });

    const response = await fetch(
      `${currentContext.baseUrl}/api/reviews?shopId=${shopA.shopId}&painPointId=${shopA.painPointId}&page=1&pageSize=20`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);

    const payload = await readJson<ReviewListApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful review payload");
    }

    expect(payload.data.total).toBe(1);
    expect(payload.data.items).toHaveLength(1);
    expect(payload.data.items[0]?.id).toBe(shopA.reviewId);
  });

  it("applies painPointId with productGroupId filters without leaking unrelated reviews", async () => {
    const currentContext = requireContext(context);
    const shopA = await seedPainPointBundle(currentContext, "A");
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const [otherGroup] = await currentContext.db
      .insert(currentContext.schema.productGroups)
      .values({
        shopId: shopA.shopId,
        name: "Other Group A",
        shortName: "other-group-a",
        updatedAt: 1_710_000_500,
      })
      .returning({ id: currentContext.schema.productGroups.id });

    const [otherProduct] = await currentContext.db
      .insert(currentContext.schema.products)
      .values({
        shopId: shopA.shopId,
        productGroupId: otherGroup.id,
        doudianProductId: "product-a-other",
        rawName: "测试商品 A 其他组",
        shortName: "other-group-a",
        classificationSource: "auto",
        classificationLocked: false,
        updatedAt: 1_710_000_500,
      })
      .returning({ id: currentContext.schema.products.id });

    await currentContext.db.insert(currentContext.schema.reviews).values({
      shopId: shopA.shopId,
      productRefId: otherProduct.id,
      productGroupId: otherGroup.id,
      doudianOrderId: "order-a-other",
      doudianProductId: "product-a-other",
      productName: "测试商品 A 其他组",
      productSpec: "其他规格",
      content: "同店其他组的评论",
      reviewTime: 1_710_000_501,
      merchantReplied: false,
    });

    const matchingResponse = await fetch(
      `${currentContext.baseUrl}/api/reviews?shopId=${shopA.shopId}&painPointId=${shopA.painPointId}&productGroupId=${shopA.productGroupId}&page=1&pageSize=20`,
      { headers: { cookie } },
    );
    expect(matchingResponse.status).toBe(200);

    const matchingPayload = await readJson<ReviewListApiResponse>(matchingResponse);
    expect(matchingPayload.ok).toBe(true);
    if (!matchingPayload.ok) {
      throw new Error("expected a successful review payload");
    }

    expect(matchingPayload.data.total).toBe(1);
    expect(matchingPayload.data.items).toHaveLength(1);
    expect(matchingPayload.data.items[0]?.id).toBe(shopA.reviewId);

    const mismatchedResponse = await fetch(
      `${currentContext.baseUrl}/api/reviews?shopId=${shopA.shopId}&painPointId=${shopA.painPointId}&productGroupId=${otherGroup.id}&page=1&pageSize=20`,
      { headers: { cookie } },
    );
    expect(mismatchedResponse.status).toBe(200);
    expect(await readJson<ReviewListApiResponse>(mismatchedResponse)).toEqual({
      ok: true,
      data: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      },
    });
  });

  it("applies painPointId with productRefId filters without leaking sibling products", async () => {
    const currentContext = requireContext(context);
    const shopA = await seedPainPointBundle(currentContext, "A");
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const [siblingProduct] = await currentContext.db
      .insert(currentContext.schema.products)
      .values({
        shopId: shopA.shopId,
        productGroupId: shopA.productGroupId,
        doudianProductId: "product-a-sibling",
        rawName: "测试商品 A 同组兄弟款",
        shortName: "group-a",
        classificationSource: "auto",
        classificationLocked: false,
        updatedAt: 1_710_000_600,
      })
      .returning({ id: currentContext.schema.products.id });

    await currentContext.db.insert(currentContext.schema.reviews).values({
      shopId: shopA.shopId,
      productRefId: siblingProduct.id,
      productGroupId: shopA.productGroupId,
      doudianOrderId: "order-a-sibling",
      doudianProductId: "product-a-sibling",
      productName: "测试商品 A 同组兄弟款",
      productSpec: "同组规格",
      content: "同组兄弟商品评论",
      reviewTime: 1_710_000_601,
      merchantReplied: false,
    });

    const matchingResponse = await fetch(
      `${currentContext.baseUrl}/api/reviews?shopId=${shopA.shopId}&painPointId=${shopA.painPointId}&productRefId=${shopA.productRefId}&page=1&pageSize=20`,
      { headers: { cookie } },
    );
    expect(matchingResponse.status).toBe(200);

    const matchingPayload = await readJson<ReviewListApiResponse>(matchingResponse);
    expect(matchingPayload.ok).toBe(true);
    if (!matchingPayload.ok) {
      throw new Error("expected a successful review payload");
    }

    expect(matchingPayload.data.total).toBe(1);
    expect(matchingPayload.data.items).toHaveLength(1);
    expect(matchingPayload.data.items[0]?.id).toBe(shopA.reviewId);

    const siblingResponse = await fetch(
      `${currentContext.baseUrl}/api/reviews?shopId=${shopA.shopId}&painPointId=${shopA.painPointId}&productRefId=${siblingProduct.id}&page=1&pageSize=20`,
      { headers: { cookie } },
    );
    expect(siblingResponse.status).toBe(200);
    expect(await readJson<ReviewListApiResponse>(siblingResponse)).toEqual({
      ok: true,
      data: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
      },
    });
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
    expect(productsPayload.data.every(item => item.llmExtractedName === null)).toBe(true);

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

  it("skips llm product-name extraction when the toggle is disabled", async () => {
    const currentContext = requireContext(context);
    const [shop] = await currentContext.db
      .insert(currentContext.schema.shops)
      .values({ name: "Rules Only Shop" })
      .returning({ id: currentContext.schema.shops.id });

    const uploadPath = path.join(currentContext.env.UPLOADS_DIR, "rules-only-upload.xlsx");
    fs.mkdirSync(currentContext.env.UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(uploadPath, "placeholder");

    const [upload] = await currentContext.db
      .insert(currentContext.schema.uploads)
      .values({
        shopId: shop.id,
        originalFilename: "rules-only-upload.xlsx",
        storedPath: uploadPath,
        status: "queued",
      })
      .returning({ id: currentContext.schema.uploads.id });

    await currentContext.db.insert(currentContext.schema.analysisSettings).values({
      id: 1,
      analysisMode: "hybrid",
      openaiBaseUrl: "http://example.com/openai/v1",
      openaiApiKey: "test-key",
      openaiModel: "test-model",
      llmBatchSize: 20,
      llmMaxConcurrency: 2,
      llmProductNameEnabled: false,
      updatedAt: 1_710_100_000,
    });

    const parseExcelSpy = vi.spyOn(await import("../jobs/parseExcel"), "parseExcel").mockReturnValue([
      {
        orderId: "rules-order-1",
        productId: "rules-product-1",
        productName: "美康粉黛轻透防晒乳50g SPF50+",
        productSpec: "标准装",
        rating: 5,
        level: "好评",
        content: null,
        appendContent: null,
        reviewTime: 1_710_100_001,
        appendTime: null,
        userNick: "Rule",
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

    expect(extractProductNamesMock).not.toHaveBeenCalled();

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

    expect(productsPayload.data).toHaveLength(1);
    expect(productsPayload.data[0]?.llmExtractedName).toBeNull();
  });

  it("persists llm-extracted product names when the toggle is enabled", async () => {
    const currentContext = requireContext(context);
    const [shop] = await currentContext.db
      .insert(currentContext.schema.shops)
      .values({ name: "LLM Product Name Shop" })
      .returning({ id: currentContext.schema.shops.id });

    const uploadPath = path.join(currentContext.env.UPLOADS_DIR, "llm-product-name-upload.xlsx");
    fs.mkdirSync(currentContext.env.UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(uploadPath, "placeholder");

    const [upload] = await currentContext.db
      .insert(currentContext.schema.uploads)
      .values({
        shopId: shop.id,
        originalFilename: "llm-product-name-upload.xlsx",
        storedPath: uploadPath,
        status: "queued",
      })
      .returning({ id: currentContext.schema.uploads.id });

    await currentContext.db.insert(currentContext.schema.analysisSettings).values({
      id: 1,
      analysisMode: "hybrid",
      openaiBaseUrl: "http://example.com/openai/v1",
      openaiApiKey: "test-key",
      openaiModel: "test-model",
      llmBatchSize: 20,
      llmMaxConcurrency: 2,
      llmProductNameEnabled: true,
      updatedAt: 1_710_100_100,
    });

    const parseExcelSpy = vi.spyOn(await import("../jobs/parseExcel"), "parseExcel").mockReturnValue([
      {
        orderId: "llm-order-1",
        productId: "llm-product-1",
        productName: "美康粉黛轻透防晒乳50g SPF50+",
        productSpec: "标准装",
        rating: 5,
        level: "好评",
        content: null,
        appendContent: null,
        reviewTime: 1_710_100_101,
        appendTime: null,
        userNick: "LLM",
        merchantReplied: false,
        replyContent: null,
        shopExternalId: null,
        shopName: null,
      },
    ]);
    extractProductNamesMock.mockResolvedValue({ "llm-product-1": "轻透防晒乳" });

    try {
      await currentContext.analyzeUpload(upload.id);
    } finally {
      parseExcelSpy.mockRestore();
    }

    expect(extractProductNamesMock).toHaveBeenCalledTimes(1);

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

    expect(productsPayload.data).toHaveLength(1);
    expect(productsPayload.data[0]?.llmExtractedName).toBe("轻透防晒乳");
    expect(productsPayload.data[0]?.shortName).toBe("轻透防晒乳");
  });

  it("rejects continue for a done upload with 409", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedUploadDeleteFixture(currentContext);
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const response = await fetch(
      `${currentContext.baseUrl}/api/uploads/${fixture.survivingUploadId}/continue?shopId=${fixture.shopId}`,
      { method: "POST", headers: { cookie } },
    );
    expect(response.status).toBe(409);
  });

  it("rejects continue for a cross-shop upload with 404", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedUploadDeleteFixture(currentContext);
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const [otherShop] = await currentContext.db
      .insert(currentContext.schema.shops)
      .values({ name: "Other Shop Continue" })
      .returning({ id: currentContext.schema.shops.id });

    const response = await fetch(
      `${currentContext.baseUrl}/api/uploads/${fixture.survivingUploadId}/continue?shopId=${otherShop.id}`,
      { method: "POST", headers: { cookie } },
    );
    expect(response.status).toBe(404);
  });

  it("rejects continue when the source file is missing", async () => {
    const currentContext = requireContext(context);
    const [shop] = await currentContext.db
      .insert(currentContext.schema.shops)
      .values({ name: "Missing File Shop" })
      .returning({ id: currentContext.schema.shops.id });

    const [upload] = await currentContext.db
      .insert(currentContext.schema.uploads)
      .values({
        shopId: shop.id,
        originalFilename: "missing.xlsx",
        storedPath: "/nonexistent/missing.xlsx",
        status: "failed",
        error: "network error",
        finishedAt: 1_710_000_100,
      })
      .returning({ id: currentContext.schema.uploads.id });

    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);
    const response = await fetch(
      `${currentContext.baseUrl}/api/uploads/${upload.id}/continue?shopId=${shop.id}`,
      { method: "POST", headers: { cookie } },
    );
    expect(response.status).toBe(409);
  });

  it("continues a failed upload by cleaning partial data and re-enqueuing analysis", async () => {
    const currentContext = requireContext(context);
    const [shop] = await currentContext.db
      .insert(currentContext.schema.shops)
      .values({ name: "Continue Analysis Shop" })
      .returning({ id: currentContext.schema.shops.id });

    const uploadPath = path.join(currentContext.env.UPLOADS_DIR, "continue-analysis.xlsx");
    fs.mkdirSync(currentContext.env.UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(uploadPath, "placeholder");

    const [upload] = await currentContext.db
      .insert(currentContext.schema.uploads)
      .values({
        shopId: shop.id,
        originalFilename: "continue-analysis.xlsx",
        storedPath: uploadPath,
        status: "failed",
        error: "network timeout",
        finishedAt: 1_710_400_000,
        progressCurrent: 5,
        progressTotal: 10,
        rowCount: 10,
      })
      .returning({ id: currentContext.schema.uploads.id });

    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);
    const response = await fetch(
      `${currentContext.baseUrl}/api/uploads/${upload.id}/continue?shopId=${shop.id}`,
      { method: "POST", headers: { cookie } },
    );
    expect(response.status).toBe(200);

    const payload = await readJson<UploadDetailApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful upload payload");
    }

    expect(payload.data.status).toBe("queued");
    expect(payload.data.error).toBeNull();
    expect(payload.data.finishedAt).toBeNull();
  });

  it("cleans partial reviews and products when continuing a failed upload", async () => {
    const currentContext = requireContext(context);
    const [shop] = await currentContext.db
      .insert(currentContext.schema.shops)
      .values({ name: "Clean Partial Shop" })
      .returning({ id: currentContext.schema.shops.id });

    const [group] = await currentContext.db
      .insert(currentContext.schema.productGroups)
      .values({
        shopId: shop.id,
        name: "Partial Group",
        shortName: "partial-group",
        updatedAt: 1_710_500_000,
      })
      .returning({ id: currentContext.schema.productGroups.id });

    const [product] = await currentContext.db
      .insert(currentContext.schema.products)
      .values({
        shopId: shop.id,
        productGroupId: group.id,
        doudianProductId: "partial-product",
        rawName: "部分导入商品",
        shortName: "partial-group",
        classificationSource: "auto",
        classificationLocked: false,
        updatedAt: 1_710_500_000,
      })
      .returning({ id: currentContext.schema.products.id });

    const uploadPath = path.join(currentContext.env.UPLOADS_DIR, "clean-partial.xlsx");
    fs.mkdirSync(currentContext.env.UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(uploadPath, "placeholder");

    const [upload] = await currentContext.db
      .insert(currentContext.schema.uploads)
      .values({
        shopId: shop.id,
        originalFilename: "clean-partial.xlsx",
        storedPath: uploadPath,
        status: "failed",
        error: "connection reset",
        finishedAt: 1_710_500_100,
      })
      .returning({ id: currentContext.schema.uploads.id });

    await currentContext.db.insert(currentContext.schema.reviews).values({
      shopId: shop.id,
      productRefId: product.id,
      productGroupId: group.id,
      uploadId: upload.id,
      doudianOrderId: "partial-order-1",
      doudianProductId: "partial-product",
      productName: "部分导入商品",
      productSpec: "标准",
      content: "包装破损",
      reviewTime: 1_710_500_001,
      merchantReplied: false,
    });

    await currentContext.analyzeReviews(
      await currentContext.db
        .select()
        .from(currentContext.schema.reviews)
        .where(eq(currentContext.schema.reviews.shopId, shop.id)),
    );

    const beforePainPoints = await currentContext.db
      .select({ id: currentContext.schema.painPoints.id })
      .from(currentContext.schema.painPoints)
      .where(eq(currentContext.schema.painPoints.shopId, shop.id));
    expect(beforePainPoints.length).toBeGreaterThan(0);

    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);
    const continueResponse = await fetch(
      `${currentContext.baseUrl}/api/uploads/${upload.id}/continue?shopId=${shop.id}`,
      { method: "POST", headers: { cookie } },
    );
    expect(continueResponse.status).toBe(200);

    const remainingReviews = await currentContext.db
      .select({ id: currentContext.schema.reviews.id })
      .from(currentContext.schema.reviews)
      .where(eq(currentContext.schema.reviews.uploadId, upload.id));
    expect(remainingReviews).toHaveLength(0);

    const remainingPainPoints = await currentContext.db
      .select({ id: currentContext.schema.painPoints.id })
      .from(currentContext.schema.painPoints)
      .where(eq(currentContext.schema.painPoints.shopId, shop.id));
    expect(remainingPainPoints).toHaveLength(0);
  });

  it("merges thin texture label variants into one pain point", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedLlmPainPointLabelFixture(currentContext, ["质地过稀", "质地偏稀"]);
    extractPainPointsMock.mockResolvedValue({
      [fixture.reviewIds[0]]: [createLlmPainPointCandidate("质地过稀", "使用体验")],
      [fixture.reviewIds[1]]: [createLlmPainPointCandidate("质地偏稀", "使用体验")],
    });

    await currentContext.analyzeReviews(
      await currentContext.db
        .select()
        .from(currentContext.schema.reviews)
        .where(eq(currentContext.schema.reviews.shopId, fixture.shopId)),
    );

    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);
    const response = await fetch(`${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&mode=historical`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);

    const payload = await readJson<PainPointListApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful pain point payload");
    }

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.canonicalLabel).toBe("质地偏稀");
    expect(payload.data[0]?.occurrenceCount).toBe(2);
    expect(payload.data[0]?.topEvidence).toHaveLength(2);
  });

  it("merges thin texture wording variants into one pain point", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedLlmPainPointLabelFixture(currentContext, ["质地稀薄", "质地偏稀"]);
    extractPainPointsMock.mockResolvedValue({
      [fixture.reviewIds[0]]: [createLlmPainPointCandidate("质地稀薄", "使用体验")],
      [fixture.reviewIds[1]]: [createLlmPainPointCandidate("质地偏稀", "使用体验")],
    });

    await currentContext.analyzeReviews(
      await currentContext.db
        .select()
        .from(currentContext.schema.reviews)
        .where(eq(currentContext.schema.reviews.shopId, fixture.shopId)),
    );

    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);
    const response = await fetch(`${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&mode=historical`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);

    const payload = await readJson<PainPointListApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful pain point payload");
    }

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.canonicalLabel).toBe("质地偏稀");
    expect(payload.data[0]?.occurrenceCount).toBe(2);
    expect(payload.data[0]?.topEvidence).toHaveLength(2);
  });

  it("merges expensive price label variants into one pain point", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedLlmPainPointLabelFixture(currentContext, ["价格偏高", "价格偏贵"]);
    extractPainPointsMock.mockResolvedValue({
      [fixture.reviewIds[0]]: [createLlmPainPointCandidate("价格偏高", "价格")],
      [fixture.reviewIds[1]]: [createLlmPainPointCandidate("价格偏贵", "价格")],
    });

    await currentContext.analyzeReviews(
      await currentContext.db
        .select()
        .from(currentContext.schema.reviews)
        .where(eq(currentContext.schema.reviews.shopId, fixture.shopId)),
    );

    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);
    const response = await fetch(`${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&mode=historical`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);

    const payload = await readJson<PainPointListApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful pain point payload");
    }

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.canonicalLabel).toBe("价格偏高");
    expect(payload.data[0]?.occurrenceCount).toBe(2);
    expect(payload.data[0]?.topEvidence).toHaveLength(2);
  });

  it("deduplicates synonymous labels from the same review", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedLlmPainPointLabelFixture(currentContext, ["质地偏稀"]);
    extractPainPointsMock.mockResolvedValue({
      [fixture.reviewIds[0]]: [
        createLlmPainPointCandidate("质地过稀", "使用体验"),
        createLlmPainPointCandidate("质地偏稀", "使用体验"),
      ],
    });

    await currentContext.analyzeReviews(
      await currentContext.db
        .select()
        .from(currentContext.schema.reviews)
        .where(eq(currentContext.schema.reviews.shopId, fixture.shopId)),
    );

    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);
    const response = await fetch(`${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&mode=historical`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);

    const payload = await readJson<PainPointListApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful pain point payload");
    }

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.occurrenceCount).toBe(1);
    expect(payload.data[0]?.topEvidence).toHaveLength(1);
  });

  it("keeps unrelated pain point labels separate", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedLlmPainPointLabelFixture(currentContext, ["价格偏高", "物流太慢"]);
    extractPainPointsMock.mockResolvedValue({
      [fixture.reviewIds[0]]: [createLlmPainPointCandidate("价格偏高", "价格")],
      [fixture.reviewIds[1]]: [createLlmPainPointCandidate("物流太慢", "物流")],
    });

    await currentContext.analyzeReviews(
      await currentContext.db
        .select()
        .from(currentContext.schema.reviews)
        .where(eq(currentContext.schema.reviews.shopId, fixture.shopId)),
    );

    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);
    const response = await fetch(`${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&mode=historical`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);

    const payload = await readJson<PainPointListApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful pain point payload");
    }

    expect(payload.data).toHaveLength(2);
    expect(payload.data.map(item => item.canonicalLabel).sort()).toEqual(["价格偏高", "物流太慢"]);
  });

  it("filters overview top pain points by a single sentiment", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedSentimentSearchFixture(currentContext);
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const response = await fetch(
      `${currentContext.baseUrl}/api/stats/overview?shopId=${fixture.shopId}&sentiment=negative`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);

    const payload = await readJson<StatsApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful stats payload");
    }

    expect(payload.data.topPainPoints).toHaveLength(1);
    expect(payload.data.topPainPoints.map(item => item.sentiment)).toEqual(["negative"]);
    expect(payload.data.topPainPoints[0]?.canonicalLabel).toBe("包装压坏");
  });

  it("filters overview top pain points by multiple sentiments", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedSentimentSearchFixture(currentContext);
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const response = await fetch(
      `${currentContext.baseUrl}/api/stats/overview?shopId=${fixture.shopId}&sentiment=negative&sentiment=neutral`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);

    const payload = await readJson<StatsApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful stats payload");
    }

    expect(payload.data.topPainPoints).toHaveLength(2);
    expect(payload.data.topPainPoints.map(item => item.sentiment).sort()).toEqual(["negative", "neutral"]);
  });

  it("filters pain-point list by sentiment", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedSentimentSearchFixture(currentContext);
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const response = await fetch(
      `${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&mode=historical&sentiment=neutral`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);

    const payload = await readJson<PainPointListApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful pain point payload");
    }

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.id).toBe(fixture.neutralPainPointId);
    expect(payload.data[0]?.sentiment).toBe("neutral");
  });

  it("filters noteworthy pain points by sentiment", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedSentimentSearchFixture(currentContext);
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const response = await fetch(
      `${currentContext.baseUrl}/api/pain-points/noteworthy?shopId=${fixture.shopId}&sentiment=positive`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);

    const payload = await readJson<PainPointListApiResponse>(response);
    expect(payload.ok).toBe(true);
    if (!payload.ok) {
      throw new Error("expected a successful pain point payload");
    }

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0]?.id).toBe(fixture.positivePainPointId);
    expect(payload.data[0]?.sentiment).toBe("positive");
  });

  it("matches pain-point search against review and evidence text", async () => {
    const currentContext = requireContext(context);
    const fixture = await seedSentimentSearchFixture(currentContext);
    const cookie = await login(currentContext.baseUrl, currentContext.env.APP_PASSWORD);

    const reviewContentResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&mode=historical&q=${fixture.reviewContentToken}`,
      { headers: { cookie } },
    );
    expect(reviewContentResponse.status).toBe(200);
    const reviewContentPayload = await readJson<PainPointListApiResponse>(reviewContentResponse);
    expect(reviewContentPayload.ok).toBe(true);
    if (!reviewContentPayload.ok) {
      throw new Error("expected a successful pain point payload");
    }
    expect(reviewContentPayload.data.map(item => item.id)).toEqual([fixture.negativePainPointId]);

    const appendResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&mode=historical&q=${fixture.appendToken}`,
      { headers: { cookie } },
    );
    expect(appendResponse.status).toBe(200);
    const appendPayload = await readJson<PainPointListApiResponse>(appendResponse);
    expect(appendPayload.ok).toBe(true);
    if (!appendPayload.ok) {
      throw new Error("expected a successful pain point payload");
    }
    expect(appendPayload.data.map(item => item.id)).toEqual([fixture.neutralPainPointId]);

    const productNameResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&mode=historical&q=${fixture.productNameToken}`,
      { headers: { cookie } },
    );
    expect(productNameResponse.status).toBe(200);
    const productNamePayload = await readJson<PainPointListApiResponse>(productNameResponse);
    expect(productNamePayload.ok).toBe(true);
    if (!productNamePayload.ok) {
      throw new Error("expected a successful pain point payload");
    }
    expect(productNamePayload.data.map(item => item.id)).toEqual([fixture.positivePainPointId]);

    const productSpecResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&mode=historical&q=${fixture.productSpecToken}`,
      { headers: { cookie } },
    );
    expect(productSpecResponse.status).toBe(200);
    const productSpecPayload = await readJson<PainPointListApiResponse>(productSpecResponse);
    expect(productSpecPayload.ok).toBe(true);
    if (!productSpecPayload.ok) {
      throw new Error("expected a successful pain point payload");
    }
    expect(productSpecPayload.data.map(item => item.id)).toEqual([fixture.positivePainPointId]);

    const excerptResponse = await fetch(
      `${currentContext.baseUrl}/api/pain-points?shopId=${fixture.shopId}&mode=historical&q=${fixture.excerptToken}`,
      { headers: { cookie } },
    );
    expect(excerptResponse.status).toBe(200);
    const excerptPayload = await readJson<PainPointListApiResponse>(excerptResponse);
    expect(excerptPayload.ok).toBe(true);
    if (!excerptPayload.ok) {
      throw new Error("expected a successful pain point payload");
    }
    expect(excerptPayload.data.map(item => item.id)).toEqual([fixture.positivePainPointId]);
  });
});

interface SeededSentimentSearchFixture {
  appendToken: string;
  excerptToken: string;
  negativePainPointId: number;
  neutralPainPointId: number;
  positivePainPointId: number;
  productNameToken: string;
  productSpecToken: string;
  reviewContentToken: string;
  shopId: number;
}

interface SeededLlmPainPointLabelFixture {
  reviewIds: number[];
  shopId: number;
}

interface SeededPainPointBundle {
  painPointId: number;
  productGroupId: number;
  productRefId: number;
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
  error?: string | null;
  finishedAt?: number | null;
  originalFilename?: string;
  status?: string;
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
  llmExtractedName: string | null;
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

interface StatsTopPainPointItem {
  canonicalLabel: string;
  category: string;
  sentiment: string;
  occurrenceCount: number;
}

interface StatsPayload {
  totalReviews: number;
  painPoints: {
    historical: number;
    new7d: number;
  };
  topPainPoints: StatsTopPainPointItem[];
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
  canonicalLabel?: string;
  occurrenceCount: number;
  recent7dOccurrenceCount: number;
  sentiment?: string;
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

function createLlmPainPointCandidate(canonicalLabel: string, category: PainPointCategory): LlmPainPointCandidate {
  return {
    canonicalLabel,
    category,
    sentiment: "negative",
    specificityScore: 4,
    excerpt: canonicalLabel,
    source: "llm",
  };
}

async function seedLlmPainPointLabelFixture(
  context: TestContext,
  labels: string[],
): Promise<SeededLlmPainPointLabelFixture> {
  const now = 1_710_500_000;
  const [shop] = await context.db
    .insert(context.schema.shops)
    .values({ name: "LLM Pain Point Label Shop" })
    .returning({ id: context.schema.shops.id });

  const [group] = await context.db
    .insert(context.schema.productGroups)
    .values({
      shopId: shop.id,
      name: "LLM Pain Point Label Group",
      shortName: "llm-pain-point-label-group",
      updatedAt: now,
    })
    .returning({ id: context.schema.productGroups.id });

  const [product] = await context.db
    .insert(context.schema.products)
    .values({
      shopId: shop.id,
      productGroupId: group.id,
      doudianProductId: "llm-pain-point-label-product",
      rawName: "聚类测试商品",
      shortName: "llm-pain-point-label-group",
      classificationSource: "auto",
      classificationLocked: false,
      updatedAt: now,
    })
    .returning({ id: context.schema.products.id });

  await context.db.insert(context.schema.analysisSettings).values({
    id: 1,
    analysisMode: "llm_only",
    openaiBaseUrl: "http://example.com/openai/v1",
    openaiApiKey: "test-key",
    openaiModel: "test-model",
    llmBatchSize: 20,
    llmMaxConcurrency: 2,
    llmProductNameEnabled: false,
    updatedAt: now,
  });

  const reviewRows = await context.db
    .insert(context.schema.reviews)
    .values(labels.map((label, index) => ({
      shopId: shop.id,
      productRefId: product.id,
      productGroupId: group.id,
      doudianOrderId: `llm-label-order-${index}`,
      doudianProductId: "llm-pain-point-label-product",
      productName: "聚类测试商品",
      productSpec: "标准装",
      content: `这次反馈是${label}`,
      appendContent: null,
      reviewTime: now + index,
      merchantReplied: false,
    })))
    .returning({ id: context.schema.reviews.id });

  return {
    reviewIds: reviewRows.map(item => item.id),
    shopId: shop.id,
  };
}

async function seedSentimentSearchFixture(context: TestContext): Promise<SeededSentimentSearchFixture> {
  const now = 1_710_600_000;
  const appendToken = "APPEND_ONLY_HIT";
  const excerptToken = "EXCERPT_ONLY_HIT";
  const productNameToken = "NAME_ONLY_HIT";
  const productSpecToken = "SPEC_ONLY_HIT";
  const reviewContentToken = "CONTENT_ONLY_HIT";

  const [shop] = await context.db
    .insert(context.schema.shops)
    .values({ name: "Sentiment Search Shop" })
    .returning({ id: context.schema.shops.id });

  const [group] = await context.db
    .insert(context.schema.productGroups)
    .values({
      shopId: shop.id,
      name: "Sentiment Search Group",
      shortName: "sentiment-search-group",
      updatedAt: now,
    })
    .returning({ id: context.schema.productGroups.id });

  const productRows = await context.db
    .insert(context.schema.products)
    .values([
      {
        shopId: shop.id,
        productGroupId: group.id,
        doudianProductId: "sentiment-negative-product",
        rawName: "负向测试商品",
        shortName: "sentiment-search-group",
        classificationSource: "auto",
        classificationLocked: false,
        updatedAt: now,
      },
      {
        shopId: shop.id,
        productGroupId: group.id,
        doudianProductId: "sentiment-neutral-product",
        rawName: "中性测试商品",
        shortName: "sentiment-search-group",
        classificationSource: "auto",
        classificationLocked: false,
        updatedAt: now + 1,
      },
      {
        shopId: shop.id,
        productGroupId: group.id,
        doudianProductId: "sentiment-positive-product",
        rawName: "正向测试商品",
        shortName: "sentiment-search-group",
        classificationSource: "auto",
        classificationLocked: false,
        updatedAt: now + 2,
      },
    ])
    .returning({ id: context.schema.products.id, doudianProductId: context.schema.products.doudianProductId });

  const negativeProduct = productRows.find(item => item.doudianProductId === "sentiment-negative-product");
  const neutralProduct = productRows.find(item => item.doudianProductId === "sentiment-neutral-product");
  const positiveProduct = productRows.find(item => item.doudianProductId === "sentiment-positive-product");
  if (!negativeProduct || !neutralProduct || !positiveProduct) {
    throw new Error("expected sentiment fixture products to be created");
  }

  const reviewRows = await context.db
    .insert(context.schema.reviews)
    .values([
      {
        shopId: shop.id,
        productRefId: negativeProduct.id,
        productGroupId: group.id,
        doudianOrderId: "sentiment-order-negative",
        doudianProductId: negativeProduct.doudianProductId,
        productName: "负向测试商品",
        productSpec: "NEGATIVE_SPEC",
        content: `包装被压坏 ${reviewContentToken}`,
        appendContent: null,
        reviewTime: now,
        merchantReplied: false,
      },
      {
        shopId: shop.id,
        productRefId: neutralProduct.id,
        productGroupId: group.id,
        doudianOrderId: "sentiment-order-neutral",
        doudianProductId: neutralProduct.doudianProductId,
        productName: "中性测试商品",
        productSpec: "NEUTRAL_SPEC",
        content: "先看看后续表现",
        appendContent: `后续补充 ${appendToken}`,
        reviewTime: now + 1,
        appendTime: now + 2,
        merchantReplied: false,
      },
      {
        shopId: shop.id,
        productRefId: positiveProduct.id,
        productGroupId: group.id,
        doudianOrderId: "sentiment-order-positive",
        doudianProductId: positiveProduct.doudianProductId,
        productName: `回购爆款 ${productNameToken}`,
        productSpec: productSpecToken,
        content: "口感很好",
        appendContent: null,
        reviewTime: now + 3,
        merchantReplied: false,
      },
    ])
    .returning({ id: context.schema.reviews.id, doudianOrderId: context.schema.reviews.doudianOrderId });

  const negativeReview = reviewRows.find(item => item.doudianOrderId === "sentiment-order-negative");
  const neutralReview = reviewRows.find(item => item.doudianOrderId === "sentiment-order-neutral");
  const positiveReview = reviewRows.find(item => item.doudianOrderId === "sentiment-order-positive");
  if (!negativeReview || !neutralReview || !positiveReview) {
    throw new Error("expected sentiment fixture reviews to be created");
  }

  const painPointRows = await context.db
    .insert(context.schema.painPoints)
    .values([
      {
        shopId: shop.id,
        productRefId: negativeProduct.id,
        productGroupId: group.id,
        canonicalLabel: "包装压坏",
        category: "质量",
        sentiment: "negative",
        description: "物流挤压导致包装破损",
        firstSeenAt: now,
        lastSeenAt: now,
        occurrenceCount: 1,
        specificityScore: 4,
        source: "rule",
        status: "active",
        createdAt: now,
      },
      {
        shopId: shop.id,
        productRefId: neutralProduct.id,
        productGroupId: group.id,
        canonicalLabel: "观望后续表现",
        category: "使用体验",
        sentiment: "neutral",
        description: "当前评价偏中性，等待后续使用反馈",
        firstSeenAt: now + 1,
        lastSeenAt: now + 1,
        occurrenceCount: 1,
        specificityScore: 3,
        source: "rule",
        status: "active",
        createdAt: now + 1,
      },
      {
        shopId: shop.id,
        productRefId: positiveProduct.id,
        productGroupId: group.id,
        canonicalLabel: "值得回购",
        category: "使用体验",
        sentiment: "positive",
        description: "正向反馈明显，适合重点展示",
        firstSeenAt: now + 3,
        lastSeenAt: now + 3,
        occurrenceCount: 1,
        specificityScore: 5,
        source: "rule",
        status: "active",
        createdAt: now + 3,
      },
    ])
    .returning({ id: context.schema.painPoints.id, canonicalLabel: context.schema.painPoints.canonicalLabel });

  const negativePainPoint = painPointRows.find(item => item.canonicalLabel === "包装压坏");
  const neutralPainPoint = painPointRows.find(item => item.canonicalLabel === "观望后续表现");
  const positivePainPoint = painPointRows.find(item => item.canonicalLabel === "值得回购");
  if (!negativePainPoint || !neutralPainPoint || !positivePainPoint) {
    throw new Error("expected sentiment fixture pain points to be created");
  }

  await context.db.insert(context.schema.painPointEvidence).values([
    {
      painPointId: negativePainPoint.id,
      reviewId: negativeReview.id,
      excerpt: "外盒被挤扁",
      specificityScore: 4,
      createdAt: now,
    },
    {
      painPointId: neutralPainPoint.id,
      reviewId: neutralReview.id,
      excerpt: "先用一段时间再说",
      specificityScore: 3,
      createdAt: now + 1,
    },
    {
      painPointId: positivePainPoint.id,
      reviewId: positiveReview.id,
      excerpt: excerptToken,
      specificityScore: 5,
      createdAt: now + 3,
    },
  ]);

  await context.db.insert(context.schema.painPointSpecStats).values([
    {
      painPointId: negativePainPoint.id,
      productSpec: "NEGATIVE_SPEC",
      count: 1,
    },
    {
      painPointId: neutralPainPoint.id,
      productSpec: "NEUTRAL_SPEC",
      count: 1,
    },
    {
      painPointId: positivePainPoint.id,
      productSpec: productSpecToken,
      count: 1,
    },
  ]);

  return {
    appendToken,
    excerptToken,
    negativePainPointId: negativePainPoint.id,
    neutralPainPointId: neutralPainPoint.id,
    positivePainPointId: positivePainPoint.id,
    productNameToken,
    productSpecToken,
    reviewContentToken,
    shopId: shop.id,
  };
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
    productGroupId: group.id,
    productRefId: product.id,
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
