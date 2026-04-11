import "dotenv/config";
import path from "node:path";
import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(5174),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    APP_PASSWORD: z.string().min(12, "APP_PASSWORD 至少 12 位"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET 至少 32 位"),
    DATA_DIR: z.string().default("./data"),
    OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default("gpt-4o-mini"),
    LLM_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
    LLM_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
    RULES_PATH: z.string().default("./server/jobs/rules/zh.json"),
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

const rawEnv = parsed.data;
const dataDir = path.resolve(process.cwd(), rawEnv.DATA_DIR);

export const env = {
  ...rawEnv,
  DATA_DIR: dataDir,
  DB_PATH: path.resolve(dataDir, "app.db"),
  LOG_DIR: path.resolve(dataDir, "logs"),
  UPLOADS_DIR: path.resolve(dataDir, "uploads-tmp"),
  RULES_PATH: path.resolve(process.cwd(), rawEnv.RULES_PATH),
} as const;

export type Env = typeof env;
