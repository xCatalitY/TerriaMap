/**
 * OpenSky field index mapping and normalized adapter row contracts.
 * Normalization responsibilities stay in the adapter boundary. (ref: DL-004)
 */
export const STATE_VECTOR_INDEX = {
  icao24: 0,
  callsign: 1,
  originCountry: 2,
  timePosition: 3,
  lastContact: 4,
  longitude: 5,
  latitude: 6,
  baroAltitude: 7,
  onGround: 8,
  velocity: 9,
  trueTrack: 10,
  verticalRate: 11,
  geoAltitude: 13,
  squawk: 14,
  spi: 15,
  positionSource: 16,
  category: 17
} as const;

export type OpenSkyStatesResponse = {
  time: number;
  states: unknown[][] | null;
};

export type RateLimitState = { remaining: number; retryAfterSeconds: number };

/**
 * Flattened row contract returned by /live/states snapshots.
 */
export type AircraftSnapshotRow = {
  icao24: string;
  callsign: string | null;
  latitude: number;
  longitude: number;
  last_contact: number;
  time_position: number | null;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  geo_altitude: number | null;
  origin_country: string;
  category: string;
};
