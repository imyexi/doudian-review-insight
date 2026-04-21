import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { uploads } from "../db/schema";
import { logger } from "../utils/logger";
import type { AnalyzeWorkerMessage, AnalyzeWorkerResult } from "./workerProtocol";

const require = createRequire(import.meta.url);

export type JobStatus = "queued" | "running" | "done" | "failed";

interface LocalQueueJob {
  id: string;
  run: () => Promise<void>;
  type?: "local";
}

interface UploadAnalysisQueueJob {
  id: string;
  type: "upload-analysis";
  uploadId: number;
}

export type QueueJob = LocalQueueJob | UploadAnalysisQueueJob;

function isUploadAnalysisJob(job: QueueJob): job is UploadAnalysisQueueJob {
  return job.type === "upload-analysis";
}

function resolveWorkerEntryPath(): string {
  const overriddenEntry = process.env.ANALYZE_WORKER_ENTRY?.trim();
  if (overriddenEntry) {
    return path.resolve(overriddenEntry);
  }

  if (process.env.NODE_ENV === "production") {
    return path.resolve(process.cwd(), "dist", "server", "jobs", "worker.js");
  }

  return path.resolve(process.cwd(), "server", "jobs", "worker.ts");
}

function getWorkerExecArgv(workerEntryPath: string): string[] {
  if (!workerEntryPath.endsWith(".ts")) {
    return [];
  }

  return [
    "--require",
    require.resolve("tsx/preflight"),
    "--import",
    pathToFileURL(require.resolve("tsx")).href,
  ];
}

function getCancelErrorMessage(uploadId: number): string {
  return `上传分析已取消（任务 ${uploadId}）`;
}

async function markUploadAsFailed(uploadId: number, errorMessage: string): Promise<void> {
  const [existingUpload] = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(eq(uploads.id, uploadId))
    .limit(1);

  if (!existingUpload) {
    return;
  }

  await db
    .update(uploads)
    .set({
      status: "failed",
      error: errorMessage,
      finishedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(uploads.id, uploadId));
}

export class JobQueue {
  private cancelledJobIds = new Set<string>();
  private isRunning = false;
  private pending: QueueJob[] = [];
  private runningChild: ChildProcess | null = null;
  private runningJobId: string | null = null;
  private runningUploadId: number | null = null;
  private shuttingDown = false;

  markCanceled(jobId: string): void {
    this.cancelledJobIds.add(jobId);
  }

  cancel(jobId: string): boolean {
    const isRunningTarget = this.runningJobId === jobId;
    const nextPending = isRunningTarget ? this.pending : this.pending.filter(job => job.id !== jobId);
    const removedPendingJob = nextPending.length !== this.pending.length;
    this.pending = nextPending;

    if (removedPendingJob || isRunningTarget) {
      this.cancelledJobIds.add(jobId);
      if (isRunningTarget) {
        const runningUploadId = this.runningUploadId;
        if (typeof runningUploadId === "number") {
          void markUploadAsFailed(runningUploadId, getCancelErrorMessage(runningUploadId));
        }
      }
      if (isRunningTarget && this.runningChild?.connected) {
        const cancelMessage: AnalyzeWorkerMessage = {
          type: "cancel",
          uploadId: Number(jobId),
        };
        this.runningChild.send(cancelMessage);
      }
      return true;
    }

    return false;
  }

  enqueue(job: QueueJob): void {
    this.shuttingDown = false;
    this.cancelledJobIds.delete(job.id);
    this.pending = [...this.pending, job];
    void this.processNext();
  }

  enqueueUpload(uploadId: number): void {
    this.enqueue({
      id: String(uploadId),
      type: "upload-analysis",
      uploadId,
    });
  }

  getRunningJobId(): string | null {
    return this.runningJobId;
  }

  isCanceled(jobId: string): boolean {
    return this.cancelledJobIds.has(jobId);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.pending = [];
    this.cancelledJobIds.clear();

    const child = this.runningChild;
    this.runningChild = null;
    this.runningJobId = null;
    this.runningUploadId = null;
    this.isRunning = false;

    if (!child) {
      return;
    }

    await new Promise<void>(resolve => {
      child.once("exit", () => resolve());
      child.kill();
    });
  }

  private async processNext(): Promise<void> {
    if (this.isRunning || this.shuttingDown) {
      return;
    }

    const nextJob = this.pending[0];
    if (!nextJob) {
      return;
    }

    if (this.cancelledJobIds.has(nextJob.id)) {
      this.pending = this.pending.slice(1);
      this.cancelledJobIds.delete(nextJob.id);
      void this.processNext();
      return;
    }

    this.isRunning = true;
    this.runningJobId = nextJob.id;
    this.runningUploadId = isUploadAnalysisJob(nextJob) ? nextJob.uploadId : null;

    try {
      if (isUploadAnalysisJob(nextJob)) {
        await this.runUploadAnalysisJob(nextJob);
      } else {
        await nextJob.run();
      }
    } catch (error) {
      logger.error({ error, jobId: nextJob.id }, "job queue execution failed");
    } finally {
      this.pending = this.pending.slice(1);
      this.isRunning = false;
      this.runningJobId = null;
      this.runningUploadId = null;
      this.runningChild = null;
      this.cancelledJobIds.delete(nextJob.id);
      if (this.pending.length > 0 && !this.shuttingDown) {
        void this.processNext();
      }
    }
  }

  private async runUploadAnalysisJob(job: UploadAnalysisQueueJob): Promise<void> {
    const workerEntryPath = resolveWorkerEntryPath();
    const child = fork(workerEntryPath, [], {
      cwd: process.cwd(),
      execArgv: getWorkerExecArgv(workerEntryPath),
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });

    this.runningChild = child;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        child.removeAllListeners();
      };

      const resolveOnce = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      const rejectOnce = (error: unknown): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      child.once("error", error => {
        if (this.shuttingDown) {
          resolveOnce();
          return;
        }

        void markUploadAsFailed(job.uploadId, error.message).finally(() => {
          rejectOnce(error);
        });
      });

      child.on("message", (message: AnalyzeWorkerResult) => {
        if (!message || message.uploadId !== job.uploadId) {
          return;
        }

        if (message.type === "done") {
          resolveOnce();
          return;
        }

        if (message.type === "failed") {
          if (this.shuttingDown) {
            resolveOnce();
            return;
          }

          rejectOnce(new Error(message.error));
        }
      });

      child.once("exit", (code, signal) => {
        if (settled) {
          return;
        }

        const wasCanceled = this.cancelledJobIds.has(job.id);
        if (wasCanceled || this.shuttingDown) {
          resolveOnce();
          return;
        }

        const exitReason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
        const errorMessage = `分析 worker 异常退出（${exitReason}）`;
        void markUploadAsFailed(job.uploadId, errorMessage).finally(() => {
          rejectOnce(new Error(errorMessage));
        });
      });

      const runMessage: AnalyzeWorkerMessage = {
        type: "run-upload",
        uploadId: job.uploadId,
      };
      child.send(runMessage);

      if (this.cancelledJobIds.has(job.id) && child.connected) {
        const cancelMessage: AnalyzeWorkerMessage = {
          type: "cancel",
          uploadId: job.uploadId,
        };
        child.send(cancelMessage);
      }
    });
  }
}

export const analyzeQueue = new JobQueue();
