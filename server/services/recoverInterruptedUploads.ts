import { inArray } from "drizzle-orm";
import { db } from "../db/client";
import { uploads } from "../db/schema";
import { logger } from "../utils/logger";

const RECOVERABLE_ERROR = "分析因服务中断而暂停，可点击继续分析";
const ACTIVE_STATUSES = ["queued", "parsing", "analyzing"] as const;

export async function recoverInterruptedUploads(): Promise<number> {
  const strandedRows = await db
    .select({ id: uploads.id, status: uploads.status })
    .from(uploads)
    .where(inArray(uploads.status, [...ACTIVE_STATUSES]));

  if (strandedRows.length === 0) {
    return 0;
  }

  await db
    .update(uploads)
    .set({
      status: "failed",
      error: RECOVERABLE_ERROR,
      finishedAt: Math.floor(Date.now() / 1000),
    })
    .where(inArray(uploads.status, [...ACTIVE_STATUSES]));

  logger.info(
    { count: strandedRows.length, ids: strandedRows.map(row => row.id) },
    "recovered interrupted uploads on startup",
  );

  return strandedRows.length;
}
