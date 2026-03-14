import type { BoundingBox } from "./config";
import { OpenSkyClient } from "./openskyClient";
import { normalizeStates } from "./normalizer";
import { schedulePoll } from "./pollScheduler";
import { StateCache } from "./stateCache";

/**
 * Coordinates demand-driven polling per bbox query key.
 * Ensures one inflight fetch per key and schedules follow-up polls. (ref: DL-003)
 */
export class PollCoordinator {
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly client: OpenSkyClient,
    private readonly cache: StateCache,
    private readonly defaultPollSeconds: number
  ) {}

  /** Ensures fresh data exists for a query key, triggering a poll if needed. */
  async ensureFresh(queryKey: string, bbox: BoundingBox): Promise<void> {
    const existing = this.cache.get(queryKey);
    const now = Date.now();
    if (
      existing &&
      existing.fetchedAt > 0 &&
      (!existing.nextPollAt || now < existing.nextPollAt)
    ) {
      return; // Cache is still fresh
    }

    // Single-flight: reuse inflight fetch for same key
    if (this.inflight.has(queryKey)) {
      return this.inflight.get(queryKey);
    }

    const promise = this.poll(queryKey, bbox);
    this.inflight.set(queryKey, promise);
    try {
      await promise;
    } finally {
      this.inflight.delete(queryKey);
    }
  }

  private async poll(queryKey: string, bbox: BoundingBox): Promise<void> {
    try {
      const { data, rateLimit } = await this.client.fetchStates(bbox);
      const rows = normalizeStates(data);
      const now = Date.now();
      const nextPollAt = schedulePoll(now, rateLimit, this.defaultPollSeconds);

      this.cache.set({ rows, fetchedAt: now, queryKey, nextPollAt });

      // Schedule automatic re-poll to keep cache warm for active keys
      this.scheduleRepoll(queryKey, bbox, nextPollAt - now);
    } catch (error) {
      console.error(
        `[opensky-adapter] poll failed for key ${queryKey}:`,
        error
      );
      // On failure, schedule a retry at default cadence
      this.scheduleRepoll(queryKey, bbox, this.defaultPollSeconds * 1000);
    }
  }

  private scheduleRepoll(
    queryKey: string,
    bbox: BoundingBox,
    delayMs: number
  ): void {
    const existing = this.timers.get(queryKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(queryKey);
      this.poll(queryKey, bbox).catch(() => {});
    }, delayMs);
    this.timers.set(queryKey, timer);
  }
}
