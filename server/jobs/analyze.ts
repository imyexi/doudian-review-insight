import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { products, reviews, uploads } from "../db/schema";
import { analyzeReviews } from "../services/painPointAggregation";
import { resolveProductGrouping } from "../services/productGrouping";
import { getAnalysisRuntimeSettings } from "../utils/analysisSettings";
import { extractProductNamesWithLlm } from "./llmProductName";
import { parseExcel } from "./parseExcel";
import { analyzeQueue } from "./queue";

async function updateUploadState(
  uploadId: number,
  values: Partial<typeof uploads.$inferInsert>,
): Promise<void> {
  await db.update(uploads).set(values).where(eq(uploads.id, uploadId));
}

function isUploadAnalysisCanceled(uploadId: number): boolean {
  return analyzeQueue.isCanceled(String(uploadId));
}

async function ensureProduct(
  shopId: number,
  row: ReturnType<typeof parseExcel>[number],
  llmExtractedName: string | null,
): Promise<{ productRefId: number; productGroupId: number | null }> {
  const [existing] = await db
    .select()
    .from(products)
    .where(and(eq(products.shopId, shopId), eq(products.doudianProductId, row.productId)))
    .limit(1);

  const grouping = await resolveProductGrouping({
    shopId,
    doudianProductId: row.productId,
    displayName: existing?.displayName ?? null,
    rawName: row.productName,
    shortNameOverride: existing?.classificationLocked ? existing.shortName : null,
    llmShortName: existing?.classificationLocked ? null : llmExtractedName,
  });

  if (existing) {
    const nextProductGroupId = existing.classificationLocked ? existing.productGroupId : grouping.productGroup.id;
    const nextShortName = existing.classificationLocked ? existing.shortName : grouping.shortName;
    const nextClassificationSource = existing.classificationLocked ? existing.classificationSource : grouping.classificationSource;

    await db
      .update(products)
      .set({
        productGroupId: nextProductGroupId,
        rawName: row.productName,
        shortName: nextShortName,
        llmExtractedName: existing.classificationLocked ? existing.llmExtractedName : llmExtractedName,
        classificationSource: nextClassificationSource,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(products.id, existing.id));

    return {
      productRefId: existing.id,
      productGroupId: nextProductGroupId,
    };
  }

  const [created] = await db
    .insert(products)
    .values({
      shopId,
      productGroupId: grouping.productGroup.id,
      doudianProductId: row.productId,
      rawName: row.productName,
      shortName: grouping.shortName,
      llmExtractedName,
      classificationSource: grouping.classificationSource,
      classificationLocked: false,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .returning({ id: products.id, productGroupId: products.productGroupId });

  return {
    productRefId: created.id,
    productGroupId: created.productGroupId,
  };
}

async function insertReview(
  uploadId: number,
  shopId: number,
  productRefId: number,
  productGroupId: number | null,
  row: ReturnType<typeof parseExcel>[number],
): Promise<number | null> {
  const [created] = await db
    .insert(reviews)
    .values({
      shopId,
      productRefId,
      productGroupId,
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

export async function analyzeUpload(uploadId: number): Promise<void> {
  const [upload] = await db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1);
  if (!upload || isUploadAnalysisCanceled(uploadId)) {
    return;
  }

  try {
    await updateUploadState(uploadId, {
      status: "parsing",
      progressCurrent: 0,
    });

    const rows = parseExcel(upload.storedPath);
    if (isUploadAnalysisCanceled(uploadId)) {
      return;
    }

    await updateUploadState(uploadId, {
      rowCount: rows.length,
      progressTotal: rows.length,
    });

    const analysisSettings = await getAnalysisRuntimeSettings();
    const uniqueProducts = rows.reduce<Record<string, string>>((current, row) => {
      if (!row.productId || !row.productName || current[row.productId]) {
        return current;
      }

      return {
        ...current,
        [row.productId]: row.productName,
      };
    }, {});

    const llmProductNames = analysisSettings.analysisMode !== "rules_only" && analysisSettings.llmProductNameEnabled
      ? await extractProductNamesWithLlm(
          Object.entries(uniqueProducts).map(([doudianProductId, rawTitle]) => ({ doudianProductId, rawTitle })),
          analysisSettings,
        )
      : {};

    const insertedReviewIds: number[] = [];

    for (let index = 0; index < rows.length; index += 1) {
      if (isUploadAnalysisCanceled(uploadId)) {
        return;
      }

      const row = rows[index];
      const productMatch = await ensureProduct(upload.shopId, row, llmProductNames[row.productId] ?? null);
      const reviewId = await insertReview(uploadId, upload.shopId, productMatch.productRefId, productMatch.productGroupId, row);

      if (reviewId) {
        insertedReviewIds.push(reviewId);
      }

      await updateUploadState(uploadId, {
        progressCurrent: index + 1,
      });
    }

    if (isUploadAnalysisCanceled(uploadId)) {
      return;
    }

    await updateUploadState(uploadId, {
      status: "analyzing",
    });

    const insertedReviews = insertedReviewIds.length
      ? await db
          .select()
          .from(reviews)
          .where(sql`${reviews.id} in (${sql.join(insertedReviewIds.map(id => sql`${id}`), sql`, `)})`)
      : [];

    if (isUploadAnalysisCanceled(uploadId)) {
      return;
    }

    await analyzeReviews(insertedReviews);

    if (isUploadAnalysisCanceled(uploadId)) {
      return;
    }

    await updateUploadState(uploadId, {
      status: "done",
      finishedAt: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    if (isUploadAnalysisCanceled(uploadId)) {
      return;
    }

    const [existingUpload] = await db.select({ id: uploads.id }).from(uploads).where(eq(uploads.id, uploadId)).limit(1);
    if (!existingUpload) {
      return;
    }

    await updateUploadState(uploadId, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      finishedAt: Math.floor(Date.now() / 1000),
    });
    throw error;
  }
}
