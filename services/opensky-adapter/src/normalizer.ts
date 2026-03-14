import {
  STATE_VECTOR_INDEX,
  type AircraftSnapshotRow,
  type OpenSkyStatesResponse
} from "./types";

function categorize(cat: number): string {
  if (cat >= 2 && cat <= 3) return "light";
  if (cat >= 4 && cat <= 6) return "heavy";
  if (cat === 7) return "high-perf";
  if (cat === 8) return "helicopter";
  if (cat === 9) return "glider";
  if (cat >= 10 && cat <= 13) return "other";
  if (cat === 14) return "uav";
  if (cat >= 16 && cat <= 17) return "ground";
  return "unknown";
}

/**
 * Transforms raw OpenSky state-vector arrays into normalized AircraftSnapshotRow records.
 * Applies icao24 deduplication, null-position rejection, stale-contact eviction,
 * and field extraction using the STATE_VECTOR_INDEX mapping. (ref: DL-004)
 */
export function normalizeStates(
  response: OpenSkyStatesResponse,
  staleThresholdSeconds = 300
): AircraftSnapshotRow[] {
  if (!response.states) return [];

  const now = response.time;
  const seen = new Set<string>();
  const rows: AircraftSnapshotRow[] = [];
  const idx = STATE_VECTOR_INDEX;

  for (const sv of response.states) {
    const icao24 = sv[idx.icao24] as string;
    if (!icao24 || seen.has(icao24)) continue;

    const latitude = sv[idx.latitude] as number | null;
    const longitude = sv[idx.longitude] as number | null;
    if (latitude == null || longitude == null) continue;

    const lastContact = sv[idx.lastContact] as number;
    if (now - lastContact > staleThresholdSeconds) continue;

    seen.add(icao24);
    rows.push({
      icao24,
      callsign: (sv[idx.callsign] as string | null)?.trim() || null,
      latitude,
      longitude,
      last_contact: lastContact,
      time_position: (sv[idx.timePosition] as number) ?? null,
      velocity: (sv[idx.velocity] as number) ?? null,
      true_track: (sv[idx.trueTrack] as number) ?? null,
      vertical_rate: (sv[idx.verticalRate] as number) ?? null,
      geo_altitude: (sv[idx.geoAltitude] as number) ?? null,
      origin_country: sv[idx.originCountry] as string,
      category: categorize((sv[idx.category] as number) ?? 0)
    });
  }

  return rows;
}
