import { and, eq } from "drizzle-orm";
import type { ProductClassificationSource } from "@shared/types";
import { db } from "../db/client";
import { productGroups, type ProductGroupRow } from "../db/schema";

const MAX_GROUP_NAME_LENGTH = 120;
const BRACKET_SEGMENT_RE = /[\(（【\[][^\)）】\]]*[\)）】\]]/g;
const MULTIPLIER_RE = /\d+\s*[xX×*]\s*\d+/g;
const SPEC_RE = /\d+(?:\.\d+)?\s*(?:kg|g|克|斤|两|ml|毫升|l|升|片|袋|包|盒|瓶|支|只|个|枚|套|cm|mm)/gi;
const NOISE_RE = /(旗舰店|直播间|专拍|勿拍|赠品|赠送|随机|加购|链接|补差价|拍下备注|官方正品|新包装|家庭装|礼盒装|组合装|体验装|试吃装|升级款|经典款)/g;
const PUNCTUATION_RE = /[|｜丨\/\\,+，、:：;；_\-]+/g;
const WHITESPACE_RE = /\s+/g;
const MAX_PREFIX_WINDOW = 6;

const PRODUCT_SUFFIXES = [
  "牛轧饼干",
  "苏打饼干",
  "夹心饼干",
  "威化饼干",
  "曲奇饼干",
  "夹心酥",
  "沙琪玛",
  "烤馍片",
  "小花卷",
  "蛋黄酥",
  "牛舌饼",
  "桃酥",
  "锅巴",
  "麻花",
  "蛋卷",
  "面包",
  "吐司",
  "蛋糕",
  "饼干",
  "烤馍",
  "馍片",
  "花卷",
  "馒头",
  "干馍",
] as const;

const RETAINABLE_PREFIXES = [
  "咸蛋黄",
  "乳酸菌",
  "巧克力",
  "香葱",
  "葱香",
  "牛乳",
  "奶香",
  "奶盐",
  "黑糖",
  "海苔",
  "芝麻",
  "红枣",
  "椰蓉",
  "抹茶",
  "紫米",
  "红豆",
  "绿豆",
  "山楂",
  "榴莲",
  "蓝莓",
  "草莓",
  "柠檬",
  "酸奶",
  "奶油",
  "黄油",
  "原味",
  "五香",
  "椒盐",
  "香辣",
  "肉松",
] as const;

const LEADING_NOISE_TERMS = [
  "内蒙古",
  "山西",
  "陕西",
  "新疆",
  "山东",
  "河南",
  "河北",
  "老式",
  "传统",
  "特产",
  "手工",
  "纯碱",
  "健康",
  "养胃",
  "怀旧",
  "儿时",
  "办公室",
  "休闲",
  "早餐",
  "零食",
  "糕点",
  "美食",
] as const;

const TRAILING_NOISE_TERMS = [
  "办公室零食",
  "休闲零食",
  "早餐零食",
  "传统特产",
  "咸甜",
  "酥脆",
  "拉丝",
  "q软",
  "健康",
  "养胃",
  "早餐",
  "零食",
  "手工",
  "特产",
] as const;

const CONTAINED_NOISE_TERMS = [
  "办公室",
  "休闲",
  "早餐",
  "零食",
  "糕点",
  "美食",
  "特产",
  "手工",
  "传统",
  "健康",
  "养胃",
] as const;

interface CandidateMatch {
  candidate: string;
  startIndex: number;
  suffix: string;
}

function trimToMaxLength(value: string): string {
  return value.slice(0, MAX_GROUP_NAME_LENGTH).trim();
}

function normalizeSeed(value: string): string {
  const compact = value
    .replace(BRACKET_SEGMENT_RE, " ")
    .replace(MULTIPLIER_RE, " ")
    .replace(SPEC_RE, " ")
    .replace(NOISE_RE, " ")
    .replace(PUNCTUATION_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();

  if (compact) {
    return trimToMaxLength(compact.toLowerCase());
  }

  return trimToMaxLength(value.replace(WHITESPACE_RE, "").trim().toLowerCase());
}

function normalizeGroupName(value: string): string {
  const cleaned = value
    .replace(BRACKET_SEGMENT_RE, " ")
    .replace(MULTIPLIER_RE, " ")
    .replace(SPEC_RE, " ")
    .replace(NOISE_RE, " ")
    .replace(PUNCTUATION_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();

  return trimToMaxLength(cleaned || value.trim());
}

function compactNormalizedText(value: string): string {
  return normalizeSeed(value).replace(WHITESPACE_RE, "");
}

function stripRepeatedTerms(value: string, terms: readonly string[], fromEnd: boolean): string {
  let nextValue = value;

  while (nextValue) {
    const matchedTerm = terms.find(term => fromEnd ? nextValue.endsWith(term) : nextValue.startsWith(term));
    if (!matchedTerm) {
      return nextValue;
    }

    nextValue = fromEnd
      ? nextValue.slice(0, Math.max(0, nextValue.length - matchedTerm.length))
      : nextValue.slice(matchedTerm.length);
  }

  return nextValue;
}

function stripContainedNoise(value: string): string {
  return CONTAINED_NOISE_TERMS.reduce((nextValue, term) => nextValue.replaceAll(term, ""), value);
}

function stripNoise(value: string): string {
  const withoutLeadingNoise = stripRepeatedTerms(value, LEADING_NOISE_TERMS, false);
  const withoutTrailingNoise = stripRepeatedTerms(withoutLeadingNoise, TRAILING_NOISE_TERMS, true);
  return stripContainedNoise(withoutTrailingNoise).trim();
}

function getRetainedPrefix(prefixWindow: string): string {
  const trimmedWindow = stripRepeatedTerms(prefixWindow, LEADING_NOISE_TERMS, false);
  const matchedPrefix = RETAINABLE_PREFIXES.find(prefix => trimmedWindow.endsWith(prefix));
  return matchedPrefix ? matchedPrefix.slice(-Math.min(matchedPrefix.length, MAX_PREFIX_WINDOW)) : "";
}

function collectCandidateMatches(compactText: string): CandidateMatch[] {
  const matches: CandidateMatch[] = [];

  for (const suffix of PRODUCT_SUFFIXES) {
    let matchIndex = compactText.indexOf(suffix);

    while (matchIndex >= 0) {
      const prefixWindow = compactText.slice(Math.max(0, matchIndex - MAX_PREFIX_WINDOW), matchIndex);
      const retainedPrefix = getRetainedPrefix(prefixWindow);
      const candidate = stripNoise(`${retainedPrefix}${suffix}`) || suffix;

      matches.push({
        candidate,
        startIndex: matchIndex,
        suffix,
      });

      matchIndex = compactText.indexOf(suffix, matchIndex + 1);
    }
  }

  return matches;
}

function scoreCandidate(match: CandidateMatch): number {
  const suffixLengthScore = match.suffix.length * 80;
  const retainedPrefixLength = Math.max(0, match.candidate.length - match.suffix.length);
  const retainedPrefixScore = retainedPrefixLength * 12;
  const earlyPositionScore = Math.max(0, 240 - match.startIndex * 24);
  const lengthPenalty = Math.max(0, match.candidate.length - 8) * 10;

  return suffixLengthScore + retainedPrefixScore + earlyPositionScore - lengthPenalty;
}

function compareCandidates(left: CandidateMatch, right: CandidateMatch): number {
  const scoreDifference = scoreCandidate(right) - scoreCandidate(left);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  if (left.startIndex !== right.startIndex) {
    return left.startIndex - right.startIndex;
  }

  if (left.candidate.length !== right.candidate.length) {
    return left.candidate.length - right.candidate.length;
  }

  return right.suffix.length - left.suffix.length;
}

function fallbackShortName(compactText: string): string {
  const strippedText = stripNoise(compactText);
  return trimToMaxLength(strippedText || compactText);
}

function pickGroupingSeed(params: {
  displayName: string | null;
  rawName: string | null;
  doudianProductId: string;
  shortNameOverride?: string | null;
  llmShortName?: string | null;
}): string {
  return [params.shortNameOverride, params.llmShortName, params.displayName, params.rawName, params.doudianProductId]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim() ?? params.doudianProductId;
}

export interface ResolvedProductGrouping {
  classificationSource: ProductClassificationSource;
  productGroup: ProductGroupRow;
  shortName: string;
}

export function extractProductShortName(value: string): string {
  const compactText = compactNormalizedText(value);
  if (!compactText) {
    return trimToMaxLength(normalizeSeed(value));
  }

  const sortedMatches = collectCandidateMatches(compactText).sort(compareCandidates);
  if (sortedMatches.length > 0) {
    return trimToMaxLength(sortedMatches[0].candidate);
  }

  return fallbackShortName(compactText);
}

export async function resolveProductGrouping(params: {
  shopId: number;
  doudianProductId: string;
  displayName: string | null;
  rawName: string | null;
  shortNameOverride?: string | null;
  llmShortName?: string | null;
}): Promise<ResolvedProductGrouping> {
  const seed = pickGroupingSeed(params);
  const shortName = extractProductShortName(seed);
  const groupName = normalizeGroupName(shortName) || shortName;

  const [existingGroup] = await db
    .select()
    .from(productGroups)
    .where(and(eq(productGroups.shopId, params.shopId), eq(productGroups.shortName, shortName)))
    .limit(1);

  if (existingGroup) {
    return {
      classificationSource: "auto",
      productGroup: existingGroup,
      shortName,
    };
  }

  const [createdGroup] = await db
    .insert(productGroups)
    .values({
      shopId: params.shopId,
      name: groupName,
      shortName,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .returning();

  return {
    classificationSource: "auto",
    productGroup: createdGroup,
    shortName,
  };
}
