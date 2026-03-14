import { Router } from "express";
import type { BoundingBox } from "../config";
import { PollCoordinator } from "../pollCoordinator";
import { StateCache } from "../stateCache";
import type { AircraftSnapshotRow } from "../types";

const AIRPLANE_SVG =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIj4KICA8cGF0aCBkPSJNMTYgMyBMMTQuNSAxMSBMNiAxNSBMNiAxNyBMMTQuNSAxNS41IEwxNC41IDI0IEwxMS41IDI2LjUgTDExLjUgMjggTDE2IDI2LjUgTDIwLjUgMjggTDIwLjUgMjYuNSBMMTcuNSAyNCBMMTcuNSAxNS41IEwyNiAxNyBMMjYgMTUgTDE3LjUgMTEgWiIgZmlsbD0iI0ZGRDYwMCIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjEuMiIvPgo8L3N2Zz4K";

// Extrapolation horizon in seconds — how far ahead to project position
const EXTRAPOLATE_SECONDS = 60;

/**
 * Projects a geographic position forward using velocity and heading.
 * Uses simple great-circle approximation (accurate enough for 30-60s extrapolation).
 */
function extrapolatePosition(
  lat: number,
  lon: number,
  alt: number,
  velocityMs: number,
  headingDeg: number,
  seconds: number
): [number, number, number] {
  const EARTH_RADIUS = 6371000;
  const distanceM = velocityMs * seconds;
  const headingRad = headingDeg * (Math.PI / 180);
  const latRad = lat * (Math.PI / 180);
  const lonRad = lon * (Math.PI / 180);
  const angularDist = distanceM / EARTH_RADIUS;

  const newLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angularDist) +
      Math.cos(latRad) * Math.sin(angularDist) * Math.cos(headingRad)
  );
  const newLonRad =
    lonRad +
    Math.atan2(
      Math.sin(headingRad) * Math.sin(angularDist) * Math.cos(latRad),
      Math.cos(angularDist) - Math.sin(latRad) * Math.sin(newLatRad)
    );

  return [newLonRad * (180 / Math.PI), newLatRad * (180 / Math.PI), alt];
}

function rowToCzmlPacket(
  row: AircraftSnapshotRow,
  nowIso: string,
  futureIso: string
) {
  const alt = row.geo_altitude ?? 10000;
  const heading = row.true_track ?? 0;
  const velocity = row.velocity ?? 0;
  const rotationRad = -heading * (Math.PI / 180);

  const currentPos = [row.longitude, row.latitude, alt];

  // If aircraft has velocity and heading, extrapolate future position
  const canExtrapolate = velocity > 0 && row.true_track !== null;
  let position: object;

  if (canExtrapolate) {
    const futurePos = extrapolatePosition(
      row.latitude,
      row.longitude,
      alt,
      velocity,
      heading,
      EXTRAPOLATE_SECONDS
    );

    // Sampled position: Cesium interpolates between these timestamps
    // Format: [time, lon, lat, alt, time, lon, lat, alt, ...]
    position = {
      interpolationAlgorithm: "LINEAR",
      forwardExtrapolationType: "HOLD",
      cartographicDegrees: [nowIso, ...currentPos, futureIso, ...futurePos]
    };
  } else {
    position = {
      cartographicDegrees: currentPos
    };
  }

  return {
    id: row.icao24,
    name: row.callsign || row.icao24,
    description: `<b>${row.callsign || "N/A"}</b><br/>Country: ${
      row.origin_country
    }<br/>Altitude: ${
      alt !== null ? Math.round(alt) + " m" : "N/A"
    }<br/>Speed: ${
      velocity !== null ? Math.round(velocity) + " m/s" : "N/A"
    }<br/>Heading: ${Math.round(heading)}&deg;<br/>Category: ${row.category}`,
    position,
    billboard: {
      image: AIRPLANE_SVG,
      scale: 0.7,
      rotation: rotationRad,
      heightReference: "NONE",
      verticalOrigin: "CENTER",
      horizontalOrigin: "CENTER",
      disableDepthTestDistance: 500000,
      scaleByDistance: {
        nearFarScalar: [0, 1.2, 5000000, 0.3]
      }
    }
  };
}

export function buildLiveCzmlRoute(
  cache: StateCache,
  poller: PollCoordinator,
  maxBboxArea: number
) {
  const router = Router();

  router.get("/live/czml", async (req, res) => {
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

    const qBbox: BoundingBox = {
      lamin: Math.floor(bbox.lamin),
      lomin: Math.floor(bbox.lomin),
      lamax: Math.ceil(bbox.lamax),
      lomax: Math.ceil(bbox.lomax)
    };
    const queryKey = `${qBbox.lamin}:${qBbox.lomin}:${qBbox.lamax}:${qBbox.lomax}`;

    await poller.ensureFresh(queryKey, qBbox);
    const snapshot = cache.getOrCreate(queryKey);

    const now = new Date();
    const future = new Date(now.getTime() + EXTRAPOLATE_SECONDS * 1000);
    const nowIso = now.toISOString();
    const futureIso = future.toISOString();

    const czml = [
      {
        id: "document",
        name: "OpenSky Live Aircraft",
        version: "1.0",
        clock: {
          currentTime: nowIso,
          multiplier: 1,
          range: "UNBOUNDED",
          step: "SYSTEM_CLOCK"
        }
      },
      ...snapshot.rows.map((row) => rowToCzmlPacket(row, nowIso, futureIso))
    ];

    return res.json(czml);
  });

  return router;
}
