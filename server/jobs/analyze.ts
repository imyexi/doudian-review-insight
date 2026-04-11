import { and, eq, sql } from "drizzle-orm";
import type { AnalysisMode, PainPointCategory, PainPointSource } from "@shared/types";
import { db } from "../db/client";
import {
  painPointEvidence,
  painPointSpecStats,
  painPoints,
  products,
  reviews,
  uploads,
  type ReviewRow,
} from "../db/schema";
import { getAnalysisRuntimeSettings } from "../utils/analysisSettings";
import { extractPainPointsWithLlm } from "./llm";
import { parseExcel } from "./parseExcel";
import { findRuleMatches } from "./rules";

interface Candidate {
  canonicalLabel: string;
  category: PainPointCategory;
  excerpt: string;
  source: PainPointSource;
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, "").trim().toLowerCase();
}

function shouldUseLlm(mode: AnalysisMode): boolean {
  return mode === "llm_only" || mode === "hybrid";
}

function getReviewText(review: Pick<ReviewRow, "content" | "appendContent">): string {
  return [review.content, review.appendContent].filter(Boolean).join("\n").trim();
}

function getCandidatesForReview(
  review: Pick<ReviewRow, "id" | "content" | "appendContent">,
  mode: AnalysisMode,
  llmCandidates: Record<number, Candidate[]>,
): Candidate[] {
  const text = getReviewText(review);
  if (!text) {
    return [];
  }

  if (mode === "rules_only") {
    return findRuleMatches(text);
  }

  if (mode === "llm_only") {
    return llmCandidates[review.id] ?? [];
  }

  const ruleCandidates = findRuleMatches(text);
  return ruleCandidates.length > 0 ? ruleCandidates : llmCandidates[review.id] ?? [];
}

async function updateUploadState(
  uploadId: number,
  values: Partial<typeof uploads.$inferInsert>,
): Promise<void> {
  await db.update(uploads).set(values).where(eq(uploads.id, uploadId));
}

async function ensureProduct(shopId: number, row: ReturnType<typeof parseExcel>[number]): Promise<number> {
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.shopId, shopId), eq(products.doudianProductId, row.productId)))
    .limit(1);

  if (existing) {
    await db
      .update(products)
      .set({
        rawName: row.productName,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(products.id, existing.id));
    return existing.id;
  }

  const [created] = await db
    .insert(products)
    .values({
      shopId,
      doudianProductId: row.productId,
      rawName: row.productName,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .returning({ id: products.id });

  return created.id;
}

async function insertReview(
  uploadId: number,
  shopId: number,
  productRefId: number,
  row: ReturnType<typeof parseExcel>[number],
): Promise<number | null> {
  const [created] = await db
    .insert(reviews)
    .values({
      shopId,
      productRefId,
      uploadId,
      doudianOrderId: row.orderId,
      doudianProductId: row.productId,
      productName: row.productName,
      productSpec: row.productSpec,
      rating: row.rating,
      level: row.level,
      content: row.content,
      appendContent: row.appendContent,
      reviewTime: row.reviewTime,
      appendTime: row.appendTime,
      userNick: row.userNick,
      merchantReplied: row.merchantReplied,
      replyContent: row.replyContent,
    })
    .onConflictDoNothing()
    .returning({ id: reviews.id });

  return created?.id ?? null;
}

async function upsertPainPoint(
  review: Pick<ReviewRow, "id" | "shopId" | "productRefId" | "productSpec" | "reviewTime">,
  candidate: Candidate,
): Promise<void> {
  const normalizedLabel = normalizeLabel(candidate.canonicalLabel);

  const existingRows = await db
    .select()
    .from(painPoints)
    .where(
      and(
        eq(painPoints.shopId, review.shopId),
        review.productRefId === null
          ? sql`${painPoints.productRefId} is null`
          : eq(painPoints.productRefId, review.productRefId),
      ),
    );

  const existing = existingRows.find(item => normalizeLabel(item.canonicalLabel) === normalizedLabel);

  let painPointId: number;

  if (existing) {
    painPointId = existing.id;
    await db
      .update(painPoints)
      .set({
        lastSeenAt: Math.max(existing.lastSeenAt, review.reviewTime),
        firstSeenAt: Math.min(existing.firstSeenAt, review.reviewTime),
        occurrenceCount: existing.occurrenceCount + 1,
        source: existing.source === candidate.source ? existing.source : "merged",
      })
      .where(eq(painPoints.id, existing.id));
  } else {
    const [created] = await db
      .insert(painPoints)
      .values({
        shopId: review.shopId,
        productRefId: review.productRefId,
        canonicalLabel: candidate.canonicalLabel,
        category: candidate.category,
        firstSeenAt: review.reviewTime,
        lastSeenAt: review.reviewTime,
        occurrenceCount: 1,
        source: candidate.source,
      })
      .returning({ id: painPoints.id });

    painPointId = created.id;
  }

  await db
    .insert(painPointEvidence)
    .values({
      painPointId,
      reviewId: review.id,
      excerpt: candidate.excerpt,
    })
    .onConflictDoNothing();

  if (review.productSpec) {
    const [stat] = await db
      .select()
      .from(painPointSpecStats)
      .where(and(eq(painPointSpecStats.painPointId, painPointId), eq(painPointSpecStats.productSpec, review.productSpec)))
      .limit(1);

    if (stat) {
      await db
        .update(painPointSpecStats)
        .set({ count: stat.count + 1 })
        .where(eq(painPointSpecStats.id, stat.id));
    } else {
      await db.insert(painPointSpecStats).values({
        painPointId,
        productSpec: review.productSpec,
        count: 1,
      });
    }
  }
}

export async function analyzeUpload(uploadId: number): Promise<void> {
  const [upload] = await db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1);
  if (!upload) {
    throw new Error(`Upload ${uploadId} not found`);
  }

  try {
    await updateUploadState(uploadId, {
      status: "parsing",
      progressCurrent: 0,
    });

    const rows = parseExcel(upload.storedPath);
    await updateUploadState(uploadId, {
      rowCount: rows.length,
      progressTotal: rows.length,
    });

    const insertedReviewIds: number[] = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const productRefId = await ensureProduct(upload.shopId, row);
      const reviewId = await insertReview(uploadId, upload.shopId, productRefId, row);

      if (reviewId) {
        insertedReviewIds.push(reviewId);
      }

      await updateUploadState(uploadId, {
        progressCurrent: index + 1,
      });
    }

    await updateUploadState(uploadId, {
      status: "analyzing",
    });

    const insertedReviews = insertedReviewIds.length
      ? await db.select().from(reviews).where(sql`${reviews.id} in (${sql.join(insertedReviewIds.map(id => sql`${id}`), sql`, `)})`)
      : [];

    const analysisSettings = await getAnalysisRuntimeSettings();
    const llmCandidates = shouldUseLlm(analysisSettings.analysisMode)
      ? await extractPainPointsWithLlm(
          insertedReviews
            .filter(review => getReviewText(review).length > 0 && (analysisSettings.analysisMode === "llm_only" || review.rating === null || review.rating <= 3))
            .map(review => ({
              reviewId: review.id,
              content: getReviewText(review),
            })),
          analysisSettings,
        )
      : {};

    for (const review of insertedReviews) {
      const combinedCandidates = getCandidatesForReview(review, analysisSettings.analysisMode, llmCandidates);

      for (const candidate of combinedCandidates) {
        await upsertPainPoint(review, candidate);
      }
    }

    await updateUploadState(uploadId, {
      status: "done",
      finishedAt: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    await updateUploadState(uploadId, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      finishedAt: Math.floor(Date.now() / 1000),
    });
    throw error;
  }
}
