export type JobStatus = "queued" | "running" | "done" | "failed";

export interface QueueJob {
  id: string;
  run: () => Promise<void>;
}

class JobQueue {
  private isRunning = false;
  private pending: QueueJob[] = [];

  enqueue(job: QueueJob): void {
    this.pending = [...this.pending, job];
    void this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    const nextJob = this.pending[0];
    if (!nextJob) {
      return;
    }

    this.isRunning = true;

    try {
      await nextJob.run();
    } finally {
      this.pending = this.pending.slice(1);
      this.isRunning = false;
      if (this.pending.length > 0) {
        void this.processNext();
      }
    }
  }
}

export const analyzeQueue = new JobQueue();
