import fs from "node:fs";
import { painPointCategorySchema, type PainPointCategory } from "@shared/types";
import { env } from "../env";

export interface RuleDefinition {
  category: PainPointCategory;
  keywords: string[];
}

export interface RuleMatch {
  canonicalLabel: string;
  category: PainPointCategory;
  sentiment: "negative";
  specificityScore: null;
  excerpt: string;
  source: "rule";
}

let cachedRules: Record<string, RuleDefinition> | null = null;

export function loadRules(): Record<string, RuleDefinition> {
  if (cachedRules) {
    return cachedRules;
  }

  const content = fs.readFileSync(env.RULES_PATH, "utf8");
  const parsed = JSON.parse(content) as Record<string, { category: string; keywords: string[] }>;

  cachedRules = Object.fromEntries(
    Object.entries(parsed).map(([label, definition]) => [
      label,
      {
        category: painPointCategorySchema.parse(definition.category),
        keywords: definition.keywords,
      },
    ]),
  );

  return cachedRules;
}

export function findRuleMatches(content: string): RuleMatch[] {
  const normalized = content.trim();
  if (!normalized) {
    return [];
  }

  return Object.entries(loadRules()).flatMap(([canonicalLabel, definition]) => {
    const matchedKeyword = definition.keywords.find(keyword => normalized.includes(keyword));
    if (!matchedKeyword) {
      return [];
    }

    return [
      {
        canonicalLabel,
        category: definition.category,
        sentiment: "negative" as const,
        specificityScore: null,
        excerpt: matchedKeyword,
        source: "rule" as const,
      },
    ];
  });
}
