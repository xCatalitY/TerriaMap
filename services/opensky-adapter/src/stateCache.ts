/**
 * Snapshot cache keyed by query policy.
 */
import type { AircraftSnapshotRow } from "./types";

/**
 * Cached payload served to Terria clients. (ref: DL-003)
 */
export type SnapshotEnvelope = {
  rows: AircraftSnapshotRow[];
  fetchedAt: number;
  queryKey: string;
  nextPollAt: number | null;
};

/**
 * Stores latest normalized snapshot per bbox query key.
 */
export class StateCache {
  private readonly snapshots = new Map<string, SnapshotEnvelope>();

  get(queryKey: string): SnapshotEnvelope | undefined {
    return this.snapshots.get(queryKey);
  }

  set(snapshot: SnapshotEnvelope): void {
    this.snapshots.set(snapshot.queryKey, snapshot);
  }

  /**
   * Returns an empty envelope when no snapshot exists for a key.
   */
  getOrCreate(queryKey: string): SnapshotEnvelope {
    return (
      this.snapshots.get(queryKey) ?? {
        rows: [],
        fetchedAt: 0,
        queryKey,
        nextPollAt: null
      }
    );
  }
}
