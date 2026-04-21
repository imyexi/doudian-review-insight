import fs from "node:fs";
import type { AnalyzeWorkerMessage, AnalyzeWorkerResult } from "./workerProtocol";

let isCanceled = false;

function sendMessage(message: AnalyzeWorkerResult): void {
  if (typeof process.send === "function") {
    process.send(message);
  }
}

function getPositiveNumber(name: string): number {
  const rawValue = Number(process.env[name] ?? "0");
  return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0;
}

function writeStartedMarker(uploadId: number): void {
  const markerPath = process.env.ANALYZE_WORKER_STARTED_FILE?.trim();
  if (!markerPath) {
    return;
  }

  fs.writeFileSync(markerPath, String(uploadId));
}

function blockWorker(durationMs: number): void {
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    // Busy-loop on purpose so the child process simulates synchronous CPU work.
  }
}

async function waitForCancelOrTimeout(durationMs: number): Promise<void> {
  const deadline = Date.now() + durationMs;
  while (!isCanceled && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function handleRun(uploadId: number): Promise<void> {
  try {
    writeStartedMarker(uploadId);

    const blockMs = getPositiveNumber("ANALYZE_WORKER_BLOCK_MS");
    if (blockMs > 0) {
      blockWorker(blockMs);
    }

    const delayMs = getPositiveNumber("ANALYZE_WORKER_DELAY_MS");
    if (delayMs > 0) {
      await waitForCancelOrTimeout(delayMs);
    }

    if (!isCanceled) {
      sendMessage({
        type: "done",
        uploadId,
      });
    }
  } catch (error) {
    sendMessage({
      type: "failed",
      uploadId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    process.exit(0);
  }
}

process.on("message", message => {
  const typedMessage = message as AnalyzeWorkerMessage | undefined;
  if (!typedMessage) {
    return;
  }

  if (typedMessage.type === "cancel") {
    isCanceled = true;
    return;
  }

  if (typedMessage.type === "run-upload") {
    void handleRun(typedMessage.uploadId);
  }
});
