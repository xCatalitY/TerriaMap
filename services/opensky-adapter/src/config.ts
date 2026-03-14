/**
 * Adapter configuration primitives.
 * Keeps provider auth and polling policy server-side. (ref: DL-001, DL-003)
 */
export type BoundingBox = {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
};

export type AdapterConfig = {
  authUrl: string;
  clientId: string;
  clientSecret: string;
  openskyBaseUrl: string;
  maxBboxArea: number;
  defaultPollSeconds: number;
};

/**
 * Reads adapter runtime settings from environment variables.
 */
export function loadConfig(env = process.env): AdapterConfig {
  return {
    authUrl: env.OPENSKY_AUTH_URL!,
    clientId: env.OPENSKY_CLIENT_ID!,
    clientSecret: env.OPENSKY_CLIENT_SECRET!,
    openskyBaseUrl: env.OPENSKY_BASE_URL ?? "https://opensky-network.org/api",
    // Bbox policy limits credit burn before requests leave the adapter.
    maxBboxArea: Number(env.OPENSKY_MAX_BBOX_AREA ?? 100),
    // Default cadence favors sustainable shared polling over provider maximum resolution.
    defaultPollSeconds: Number(env.OPENSKY_DEFAULT_POLL_SECONDS ?? 30)
  };
}
