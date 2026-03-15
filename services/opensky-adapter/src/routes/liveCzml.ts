import { Router } from "express";
import type { BoundingBox } from "../config";
import { PollCoordinator } from "../pollCoordinator";
import { StateCache } from "../stateCache";
import type { AircraftSnapshotRow } from "../types";

const AIRPLANE_SVG =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIj4KICA8cGF0aCBkPSJNMTYgMyBMMTQuNSAxMSBMNiAxNSBMNiAxNyBMMTQuNSAxNS41IEwxNC41IDI0IEwxMS41IDI2LjUgTDExLjUgMjggTDE2IDI2LjUgTDIwLjUgMjggTDIwLjUgMjYuNSBMMTcuNSAyNCBMMTcuNSAxNS41IEwyNiAxNyBMMjYgMTUgTDE3LjUgMTEgWiIgZmlsbD0iI0ZGRDYwMCIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjEuMiIvPgo8L3N2Zz4K";

const EXTRAPOLATE_SECONDS = 15;
const DEG2RAD = Math.PI / 180;

function extrapolatePosition(
  lat: number,
  lon: number,
  alt: number,
  velocityMs: number,
  headingDeg: number,
  seconds: number
): [number, number, number] {
  const R = 6371000;
  const d = velocityMs * seconds;
  const h = headingDeg * DEG2RAD;
  const lat1 = lat * DEG2RAD;
  const lon1 = lon * DEG2RAD;
  const ad = d / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ad) + Math.cos(lat1) * Math.sin(ad) * Math.cos(h)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(h) * Math.sin(ad) * Math.cos(lat1),
      Math.cos(ad) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [lon2 / DEG2RAD, lat2 / DEG2RAD, alt];
}

/**
 * Compute the ECEF unit vector pointing in the heading direction at a given lat/lon.
 * This is the tangent vector on the Earth's surface rotated from north by headingDeg.
 */
function headingToEcefUnit(
  latDeg: number,
  lonDeg: number,
  headingDeg: number
): [number, number, number] {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const h = headingDeg * DEG2RAD;

  // North unit vector at (lat, lon) in ECEF: -sin(lat)*cos(lon), -sin(lat)*sin(lon), cos(lat)
  const nx = -Math.sin(lat) * Math.cos(lon);
  const ny = -Math.sin(lat) * Math.sin(lon);
  const nz = Math.cos(lat);

  // East unit vector at (lat, lon) in ECEF: -sin(lon), cos(lon), 0
  const ex = -Math.sin(lon);
  const ey = Math.cos(lon);
  const ez = 0;

  // Heading direction = cos(heading)*north + sin(heading)*east
  const x = Math.cos(h) * nx + Math.sin(h) * ex;
  const y = Math.cos(h) * ny + Math.sin(h) * ey;
  const z = Math.cos(h) * nz + Math.sin(h) * ez;

  return [x, y, z];
}

// How far back to place the "past" sample for smooth transitions on refresh
const PAST_SECONDS = 5;

function rowToCzmlPacket(
  row: AircraftSnapshotRow,
  pastIso: string,
  nowIso: string,
  futureIso: string
) {
  const alt = row.geo_altitude ?? 10000;
  const heading = row.true_track ?? 0;
  const velocity = row.velocity ?? 0;
  const canExtrapolate = velocity > 0 && row.true_track !== null;

  const currentPos = [row.longitude, row.latitude, alt];
  let position: object;

  if (canExtrapolate) {
    // Back-extrapolate to where the aircraft was a few seconds ago.
    // This creates continuity when CZML process() replaces the old position:
    // the entity was already near the past sample, so no visible jump.
    const pastPos = extrapolatePosition(
      row.latitude,
      row.longitude,
      alt,
      velocity,
      heading,
      -PAST_SECONDS
    );
    const futurePos = extrapolatePosition(
      row.latitude,
      row.longitude,
      alt,
      velocity,
      heading,
      EXTRAPOLATE_SECONDS
    );
    position = {
      interpolationAlgorithm: "LINEAR",
      forwardExtrapolationType: "HOLD",
      backwardExtrapolationType: "HOLD",
      cartographicDegrees: [
        pastIso,
        ...pastPos,
        nowIso,
        ...currentPos,
        futureIso,
        ...futurePos
      ]
    };
  } else {
    position = { cartographicDegrees: currentPos };
  }

  // Compute heading as ECEF unit vector for alignedAxis.
  // This gives Cesium an exact world-space direction independent of camera orientation.
  const headingEcef = headingToEcefUnit(row.latitude, row.longitude, heading);

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
      rotation: 0,
      alignedAxis: { unitCartesian: headingEcef },
      heightReference: "NONE",
      verticalOrigin: "CENTER",
      horizontalOrigin: "CENTER",
      disableDepthTestDistance: 500000,
      scaleByDistance: { nearFarScalar: [0, 1.2, 5000000, 0.3] }
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
    const past = new Date(now.getTime() - PAST_SECONDS * 1000);
    const future = new Date(now.getTime() + EXTRAPOLATE_SECONDS * 1000);
    const pastIso = past.toISOString();
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
      ...snapshot.rows.map((row) =>
        rowToCzmlPacket(row, pastIso, nowIso, futureIso)
      )
    ];

    return res.json(czml);
  });

  return router;
}
