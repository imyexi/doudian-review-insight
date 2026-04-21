import { analyzeUpload } from "./analyze";
import { analyzeQueue } from "./queue";
import type { AnalyzeWorkerMessage, AnalyzeWorkerResult } from "./workerProtocol";

function sendMessage(message: AnalyzeWorkerResult): void {
  if (typeof process.send === "function") {
    process.send(message);
  }
}

async function handleRun(uploadId: number): Promise<void> {
  try {
    await analyzeUpload(uploadId);
    sendMessage({
      type: "done",
      uploadId,
    });
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
    analyzeQueue.markCanceled(String(typedMessage.uploadId));
    return;
  }

  if (typedMessage.type === "run-upload") {
    void handleRun(typedMessage.uploadId);
  }
});
