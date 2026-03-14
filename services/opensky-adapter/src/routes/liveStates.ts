/**
 * HTTP routes that publish cached adapter snapshots to Terria.
 */
import { Router } from "express";
import type { BoundingBox } from "../config";
import { PollCoordinator } from "../pollCoordinator";
import { StateCache } from "../stateCache";

/**
 * Builds the public live snapshot endpoint.
 * Enforces bbox policy before returning cached rows. (ref: DL-003)
 */
export function buildLiveStatesRoute(
  cache: StateCache,
  poller: PollCoordinator,
  maxBboxArea: number
) {
  const router = Router();

  router.get("/live/states", async (req, res) => {
    const lamin = Number(req.query.lamin);
    const lomin = Number(req.query.lomin);
    const lamax = Number(req.query.lamax);
    const lomax = Number(req.query.lomax);

    if ([lamin, lomin, lamax, lomax].some(Number.isNaN)) {
      return res.status(400).json({ error: "bbox parameters must be numeric" });
    }

    const bbox: BoundingBox = { lamin, lomin, lamax, lomax };

    const area = Math.abs(
      (bbox.lamax - bbox.lamin) * (bbox.lomax - bbox.lomin)
    );
    if (area > maxBboxArea) {
      return res
        .status(400)
        .json({ error: "bbox exceeds configured area policy" });
    }

    // Quantize bbox to 1-degree grid to bound cache key cardinality. (ref: DL-003)
    const qBbox: BoundingBox = {
      lamin: Math.floor(bbox.lamin),
      lomin: Math.floor(bbox.lomin),
      lamax: Math.ceil(bbox.lamax),
      lomax: Math.ceil(bbox.lomax)
    };
    const queryKey = `${qBbox.lamin}:${qBbox.lomin}:${qBbox.lamax}:${qBbox.lomax}`;

    // Trigger demand-driven poll if cache is empty or stale for this key
    await poller.ensureFresh(queryKey, qBbox);

    const snapshot = cache.getOrCreate(queryKey);

    // Adapter metadata keeps Terria refresh behavior visible without leaking provider secrets.
    return res.json(snapshot);
  });

  return router;
}
