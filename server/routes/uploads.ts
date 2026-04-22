import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import multer from "multer";
import { and, desc, eq, ne } from "drizzle-orm";
import { Router } from "express";
import { uploadCreateSchema } from "@shared/types";
import { db } from "../db/client";
import { shops, uploads } from "../db/schema";
import { analyzeQueue } from "../jobs/queue";
import { env } from "../env";
import { deleteUploadBatch } from "../services/deleteUploadBatch";
import { recoverUploadBatch } from "../services/recoverUploadBatch";
import { sendError, sendSuccess } from "../utils/http";
import { normalizeUploadedFilename, serializeUpload } from "../utils/uploadFilename";

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    fs.mkdirSync(env.UPLOADS_DIR, { recursive: true });
    callback(null, env.UPLOADS_DIR);
  },
  filename: (_request, file, callback) => {
    const safeName = normalizeUploadedFilename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
    callback(null, `${Date.now()}-${safeName}`);
  },
});

const uploadMiddleware = multer({ storage });

async function createFileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");

  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

function formatUploadTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString("zh-CN", { hour12: false });
}

function parseShopId(value: unknown): number {
  return typeof value === "string" ? Number(value) : Number.NaN;
}

async function shopExists(shopId: number): Promise<boolean> {
  const [shop] = await db.select({ id: shops.id }).from(shops).where(eq(shops.id, shopId)).limit(1);
  return Boolean(shop);
}

export const uploadsRouter = Router();

uploadsRouter.get("/", async (request, response) => {
  const shopId = parseShopId(request.query.shopId);
  if (!Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "店铺 ID 无效", 400);
    return;
  }

  const rows = await db
    .select()
    .from(uploads)
    .where(eq(uploads.shopId, shopId))
    .orderBy(desc(uploads.createdAt), desc(uploads.id));

  sendSuccess(response, rows.map(row => serializeUpload(row)));
});

uploadsRouter.get("/:id", async (request, response) => {
  const uploadId = Number(request.params.id);
  const shopId = parseShopId(request.query.shopId);
  if (!Number.isInteger(uploadId) || uploadId <= 0 || !Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "上传 ID 或店铺 ID 无效", 400);
    return;
  }

  const [row] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, uploadId), eq(uploads.shopId, shopId)))
    .limit(1);
  if (!row) {
    sendError(response, "NOT_FOUND", "上传记录不存在", 404);
    return;
  }

  sendSuccess(response, serializeUpload(row));
});

uploadsRouter.post("/", uploadMiddleware.single("file"), async (request, response) => {
  const parsed = uploadCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    if (request.file?.path) {
      fs.rmSync(request.file.path, { force: true });
    }
    sendError(response, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "上传参数无效", 400);
    return;
  }

  if (!(await shopExists(parsed.data.shopId))) {
    if (request.file?.path) {
      fs.rmSync(request.file.path, { force: true });
    }
    sendError(response, "NOT_FOUND", "店铺不存在", 404);
    return;
  }

  if (!request.file) {
    sendError(response, "FILE_REQUIRED", "请上传 Excel 文件", 400);
    return;
  }

  const storedPath = path.resolve(request.file.path);
  const normalizedOriginalFilename = normalizeUploadedFilename(request.file.originalname);

  try {
    const fileHash = await createFileHash(storedPath);
    const fileSize = request.file.size;
    const [duplicate] = await db
      .select({
        id: uploads.id,
        originalFilename: uploads.originalFilename,
        createdAt: uploads.createdAt,
        status: uploads.status,
      })
      .from(uploads)
      .where(
        and(
          eq(uploads.shopId, parsed.data.shopId),
          eq(uploads.fileHash, fileHash),
          ne(uploads.status, "failed"),
        ),
      )
      .orderBy(desc(uploads.createdAt), desc(uploads.id))
      .limit(1);

    if (duplicate) {
      fs.rmSync(storedPath, { force: true });
      sendError(
        response,
        "DUPLICATE_UPLOAD",
        `该店铺已上传过相同内容的文件：${normalizeUploadedFilename(duplicate.originalFilename)}（${formatUploadTime(duplicate.createdAt)}，状态：${duplicate.status}）。无需重复上传。`,
        409,
      );
      return;
    }

    const [created] = await db
      .insert(uploads)
      .values({
        shopId: parsed.data.shopId,
        originalFilename: normalizedOriginalFilename,
        storedPath,
        fileHash,
        fileSize,
        status: "queued",
      })
      .returning();

    analyzeQueue.enqueueUpload(created.id);

    sendSuccess(response, { uploadId: created.id }, 201);
  } catch (error) {
    fs.rmSync(storedPath, { force: true });
    sendError(response, "UPLOAD_FAILED", error instanceof Error ? error.message : "上传失败，请稍后重试", 500);
  }
});

uploadsRouter.post("/:id/continue", async (request, response) => {
  const uploadId = Number(request.params.id);
  const shopId = parseShopId(request.query.shopId);
  if (!Number.isInteger(uploadId) || uploadId <= 0 || !Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "上传 ID 或店铺 ID 无效", 400);
    return;
  }

  const result = await recoverUploadBatch(shopId, uploadId);
  if (!result.ok) {
    sendError(response, result.code, result.message, result.status);
    return;
  }

  sendSuccess(response, serializeUpload(result.upload));
});

uploadsRouter.delete("/:id", async (request, response) => {
  const uploadId = Number(request.params.id);
  const shopId = Number(request.query.shopId);
  if (!Number.isInteger(uploadId) || uploadId <= 0 || !Number.isInteger(shopId) || shopId <= 0) {
    sendError(response, "INVALID_ID", "上传 ID 或店铺 ID 无效", 400);
    return;
  }

  const deletedUpload = await deleteUploadBatch(shopId, uploadId);
  if (!deletedUpload) {
    sendError(response, "NOT_FOUND", "上传记录不存在", 404);
    return;
  }

  sendSuccess(response, deletedUpload);
});
