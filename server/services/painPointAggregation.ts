import { and, eq, inArray, sql } from "drizzle-orm";
import type { AnalysisMode, PainPointCategory, PainPointSource, Sentiment } from "@shared/types";
import { db } from "../db/client";
import {
  painPointEvidence,
  painPointSpecStats,
  painPoints,
  reviews,
  type ReviewRow,
} from "../db/schema";
import { extractPainPointsWithLlm } from "../jobs/llm";
import { findRuleMatches } from "../jobs/rules";
import { getAnalysisRuntimeSettings } from "../utils/analysisSettings";

export interface Candidate {
  canonicalLabel: string;
  category: PainPointCategory;
  sentiment: Sentiment;
  specificityScore: number | null;
  excerpt: string;
  source: PainPointSource;
}

const LABEL_SYNONYM_REPLACEMENTS: Array<[RegExp, string]> = [
  [/质地稀薄/g, "质地偏稀"],
  [/质地(?:过|偏|太|很|较)?稀/g, "质地偏稀"],
  [/价格(?:偏|过|太|很|较)?(?:高|贵)/g, "价格偏高"],
];

function normalizeLabel(value: string): string {
  const compactLabel = value.replace(/\s+/g, "").trim().toLowerCase();
  return LABEL_SYNONYM_REPLACEMENTS.reduce(
    (currentLabel, [pattern, replacement]) => currentLabel.replace(pattern, replacement),
    compactLabel,
  );
}

function normalizeCandidateLabel(candidate: Candidate): Candidate {
  const normalizedLabel = normalizeLabel(candidate.canonicalLabel);
  if (candidate.canonicalLabel === normalizedLabel) {
    return candidate;
  }

  return {
    ...candidate,
    canonicalLabel: normalizedLabel,
  };
}

function shouldUseLlm(mode: AnalysisMode): boolean {
  return mode === "llm_only" || mode === "hybrid";
}

export function getReviewText(review: Pick<ReviewRow, "content" | "appendContent">): string {
  return [review.content, review.appendContent].filter(Boolean).join("\n").trim();
}

function mergeSentiment(current: Sentiment, next: Sentiment): Sentiment {
  if (current === next) {
    return current;
  }

  if (current === "negative" || next === "negative") {
    return "negative";
  }

  if (current === "positive" || next === "positive") {
    return "positive";
  }

  return "neutral";
}

function mergeSpecificityScore(current: number | null, next: number | null): number | null {
  if (current === null) {
    return next;
  }

  if (next === null) {
    return current;
  }

  return Math.max(current, next);
}

function choosePreferredCandidate(current: Candidate, next: Candidate): Candidate {
  const currentSpecificity = current.specificityScore ?? 0;
  const nextSpecificity = next.specificityScore ?? 0;

  if (nextSpecificity > currentSpecificity) {
    return next;
  }

  if (nextSpecificity < currentSpecificity) {
    return current;
  }

  if (current.source !== "llm" && next.source === "llm") {
    return next;
  }

  return current;
}

function mergeCandidateLists(candidates: Candidate[]): Candidate[] {
  const mergedCandidates = candidates.reduce<Record<string, Candidate>>((current, candidate) => {
    const normalizedCandidate = normalizeCandidateLabel(candidate);
    const candidateKey = normalizedCandidate.canonicalLabel;
    const existing = current[candidateKey];
    if (!existing) {
      return {
        ...current,
        [candidateKey]: normalizedCandidate,
      };
    }

    const preferredCandidate = choosePreferredCandidate(existing, normalizedCandidate);

    return {
      ...current,
      [candidateKey]: {
        ...preferredCandidate,
        canonicalLabel: candidateKey,
        sentiment: mergeSentiment(existing.sentiment, normalizedCandidate.sentiment),
        specificityScore: mergeSpecificityScore(existing.specificityScore, normalizedCandidate.specificityScore),
        source: existing.source === normalizedCandidate.source ? preferredCandidate.source : "merged",
      },
    };
  }, {});

  return Object.values(mergedCandidates);
}

export function getCandidatesForReview(
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
  const reviewLlmCandidates = llmCandidates[review.id] ?? [];
  return mergeCandidateLists([...ruleCandidates, ...reviewLlmCandidates]);
}

async function upsertPainPoint(
  review: Pick<ReviewRow, "id" | "shopId" | "productRefId" | "productGroupId" | "productSpec" | "reviewTime">,
  candidate: Candidate,
): Promise<void> {
  if (review.productGroupId === null) {
    return;
  }

  const normalizedLabel = normalizeLabel(candidate.canonicalLabel);
  const existingRows = await db
    .select()
    .from(painPoints)
    .where(and(eq(painPoints.shopId, review.shopId), eq(painPoints.productGroupId, review.productGroupId)));

  const existing = existingRows.find(item => normalizeLabel(item.canonicalLabel) === normalizedLabel);

  let painPointId: number;

  if (existing) {
    painPointId = existing.id;
    await db
      .update(painPoints)
      .set({
        productRefId: existing.productRefId ?? review.productRefId,
        lastSeenAt: Math.max(existing.lastSeenAt, review.reviewTime),
        firstSeenAt: Math.min(existing.firstSeenAt, review.reviewTime),
        occurrenceCount: existing.occurrenceCount + 1,
        sentiment: mergeSentiment(existing.sentiment as Sentiment, candidate.sentiment),
        specificityScore: mergeSpecificityScore(existing.specificityScore, candidate.specificityScore),
        source: existing.source === candidate.source ? existing.source : "merged",
      })
      .where(eq(painPoints.id, existing.id));
  } else {
    const [created] = await db
      .insert(painPoints)
      .values({
        shopId: review.shopId,
        productRefId: review.productRefId,
        productGroupId: review.productGroupId,
        canonicalLabel: candidate.canonicalLabel,
        category: candidate.category,
        sentiment: candidate.sentiment,
        firstSeenAt: review.reviewTime,
        lastSeenAt: review.reviewTime,
        occurrenceCount: 1,
        specificityScore: candidate.specificityScore,
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
      specificityScore: candidate.specificityScore,
    })
    .onConflictDoNothing();

  if (!review.productSpec) {
    return;
  }

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
    return;
  }

  await db.insert(painPointSpecStats).values({
    painPointId,
    productSpec: review.productSpec,
    count: 1,
  });
}

export async function analyzeReviews(items: ReviewRow[]): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const analysisSettings = await getAnalysisRuntimeSettings();
  const llmCandidates = shouldUseLlm(analysisSettings.analysisMode)
    ? await extractPainPointsWithLlm(
        items
          .filter(review => getReviewText(review).length > 0)
          .map(review => ({
            reviewId: review.id,
            content: getReviewText(review),
          })),
        analysisSettings,
      )
    : {};

  for (const review of items) {
    const combinedCandidates = mergeCandidateLists(getCandidatesForReview(review, analysisSettings.analysisMode, llmCandidates));

    for (const candidate of combinedCandidates) {
      await upsertPainPoint(review, candidate);
    }
  }
}

export async function rebuildPainPointsForProductGroups(shopId: number, groupIds: Array<number | null>): Promise<void> {
  const targetGroupIds = [...new Set(groupIds.filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0))];
  if (targetGroupIds.length === 0) {
    return;
  }

  const existingPainPoints = await db
    .select({ id: painPoints.id })
    .from(painPoints)
    .where(and(eq(painPoints.shopId, shopId), inArray(painPoints.productGroupId, targetGroupIds)));

  if (existingPainPoints.length > 0) {
    await db.delete(painPoints).where(inArray(painPoints.id, existingPainPoints.map(item => item.id)));
  }

  const targetReviews = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.shopId, shopId), inArray(reviews.productGroupId, targetGroupIds)))
    .orderBy(sql`${reviews.reviewTime}`, sql`${reviews.id}`);

  await analyzeReviews(targetReviews);
}
