/**
 * Runs heavy jobs (video renders, image generation) one at a time by default. On a 16 GB
 * Apple Silicon Mac an image model and a render (TTS worker + frame canvas + FFmpeg) together
 * can push the system into swap. HEAVY_JOBS raises the limit on bigger machines.
 */
export class WorkQueue {
  private running = 0;
  private waiting: (() => void)[] = [];

  constructor(readonly limit = 1) {
    if (!Number.isInteger(limit) || limit < 1) this.limit = 1;
  }

  /** Jobs started or waiting. */
  get size(): number {
    return this.running + this.waiting.length;
  }

  async run<T>(job: () => Promise<T>): Promise<T> {
    // A finished job hands its slot straight to the next waiter, so a newcomer can never
    // slip in between and exceed the limit.
    if (this.running >= this.limit) await new Promise<void>((r) => this.waiting.push(r));
    else this.running++;
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}

export function heavyQueueFromEnv(env: NodeJS.ProcessEnv = process.env): WorkQueue {
  return new WorkQueue(Number(env.HEAVY_JOBS || 1));
}
