export interface RunUploadMessage {
  type: "run-upload";
  uploadId: number;
}

export interface CancelUploadMessage {
  type: "cancel";
  uploadId: number;
}

export type AnalyzeWorkerMessage = RunUploadMessage | CancelUploadMessage;

export interface DoneResultMessage {
  type: "done";
  uploadId: number;
}

export interface FailedResultMessage {
  type: "failed";
  uploadId: number;
  error: string;
}

export type AnalyzeWorkerResult = DoneResultMessage | FailedResultMessage;
