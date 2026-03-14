import { Router } from "express";
import type { BoundingBox } from "../config";
import { PollCoordinator } from "../pollCoordinator";
import { StateCache } from "../stateCache";
import type { AircraftSnapshotRow } from "../types";

const AIRPLANE_SVG =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiIgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIj4KICA8cGF0aCBkPSJNMTYgMyBMMTQuNSAxMSBMNiAxNSBMNiAxNyBMMTQuNSAxNS41IEwxNC41IDI0IEwxMS41IDI2LjUgTDExLjUgMjggTDE2IDI2LjUgTDIwLjUgMjggTDIwLjUgMjYuNSBMMTcuNSAyNCBMMTcuNSAxNS41IEwyNiAxNyBMMjYgMTUgTDE3LjUgMTEgWiIgZmlsbD0iI0ZGRDYwMCIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjEuMiIvPgo8L3N2Zz4K";

function rowToCzmlPacket(row: AircraftSnapshotRow) {
  const alt = row.geo_altitude ?? 10000;
  const heading = row.true_track ?? 0;
  // CZML rotation: convert true_track (clockwise from north) to CZML rotation (counter-clockwise radians)
  const rotationRad = -heading * (Math.PI / 180);

  return {
    id: row.icao24,
    name: row.callsign || row.icao24,
    description: `<b>${row.callsign || "N/A"}</b><br/>Country: ${
      row.origin_country
    }<br/>Altitude: ${
      alt !== null ? Math.round(alt) + " m" : "N/A"
    }<br/>Speed: ${
      row.velocity !== null ? Math.round(row.velocity) + " m/s" : "N/A"
    }<br/>Heading: ${Math.round(heading)}°<br/>Category: ${row.category}`,
    position: {
      cartographicDegrees: [row.longitude, row.latitude, alt]
    },
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

    const czml = [
      {
        id: "document",
        name: "OpenSky Live Aircraft",
        version: "1.0"
      },
      ...snapshot.rows.map(rowToCzmlPacket)
    ];

    return res.json(czml);
  });

  return router;
}
