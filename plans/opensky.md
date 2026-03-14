# Plan

## Overview

Integrate OpenSky Network live aircraft positions into TerriaMap through a secure, credit-aware adapter and a Terria-consumable live catalog layer.

**Approach**: Expose live aircraft positions through a dedicated OpenSky adapter service that manages OAuth2 tokens, shared polling, normalization, and freshness rules, then consume that normalized snapshot feed in TerriaMap through an api-table catalog layer and deployment-time adapter discovery config.

### OpenSky live aircraft data flow

[Diagram pending Technical Writer rendering: DIAG-001]

## Planning Context

### Decision Log

| ID     | Decision                                                                                                                                                                             | Reasoning Chain                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DL-001 | Use a dedicated OpenSky adapter service that exchanges OAuth2 client credentials server-side and publishes a sanitized live snapshot API for TerriaMap.                              | OpenSky REST access for API clients requires OAuth2 client credentials and short-lived bearer tokens -> browser delivery cannot safely hold client secrets and per-viewer polling would multiply credit burn -> a dedicated adapter keeps secrets server-side and gives the map a stable internal contract.                                                                                                      |
| DL-002 | Model the initial Terria integration as a transformed live dataset consumed through Terria api-table instead of starting with a custom catalog item or plugin.                       | TerriaMap already registers api-table and supports auto-refreshing table-backed point layers -> a row-object snapshot feed fits that path with lower backtrack cost than plugin work -> custom OpenSky-specific extensions are deferred until the config-driven layer proves insufficient.                                                                                                                       |
| DL-003 | Centralize polling by bbox query key and start with conservative credit-aware cadence rather than polling at OpenSky maximum authenticated resolution.                               | OpenSky /states/all is charged per request and per bbox size while daily credits are finite -> a 5 second poll is generally unsustainable for production coverage -> shared polling with bbox quantization to a grid, caching, and adaptive backoff preserve credits and produce consistent viewer behavior. Without bbox quantization each viewer viewport creates a unique query key, defeating cache sharing. |
| DL-004 | Treat stable aircraft identity and freshness as adapter responsibilities using icao24 deduplication, null-position rejection, and stale-contact eviction before data reaches Terria. | OpenSky state vectors can include null latitude or longitude and stale timestamps -> pushing raw records into the map would create jitter, ghosts, and duplicate entities -> adapter-side normalization keeps the Terria layer simple and deterministic.                                                                                                                                                         |

### Rejected Alternatives

| Alternative                                                                                    | Why Rejected                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Call OpenSky directly from the browser with authenticated requests.                            | Browser delivery would expose client credentials or force insecure credential handling while multiplying credit usage per viewer. (ref: DL-001)                                                                                                                                                                 |
| Use anonymous browser-direct polling as the primary live integration strategy.                 | Anonymous access ignores time parameters, degrades resolution to ten-second buckets, and does not provide a reliable production operating model. (ref: DL-003)                                                                                                                                                  |
| Start with a custom Terria plugin or catalog item before proving the transformed dataset path. | Terria already supports an auto-refreshing api-table path, so a plugin-first implementation would increase complexity before the simpler path is exhausted. (ref: DL-002)                                                                                                                                       |
| Extend terriajs-server with an OpenSky proxy route instead of a dedicated adapter service.     | terriajs-server is a static file and proxy server not designed for stateful token lifecycle, shared polling coordination, or credit-aware scheduling. Adding these concerns would couple map serving to provider-specific polling logic and complicate independent scaling and failure isolation. (ref: DL-001) |

### Constraints

- MUST: use OpenSky official OAuth2 client-credentials flow and token lifetime semantics when designing the live adapter boundary.
- MUST: keep OpenSky client secrets and token exchange out of browser-delivered TerriaMap code and config.
- MUST: fit the existing TerriaMap startup and catalog model without requiring React or bootstrap rewrites for the first live layer.
- SHOULD: prefer the lowest-backtrack Terria integration path before introducing a custom plugin or catalog item.
- SHOULD: align local, Docker, and Helm surfaces with explicit adapter discovery rather than implicit in-process terriajs-server patching.

### Known Risks

- **OpenSky bearer tokens can expire mid-poll or return unauthorized responses during refresh races.**: Use a shared token manager with expiry margin, single-flight refresh, and one unauthorized retry path in the adapter client.
- **Aggressive polling or oversized bounding boxes can exhaust OpenSky credits and trigger 429 responses.**: Centralize polling by bbox query key, clamp bbox policy, and drive cadence from rate-limit and retry-after signals instead of maximum theoretical resolution.
- **Raw OpenSky state vectors can include stale timestamps or null position fields that create ghost aircraft or jitter on the map.**: Normalize records in the adapter, reject null positions, and evict stale aircraft before publishing snapshots to Terria.
- **A plugin-first Terria integration can increase build and maintenance cost before the simpler data-contract approach is proven.**: Ship the initial live layer through api-table and only escalate to a custom plugin if domain behavior exceeds the transformed dataset path.
- **Unique viewer viewports can create unbounded bbox query keys that defeat cache sharing.**: Quantize bounding box coordinates to a grid so distinct viewports map to a bounded set of shared cache keys.

## Invisible Knowledge

### System

TerriaMap remains a consumer of normalized live aircraft snapshots while a dedicated adapter service owns OpenSky authentication, polling cadence, normalization, and freshness enforcement.

### Invariants

- OpenSky OAuth credentials and token exchange stay server-side.
- Aircraft identity is keyed by icao24 before rows reach Terria.
- Null latitude or longitude rows are rejected before publication.
- Polling cadence is budgeted by credits and bbox policy rather than by the maximum documented provider resolution.
- Bounding box query keys are quantized to a grid to ensure viewer viewport variance maps to a bounded set of cache keys.

### Tradeoffs

- Adapter-plus-api-table reduces initial change surface at the cost of an additional service boundary.
- Shared polling prioritizes credit efficiency and stable viewer behavior over per-user freshness tuning.
- Custom plugin work is deferred to preserve delivery speed until the normalized dataset path proves insufficient.

### Escalation Triggers (api-table to custom catalog type)

- Users request heading-based aircraft rotation on the map (api-table points cannot rotate).
- Users request 3D aircraft models (existing GTFS buses demonstrate this capability with glTF models; api-table does not support model rendering).
- Users request altitude-based marker scaling or vertical position in 3D view.
- Trail rendering or interpolation quality proves insufficient for smooth aircraft tracking.

## Milestones

### Milestone 1: Define the OpenSky adapter contract and service skeleton

**Files**: services/opensky-adapter/package.json, services/opensky-adapter/src/config.ts, services/opensky-adapter/src/tokenManager.ts, services/opensky-adapter/src/openskyClient.ts, services/opensky-adapter/src/types.ts, services/opensky-adapter/src/normalizer.ts

**Requirements**:

- Server-side OAuth2 client-credentials flow
- OpenSky client with bbox-based /states/all requests
- Typed state-vector normalization contract
- No browser exposure of OpenSky secrets

**Acceptance Criteria**:

- Adapter configuration documents required OpenSky credentials and bbox policy
- Token manager refreshes before expiry and retries one unauthorized response
- OpenSky client contract defines normalized aircraft snapshot rows and error surfaces

**Tests**:

- integration:doc-derived:token refresh and unauthorized retry flow

#### Code Intent

- **CI-M-001-001** `services/opensky-adapter/package.json`: Define the adapter service package, runtime scripts, and dependencies needed for OAuth token exchange, HTTP polling, and test execution. (refs: DL-001, DL-003)
- **CI-M-001-002** `services/opensky-adapter/src/config.ts::loadConfig`: Load the adapter environment contract, including OpenSky auth endpoints, credential references, allowed bbox policy, and cadence bounds that separate public map settings from private secrets. (refs: DL-001, DL-003)
- **CI-M-001-003** `services/opensky-adapter/src/tokenManager.ts::getAccessToken`: Acquire and refresh OpenSky bearer tokens with expiry margin, single-flight refresh protection, and one unauthorized retry path for callers. (refs: DL-001)
- **CI-M-001-004** `services/opensky-adapter/src/openskyClient.ts::fetchStates`: Call OpenSky /states/all with bbox parameters, attach bearer auth, capture rate-limit headers, and translate provider failures into adapter-level errors. (refs: DL-001, DL-003)
- **CI-M-001-005** `services/opensky-adapter/src/types.ts`: Define the normalized aircraft snapshot row shape and the raw OpenSky state-vector index mapping used by adapter normalization code. (refs: DL-002, DL-004)
- **CI-M-001-006** `services/opensky-adapter/src/normalizer.ts::normalizeStates`: Transform raw OpenSky state-vector arrays into normalized AircraftSnapshotRow records by applying icao24 deduplication, null-position rejection, stale-contact eviction, and field extraction using the STATE_VECTOR_INDEX mapping. (refs: DL-004)

#### Code Changes

**CC-M-001-001** (services/opensky-adapter/package.json) - implements CI-M-001-001

**Code:**

```diff
--- /dev/null
+++ b/services/opensky-adapter/package.json
@@ -0,0 +1,19 @@
+{
+  "name": "@terriamap/opensky-adapter",
+  "private": true,
+  "type": "module",
+  "scripts": {
+    "dev": "tsx src/server.ts",
+    "start": "node dist/server.js",
+    "test": "node --test"
+  },
+  "dependencies": {
+    "express": "^4.21.2"
+  },
+  "devDependencies": {
+    "tsx": "^4.19.2",
+    "typescript": "^5.9.2"
+  }
+}

```

**Documentation:**

```diff
--- a/services/opensky-adapter/package.json
+++ b/services/opensky-adapter/package.json
@@ -1,5 +1,6 @@
 {
   "name": "@terriamap/opensky-adapter",
+  "description": "OpenSky live snapshot adapter boundary for TerriaMap. (ref: DL-001)",
   "private": true,
   "type": "module",
   "scripts": {

```

**CC-M-001-002** (services/opensky-adapter/src/config.ts) - implements CI-M-001-002

**Code:**

```diff
--- /dev/null
+++ b/services/opensky-adapter/src/config.ts
@@ -0,0 +1,32 @@
+export type BoundingBox = {
+  lamin: number;
+  lomin: number;
+  lamax: number;
+  lomax: number;
+};
+
+export type AdapterConfig = {
+  authUrl: string;
+  clientId: string;
+  clientSecret: string;
+  openskyBaseUrl: string;
+  maxBboxArea: number;
+  defaultPollSeconds: number;
+  minPollSeconds: number;
+};
+
+export function loadConfig(env = process.env): AdapterConfig {
+  return {
+    authUrl: env.OPENSKY_AUTH_URL!,
+    clientId: env.OPENSKY_CLIENT_ID!,
+    clientSecret: env.OPENSKY_CLIENT_SECRET!,
+    openskyBaseUrl: env.OPENSKY_BASE_URL ?? "https://opensky-network.org/api",
+    // Bbox policy limits credit burn before requests leave the adapter.
+    maxBboxArea: Number(env.OPENSKY_MAX_BBOX_AREA ?? 100),
+    // Default cadence favors sustainable shared polling over provider maximum resolution.
+    defaultPollSeconds: Number(env.OPENSKY_DEFAULT_POLL_SECONDS ?? 30),
+    minPollSeconds: Number(env.OPENSKY_MIN_POLL_SECONDS ?? 15)
+  };
+}

```

**Documentation:**

```diff
--- a/services/opensky-adapter/src/config.ts
+++ b/services/opensky-adapter/src/config.ts
@@ -1,3 +1,8 @@
+/**
+ * Adapter configuration primitives.
+ * Keeps provider auth and polling policy server-side. (ref: DL-001, DL-003)
+ */
 export type BoundingBox = {
   lamin: number;
   lomin: number;
@@ -14,6 +19,10 @@ export type AdapterConfig = {
   minPollSeconds: number;
 };

+/**
+ * Reads adapter runtime settings from environment variables.
+ */
 export function loadConfig(env = process.env): AdapterConfig {
   return {
     authUrl: env.OPENSKY_AUTH_URL!,

```

**CC-M-001-003** (services/opensky-adapter/src/tokenManager.ts) - implements CI-M-001-003

**Code:**

```diff
--- /dev/null
+++ b/services/opensky-adapter/src/tokenManager.ts
@@ -0,0 +1,40 @@
+type TokenState = {
+  accessToken: string;
+  expiresAt: number;
+};
+
+export class TokenManager {
+  private current?: TokenState;
+  private inflight?: Promise<string>;
+
+  constructor(
+    private readonly authUrl: string,
+    private readonly clientId: string,
+    private readonly clientSecret: string,
+    private readonly refreshMarginSeconds = 30
+  ) {}
+
+  async getAccessToken(): Promise<string> {
+    const now = Date.now();
+    if (this.current && now < this.current.expiresAt) {
+      return this.current.accessToken;
+    }
+
+    // Single-flight refresh avoids duplicate token exchanges under concurrent polling.
+    this.inflight ??= this.refresh();
+    try {
+      return await this.inflight;
+    } finally {
+      this.inflight = undefined;
+    }
+  }
+
+  private async refresh(): Promise<string> {
+    const response = await fetch(this.authUrl, {
+      method: "POST",
+      headers: {
+        "Content-Type": "application/x-www-form-urlencoded",
+        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`
+      },
+      body: "grant_type=client_credentials"
+    });
+    const payload = await response.json();
+    const expiresIn = Number(payload.expires_in ?? 1800);
+    this.current = {
+      accessToken: payload.access_token,
+      expiresAt: Date.now() + (expiresIn - this.refreshMarginSeconds) * 1000
+    };
+    return this.current.accessToken;
+  }
+}

```

**Documentation:**

```diff
--- a/services/opensky-adapter/src/tokenManager.ts
+++ b/services/opensky-adapter/src/tokenManager.ts
@@ -1,7 +1,15 @@
+/**
+ * OAuth token lifecycle helpers for OpenSky API calls.
+ */
 type TokenState = {
   accessToken: string;
   expiresAt: number;
 };

+/**
+ * Manages shared bearer tokens for adapter requests. (ref: DL-001)
+ */
 export class TokenManager {
@@ -13,6 +21,9 @@ export class TokenManager {
     private readonly refreshMarginSeconds = 30
   ) {}

+  /**
+   * Returns a valid token, refreshing once per concurrent burst.
+   */
   async getAccessToken(): Promise<string> {
@@ -27,6 +38,9 @@ export class TokenManager {
     }
   }

+  /**
+   * Exchanges client credentials for a new bearer token.
+   */
   private async refresh(): Promise<string> {
     const response = await fetch(this.authUrl, { method: "POST" });
     const payload = await response.json();

```

**CC-M-001-004** (services/opensky-adapter/src/openskyClient.ts) - implements CI-M-001-004

**Code:**

```diff
--- /dev/null
+++ b/services/opensky-adapter/src/openskyClient.ts
@@ -0,0 +1,42 @@
+import type { BoundingBox } from "./config";
+import { TokenManager } from "./tokenManager";
+import type { OpenSkyStatesResponse, RateLimitState } from "./types";
+
+export class OpenSkyClient {
+  constructor(
+    private readonly baseUrl: string,
+    private readonly tokens: TokenManager
+  ) {}
+
+  async fetchStates(bbox: BoundingBox): Promise<{ data: OpenSkyStatesResponse; rateLimit: RateLimitState }> {
+    const token = await this.tokens.getAccessToken();
+    const params = new URLSearchParams({
+      lamin: String(bbox.lamin),
+      lomin: String(bbox.lomin),
+      lamax: String(bbox.lamax),
+      lomax: String(bbox.lomax)
+    });
+
+    const response = await fetch(`${this.baseUrl}/states/all?${params.toString()}`, {
+      headers: { Authorization: `Bearer ${token}` }
+    });
+
+    if (response.status === 401) {
+      // One unauthorized retry keeps token expiry races local to the adapter boundary.
+      const retryToken = await this.tokens.getAccessToken();
+      const retryResponse = await fetch(`${this.baseUrl}/states/all?${params.toString()}`, {
+        headers: { Authorization: `Bearer ${retryToken}` }
+      });
+      if (!retryResponse.ok) {
+        throw new Error(`OpenSky returned ${retryResponse.status} after token refresh`);
+      }
+      return {
+        data: await retryResponse.json(),
+        rateLimit: {
+          remaining: Number(retryResponse.headers.get("x-rate-limit-remaining") ?? 0),
+          retryAfterSeconds: Number(retryResponse.headers.get("x-rate-limit-retry-after-seconds") ?? 0)
+        }
+      };
+    }
+
+    return {
+      data: await response.json(),
+      rateLimit: {
+        remaining: Number(response.headers.get("x-rate-limit-remaining") ?? 0),
+        retryAfterSeconds: Number(response.headers.get("x-rate-limit-retry-after-seconds") ?? 0)
+      }
+    };
+  }
+}

```

**Documentation:**

```diff
--- a/services/opensky-adapter/src/openskyClient.ts
+++ b/services/opensky-adapter/src/openskyClient.ts
@@ -1,8 +1,16 @@
+/**
+ * OpenSky REST client wrapper for state-vector retrieval.
+ */
 import type { BoundingBox } from "./config";
 import { TokenManager } from "./tokenManager";
 import type { OpenSkyStatesResponse, RateLimitState } from "./types";

+/**
+ * Calls OpenSky using adapter-managed OAuth credentials. (ref: DL-001)
+ */
 export class OpenSkyClient {
@@ -9,6 +17,9 @@ export class OpenSkyClient {
     private readonly tokens: TokenManager
   ) {}

+  /**
+   * Retrieves live state vectors and captures rate-limit response metadata. (ref: DL-003)
+   */
   async fetchStates(bbox: BoundingBox): Promise<{ data: OpenSkyStatesResponse; rateLimit: RateLimitState }> {
     const token = await this.tokens.getAccessToken();
@@ -22,6 +33,7 @@ export class OpenSkyClient {

     if (response.status === 401) {
       // One unauthorized retry keeps token expiry races local to the adapter boundary.
+      // Retry behavior is part of shared token lifecycle handling. (ref: DL-001)
       const retryToken = await this.tokens.getAccessToken();
       return this.fetchStates(bbox);
     }

```

**CC-M-001-005** (services/opensky-adapter/src/types.ts) - implements CI-M-001-005

**Code:**

```diff
--- /dev/null
+++ b/services/opensky-adapter/src/types.ts, services/opensky-adapter/src/normalizer.ts
@@ -0,0 +1,38 @@
+export const STATE_VECTOR_INDEX = {
+  icao24: 0,
+  callsign: 1,
+  originCountry: 2,
+  timePosition: 3,
+  lastContact: 4,
+  longitude: 5,
+  latitude: 6,
+  baroAltitude: 7,
+  onGround: 8,
+  velocity: 9,
+  trueTrack: 10,
+  verticalRate: 11,
+  geoAltitude: 13,
+  squawk: 14,
+  spi: 15,
+  positionSource: 16,
+  category: 17
+} as const;
+
+export type OpenSkyStatesResponse = { time: number; states: unknown[][] | null };
+
+export type RateLimitState = { remaining: number; retryAfterSeconds: number };
+
+export type AircraftSnapshotRow = {
+  icao24: string;
+  callsign: string | null;
+  latitude: number;
+  longitude: number;
+  last_contact: number;
+  time_position: number | null;
+  velocity: number | null;
+  true_track: number | null;
+  vertical_rate: number | null;
+  geo_altitude: number | null;
+  origin_country: string;
+};

```

**Documentation:**

```diff
--- a/services/opensky-adapter/src/types.ts, services/opensky-adapter/src/normalizer.ts
+++ b/services/opensky-adapter/src/types.ts, services/opensky-adapter/src/normalizer.ts
@@ -1,3 +1,8 @@
+/**
+ * OpenSky field index mapping and normalized adapter row contracts.
+ * Normalization responsibilities stay in the adapter boundary. (ref: DL-004)
+ */
 export const STATE_VECTOR_INDEX = {
   icao24: 0,
   callsign: 1,
@@ -22,6 +27,9 @@ export type OpenSkyStatesResponse = { time: number; states: unknown[][] | null };

 export type RateLimitState = { remaining: number; retryAfterSeconds: number };

+/**
+ * Flattened row contract returned by /live/states snapshots.
+ */
 export type AircraftSnapshotRow = {
   icao24: string;
   callsign: string | null;

```

### Milestone 2: Publish a cached live snapshot endpoint with credit-aware polling controls

**Files**: services/opensky-adapter/src/stateCache.ts, services/opensky-adapter/src/pollScheduler.ts, services/opensky-adapter/src/server.ts, services/opensky-adapter/src/routes/liveStates.ts

**Requirements**:

- Single shared poller per bbox query key
- In-memory cached latest snapshot for viewer fan-out
- Credit-aware cadence and retry-after handling
- Stale or null aircraft filtering before publication

**Acceptance Criteria**:

- Concurrent viewers reuse shared cached snapshots instead of triggering duplicate upstream polls
- Adapter clamps unsupported bbox sizes and surfaces rate-limit state
- Published rows expose freshness metadata and stable icao24 identity

**Tests**:

- integration:doc-derived:cache fan-out
- bbox policy
- 429 backoff and stale record eviction

#### Code Intent

- **CI-M-002-001** `services/opensky-adapter/src/stateCache.ts::getOrCreateSnapshot`: Store the latest normalized aircraft snapshot per bbox query key together with freshness metadata so concurrent viewers can share one upstream result. (refs: DL-003, DL-004)
- **CI-M-002-002** `services/opensky-adapter/src/pollScheduler.ts::schedulePoll`: Coordinate adaptive polling cadence, retry-after backoff, and rate-limit-aware refresh decisions for each cached bbox query key. (refs: DL-003)
- **CI-M-002-003** `services/opensky-adapter/src/routes/liveStates.ts::buildLiveStatesRoute`: Validate bbox requests, reject unsupported query shapes, and serve the current normalized aircraft snapshot with freshness and polling metadata. (refs: DL-001, DL-004)
- **CI-M-002-004** `services/opensky-adapter/src/server.ts::createServer`: Compose configuration, token management, OpenSky client access, cache state, and HTTP routes into one adapter service entrypoint. (refs: DL-001, DL-003)

#### Code Changes

**CC-M-002-001** (services/opensky-adapter/src/stateCache.ts) - implements CI-M-002-001

**Code:**

```diff
--- /dev/null
+++ b/services/opensky-adapter/src/stateCache.ts
@@ -0,0 +1,32 @@
+import type { AircraftSnapshotRow } from "./types";
+
+export type SnapshotEnvelope = {
+  rows: AircraftSnapshotRow[];
+  fetchedAt: number;
+  queryKey: string;
+  nextPollAt: number | null;
+};
+
+export class StateCache {
+  private readonly snapshots = new Map<string, SnapshotEnvelope>();
+
+  get(queryKey: string): SnapshotEnvelope | undefined {
+    return this.snapshots.get(queryKey);
+  }
+
+  set(snapshot: SnapshotEnvelope): void {
+    this.snapshots.set(snapshot.queryKey, snapshot);
+  }
+
+  getOrCreate(queryKey: string): SnapshotEnvelope {
+    return this.snapshots.get(queryKey) ?? {
+      rows: [],
+      fetchedAt: 0,
+      queryKey,
+      nextPollAt: null
+    };
+  }
+}

```

**Documentation:**

```diff
--- a/services/opensky-adapter/src/stateCache.ts
+++ b/services/opensky-adapter/src/stateCache.ts
@@ -1,5 +1,10 @@
+/**
+ * Snapshot cache keyed by query policy.
+ */
 import type { AircraftSnapshotRow } from "./types";

+/**
+ * Cached payload served to Terria clients. (ref: DL-003)
+ */
 export type SnapshotEnvelope = {
   rows: AircraftSnapshotRow[];
@@ -8,6 +13,9 @@ export type SnapshotEnvelope = {
   nextPollAt: number | null;
 };

+/**
+ * Stores latest normalized snapshot per bbox query key.
+ */
 export class StateCache {
@@ -18,6 +26,9 @@ export class StateCache {
     this.snapshots.set(snapshot.queryKey, snapshot);
   }

+  /**
+   * Returns an empty envelope when no snapshot exists for a key.
+   */
   getOrCreate(queryKey: string): SnapshotEnvelope {
     return this.snapshots.get(queryKey) ?? {
       rows: [],

```

**CC-M-002-002** (services/opensky-adapter/src/pollScheduler.ts) - implements CI-M-002-002

**Code:**

```diff
--- /dev/null
+++ b/services/opensky-adapter/src/pollScheduler.ts
@@ -0,0 +1,28 @@
+import type { RateLimitState } from "./types";
+
+export function schedulePoll(now: number, rateLimit: RateLimitState, defaultPollSeconds: number): number {
+  if (rateLimit.retryAfterSeconds > 0) {
+    return now + rateLimit.retryAfterSeconds * 1000;
+  }
+
+  // Remaining-credit-aware spacing protects the shared poller from exhausting daily budget.
+  const budgetAwareSeconds = rateLimit.remaining > 0 ? Math.max(defaultPollSeconds, Math.floor(86400 / rateLimit.remaining)) : defaultPollSeconds;
+  return now + budgetAwareSeconds * 1000;
+}

```

**Documentation:**

```diff
--- a/services/opensky-adapter/src/pollScheduler.ts
+++ b/services/opensky-adapter/src/pollScheduler.ts
@@ -1,5 +1,13 @@
 import type { RateLimitState } from "./types";

+/**
+ * Computes the next poll time from retry headers and remaining-credit budget.
+ *
+ * Retry-after takes precedence; otherwise cadence is widened as remaining
+ * credits shrink to protect shared daily budget. (ref: DL-003)
+ */
 export function schedulePoll(now: number, rateLimit: RateLimitState, defaultPollSeconds: number): number {
   if (rateLimit.retryAfterSeconds > 0) {
     return now + rateLimit.retryAfterSeconds * 1000;

```

**CC-M-002-003** (services/opensky-adapter/src/routes/liveStates.ts) - implements CI-M-002-003

**Code:**

```diff
--- /dev/null
+++ b/services/opensky-adapter/src/routes/liveStates.ts
@@ -0,0 +1,34 @@
+import { Router } from "express";
+import type { BoundingBox } from "../config";
+import { StateCache } from "../stateCache";
+
+export function buildLiveStatesRoute(cache: StateCache, maxBboxArea: number) {
+  const router = Router();
+
+  router.get("/live/states", async (req, res) => {
+    const lamin = Number(req.query.lamin);
+    const lomin = Number(req.query.lomin);
+    const lamax = Number(req.query.lamax);
+    const lomax = Number(req.query.lomax);
+
+    if ([lamin, lomin, lamax, lomax].some(Number.isNaN)) {
+      return res.status(400).json({ error: "bbox parameters must be numeric" });
+    }
+
+    const bbox: BoundingBox = { lamin, lomin, lamax, lomax };
+
+    const area = Math.abs((bbox.lamax - bbox.lamin) * (bbox.lomax - bbox.lomin));
+    if (area > maxBboxArea) {
+      return res.status(400).json({ error: "bbox exceeds configured area policy" });
+    }
+
+    const queryKey = `${bbox.lamin}:${bbox.lomin}:${bbox.lamax}:${bbox.lomax}`;
+    const snapshot = cache.getOrCreate(queryKey);
+
+    // Adapter metadata keeps Terria refresh behavior visible without leaking provider secrets.
+    return res.json(snapshot);
+  });
+
+  return router;
+}

```

**Documentation:**

```diff
--- a/services/opensky-adapter/src/routes/liveStates.ts
+++ b/services/opensky-adapter/src/routes/liveStates.ts
@@ -1,7 +1,15 @@
+/**
+ * HTTP routes that publish cached adapter snapshots to Terria.
+ */
 import { Router } from "express";
 import type { BoundingBox } from "../config";
 import { StateCache } from "../stateCache";

+/**
+ * Builds the public live snapshot endpoint.
+ * Enforces bbox policy before returning cached rows. (ref: DL-003)
+ */
 export function buildLiveStatesRoute(cache: StateCache, maxBboxArea: number) {
   const router = Router();

```

**CC-M-002-004** (services/opensky-adapter/src/server.ts) - implements CI-M-002-004

**Code:**

```diff
--- /dev/null
+++ b/services/opensky-adapter/src/server.ts
@@ -0,0 +1,30 @@
+import express from "express";
+import { loadConfig } from "./config";
+import { TokenManager } from "./tokenManager";
+import { OpenSkyClient } from "./openskyClient";
+import { StateCache } from "./stateCache";
+import { buildLiveStatesRoute } from "./routes/liveStates";
+
+export function createServer() {
+  const config = loadConfig();
+  const tokens = new TokenManager(config.authUrl, config.clientId, config.clientSecret);
+  const client = new OpenSkyClient(config.openskyBaseUrl, tokens);
+  const cache = new StateCache();
+  const app = express();
+
+  app.get("/health", (_req, res) => res.json({ ok: true }));
+  app.use(buildLiveStatesRoute(cache, config.maxBboxArea));
+
+  return { app, client, cache, config };
+}
+
+const isMain = import.meta.url === `file://${process.argv[1]}`;
+if (isMain) {
+  const { app } = createServer();
+  app.listen(4010);
+}

```

**Documentation:**

```diff
--- a/services/opensky-adapter/src/server.ts
+++ b/services/opensky-adapter/src/server.ts
@@ -1,3 +1,8 @@
+/**
+ * Adapter process composition and route wiring.
+ */
 import express from "express";
 import { loadConfig } from "./config";
 import { TokenManager } from "./tokenManager";
@@ -5,6 +10,10 @@ import { OpenSkyClient } from "./openskyClient";
 import { StateCache } from "./stateCache";
 import { buildLiveStatesRoute } from "./routes/liveStates";

+/**
+ * Creates app dependencies behind a server-side OpenSky boundary. (ref: DL-001)
+ */
 export function createServer() {
@@ -13,6 +22,7 @@ export function createServer() {

   app.get("/health", (_req, res) => res.json({ ok: true }));
+  // Route contract serves normalized snapshots consumed by Terria api-table. (ref: DL-002)
   app.use(buildLiveStatesRoute(cache, config.maxBboxArea));

   return { app, client, cache, config };

```

### Milestone 3: Add a Terria live aircraft layer backed by the adapter contract

**Files**: wwwroot/init/simple.json, wwwroot/config.json

**Requirements**:

- Catalog entry for live aircraft snapshot feed
- api-table mapping for latitude longitude identity and feature info
- Refresh interval aligned with adapter cadence
- Config surface for adapter base URL or dataset toggling

**Acceptance Criteria**:

- Terria can load the live aircraft layer without React or bootstrap changes
- Feature info shows callsign country altitude speed and freshness fields
- Layer configuration remains compatible with existing init and deployment patterns

**Tests**:

- integration:doc-derived:catalog item loads and renders normalized aircraft points

#### Code Intent

- **CI-M-003-001** `wwwroot/init/simple.json`: Add a live aircraft catalog item that polls the adapter snapshot endpoint through api-table traits, maps aircraft identity and location fields, and exposes feature info for callsign, country, altitude, speed, and freshness. (refs: DL-002, DL-004)
- **CI-M-003-002** `wwwroot/config.json`: Expose public configuration for enabling the live aircraft dataset and supplying the adapter base URL without embedding OpenSky credentials in client-delivered config. (refs: DL-001, DL-002)

#### Code Changes

**CC-M-003-001** (wwwroot/init/simple.json) - implements CI-M-003-001

**Code:**

```diff
--- a/wwwroot/init/simple.json
+++ b/wwwroot/init/simple.json
@@ -208,6 +208,42 @@
       ]
     },
+    {
+      "id": "openskyLiveExamples",
+      "type": "group",
+      "name": "Live Aircraft",
+      "members": [
+        {
+          "id": "openskyLiveAircraft",
+          "type": "api-table",
+          "name": "OpenSky Live Aircraft",
+          "description": "Live aircraft positions normalized by the OpenSky adapter service.",
+          "idKey": "icao24",
+          "refreshInterval": 30,
+          "shouldAppendNewData": false,
+          "apis": [
+            {
+              "url": "/api/opensky/live/states",
+              "responseDataPath": "rows",
+              "kind": "PER_ROW"
+            }
+          ],
+          "columns": [
+            { "name": "icao24" },
+            { "name": "callsign" },
+            { "name": "origin_country" },
+            { "name": "latitude" },
+            { "name": "longitude" },
+            { "name": "geo_altitude" },
+            { "name": "velocity" },
+            { "name": "true_track" },
+            { "name": "last_contact" }
+          ],
+          "defaultStyle": {
+            "latitudeColumn": "latitude",
+            "longitudeColumn": "longitude",
+            "time": { "timeColumn": "last_contact", "idColumns": ["icao24"] },
+            "trail": { "enabled": true, "null": { "trailTime": 300, "width": 1 } }
+          }
+        }
+      ]
+    },
     {
       "id": "QwErTyUiOp",
       "type": "group",

```

**Documentation:**

```diff
--- a/wwwroot/init/simple.json
+++ b/wwwroot/init/simple.json
@@ -152,7 +152,7 @@
           "id": "openskyLiveAircraft",
           "type": "api-table",
           "name": "OpenSky Live Aircraft",
-          "description": "Live aircraft positions normalized by the OpenSky adapter service.",
+          "description": "Live aircraft positions normalized by the OpenSky adapter service. Adapter-owned auth, cadence, and normalization keep the client contract stable. (ref: DL-001, DL-002, DL-004)",
           "idKey": "icao24",
           "refreshInterval": 30,
           "shouldAppendNewData": false,

```

**CC-M-003-002** (wwwroot/config.json) - implements CI-M-003-002

**Code:**

```diff
--- a/wwwroot/config.json
+++ b/wwwroot/config.json
@@ -67,6 +67,14 @@
     },
     "searchBarConfig": {},
     "searchProviders": [],
+    "liveAircraft": {
+      "enabled": false,
+      "adapterBaseUrl": "/api/opensky",
+      // Shared polling belongs in the adapter; client refresh only follows published cadence.
+      "refreshSeconds": 30,
+      // Relative paths keep Terria deployment agnostic to the adapter ingress hostname.
+      "snapshotPath": "/live/states"
+    },
     "useCesiumIonTerrain": false,
     "helpContent": [
       {

```

**Documentation:**

```diff
--- a/wwwroot/config.json
+++ b/wwwroot/config.json
@@ -72,9 +72,9 @@
     "liveAircraft": {
       "enabled": false,
       "adapterBaseUrl": "/api/opensky",
-      // Shared polling belongs in the adapter; client refresh only follows published cadence.
+      // Shared polling belongs in the adapter; client refresh follows published cadence only. (ref: DL-003)
       "refreshSeconds": 30,
-      // Relative paths keep Terria deployment agnostic to the adapter ingress hostname.
+      // Relative paths keep Terria deployment agnostic to adapter ingress details. (ref: DL-002)
       "snapshotPath": "/live/states"
     },
     "useCesiumIonTerrain": false,

```

### Milestone 4: Wire local and deployment surfaces to the adapter service

**Files**: package.json, deploy/helm/terria/charts/terriamap/values.yaml, deploy/helm/terria/charts/terriamap/templates/configmap-client.yaml

**Requirements**:

- Local development path starts TerriaMap with documented adapter expectations
- Container and Helm values expose adapter URL and secret injection points
- Deployment model keeps adapter and TerriaMap contracts explicit
- Operational configuration documents conservative default cadence

**Acceptance Criteria**:

- Deployment manifests can provide the adapter endpoint without hardcoding secrets into client config
- Local startup guidance explains how the map discovers the adapter
- Runtime config distinguishes public adapter URL from private OpenSky credentials

**Tests**:

- integration:doc-derived:deployment values render adapter connection settings correctly

#### Code Intent

- **CI-M-004-001** `package.json`: Add local development scripts or workspace wiring that make the TerriaMap app and the adapter service discoverable together during development. (refs: DL-001)
- **CI-M-004-002** `deploy/helm/terria/charts/terriamap/values.yaml`: Define public adapter URL and cadence-related deployment values that can be rendered into client-facing config without exposing provider secrets. (refs: DL-001, DL-003)
- **CI-M-004-003** `deploy/helm/terria/charts/terriamap/templates/configmap-client.yaml`: Render the adapter discovery values into client configuration so deployed TerriaMap instances can reach the normalized live aircraft endpoint. (refs: DL-001, DL-002)
- **CI-M-004-004** `plans/opensky.md`: Publish the integration plan as a project reference document covering architecture, decision baseline, milestone structure, and escalation criteria. (refs: DL-001, DL-002, DL-003, DL-004)

#### Code Changes

**CC-M-004-001** (package.json) - implements CI-M-004-001

**Code:**

```diff
--- a/package.json
+++ b/package.json
@@ -68,6 +68,8 @@
     "webpack": "^5.96.1",
     "webpack-cli": "^5.1.4",
+    "tsx": "^4.19.2",
     "yargs": "^17.7.2"
   },
   "scripts": {
@@ -78,6 +80,9 @@
     "start": "terriajs-server --config-file serverconfig.json",
+    "dev:opensky-adapter": "tsx services/opensky-adapter/src/server.ts",
     "gulp": "gulp",
+    "dev:live-aircraft": "yarn dev:opensky-adapter",
     "postinstall": "echo 'Installation successful. What to do next:\n  yarn gulp dev   # Starts the server on port 3001, builds TerriaMap and dependencies, and rebuilds if files change.'",
     "prettier": "prettier --write .",
     "prettier-check": "prettier --check ."

```

**Documentation:**

```diff
--- a/package.json
+++ b/package.json
@@ -83,7 +83,9 @@
     "dev:opensky-adapter": "tsx services/opensky-adapter/src/server.ts",
     "gulp": "gulp",
     "dev:live-aircraft": "yarn dev:opensky-adapter",
-    "postinstall": "echo 'Installation successful. What to do next:\n  yarn gulp dev   # Starts the server on port 3001, builds TerriaMap and dependencies, and rebuilds if files change.'",
+    "postinstall": "echo 'Installation successful. What to do next:\n  yarn gulp dev           # Starts the server on port 3001, builds TerriaMap and dependencies, and rebuilds if files change.\n  yarn dev:opensky-adapter # Runs the OpenSky adapter boundary locally. (ref: DL-001)\n  yarn dev:live-aircraft   # Alias for local live-aircraft adapter workflow. (ref: DL-003)'",
     "prettier": "prettier --write .",
     "prettier-check": "prettier --check ."
   }

```

**CC-M-004-002** (deploy/helm/terria/charts/terriamap/values.yaml) - implements CI-M-004-002

**Code:**

```diff
--- a/deploy/helm/terria/charts/terriamap/values.yaml
+++ b/deploy/helm/terria/charts/terriamap/values.yaml
@@ -9,6 +9,11 @@
   initializationUrls:
     - helm
     - terria
+  liveAircraft:
+    enabled: false
+    adapterBaseUrl: "https://opensky-adapter.example.com"
+    refreshSeconds: 30
+    snapshotPath: "/live/states"
   parameters:
     disclaimer:
       text: "Disclaimer: This map must not be used for navigation or precise spatial analysis"
@@ -34,6 +39,14 @@
     supportEmail: "help@example.com"
     mobileDefaultViewerMode: "2d"
     experimentalFeatures: true
+liveAircraftConfig:
+  id: "openskyHelmAircraft"
+  type: "api-table"
+  name: "OpenSky Live Aircraft"
+  apis:
+    - url: "https://opensky-adapter.example.com/live/states"
+      responseDataPath: "rows"
+      kind: "PER_ROW"
 initConfig:
   homeCamera:
     north: "-8"

```

**Documentation:**

```diff
--- a/deploy/helm/terria/charts/terriamap/values.yaml
+++ b/deploy/helm/terria/charts/terriamap/values.yaml
@@ -9,6 +9,7 @@ clientConfig:
   initializationUrls:
     - helm
     - terria
+    # Adapter URL points at the server-side OpenSky boundary. (ref: DL-001)
     liveAircraft:
       enabled: false
       adapterBaseUrl: "https://opensky-adapter.example.com"
@@ -39,6 +40,7 @@ clientConfig:
     mobileDefaultViewerMode: "2d"
     experimentalFeatures: true
 liveAircraftConfig:
+  # api-table consumes normalized adapter snapshots as row objects. (ref: DL-002)
   id: "openskyHelmAircraft"
   type: "api-table"
   name: "OpenSky Live Aircraft"

```

**CC-M-004-003** (deploy/helm/terria/charts/terriamap/templates/configmap-client.yaml) - implements CI-M-004-003

**Code:**

```diff
--- a/deploy/helm/terria/charts/terriamap/templates/configmap-client.yaml
+++ b/deploy/helm/terria/charts/terriamap/templates/configmap-client.yaml
@@ -5,4 +5,5 @@
   labels:
     pod: {{ printf "%s-%s" .Release.Name "terriamap" | trunc 63 | trimSuffix "-" | quote }}
 data:
   config.json: '{{ toJson .Values.clientConfig | indent 2 }}'
+  live-aircraft.json: '{{ toJson .Values.liveAircraftConfig | indent 2 }}'
   helm.json: '{{ toJson .Values.initConfig | indent 2 }}'

```

**Documentation:**

```diff
--- a/deploy/helm/terria/charts/terriamap/templates/configmap-client.yaml
+++ b/deploy/helm/terria/charts/terriamap/templates/configmap-client.yaml
@@ -7,5 +7,6 @@ metadata:
 data:
   config.json: '{{ toJson .Values.clientConfig | indent 2 }}'
+  # Publishes adapter-backed api-table seed config for live aircraft layers. (ref: DL-002)
   live-aircraft.json: '{{ toJson .Values.liveAircraftConfig | indent 2 }}'
   helm.json: '{{ toJson .Values.initConfig | indent 2 }}'

```

**CC-M-004-004** (plans/opensky.md)

**Documentation:**

````diff
--- /dev/null
+++ b/plans/opensky.md
@@ -0,0 +1,95 @@
+# OpenSky Live Aircraft Integration Plan
+
+## Objective
+
+Add live aircraft positions to TerriaMap through a server-side OpenSky adapter
+and an `api-table` layer, with explicit auth, credit, and freshness controls.
+
+## Scope
+
+- Adapter service skeleton and runtime wiring
+- OAuth2 client-credentials token lifecycle in server code
+- Cached `/live/states` snapshot contract for Terria consumption
+- Terria catalog/config integration for live aircraft display
+- Local and Helm surfaces for adapter discovery and configuration
+
+## Out of Scope
+
+- Full historical flight and track product design
+- Plugin-first custom catalog item implementation
+- Browser-direct authenticated OpenSky access
+
+## Decision Baseline
+
+- `DL-001`: Server-side OpenSky adapter boundary for auth and token exchange
+- `DL-002`: `api-table` first integration path, plugin escalation later
+- `DL-003`: Centralized credit-aware polling by bbox query key
+- `DL-004`: Adapter-owned normalization (`icao24`, stale/null filtering)
+
+## Target Architecture
+
+1. Terria client requests normalized snapshots from adapter endpoint:
+   `GET /api/opensky/live/states?lamin=...&lomin=...&lamax=...&lomax=...`
+2. Adapter enforces bbox policy and serves cached rows by query key.
+3. Shared poller fetches OpenSky `/states/all` with bearer token.
+4. Poll scheduler uses retry headers and remaining-credit-aware spacing.
+5. Adapter publishes metadata (`fetchedAt`, `nextPollAt`) with row payload.
+
+## Adapter Data Contract
+
+```json
+{
+  "rows": [{ "icao24": "3c6444", "latitude": 50.0333, "longitude": 8.5622, "last_contact": 1712345678 }],
+  "fetchedAt": 1712345679000,
+  "queryKey": "45:5:47:10",
+  "nextPollAt": 1712345709000
+}
+```
+
+Adapter invariants:
+
+- Deduplicate by `icao24`
+- Reject rows with null `latitude` or `longitude`
+- Evict stale aircraft by contact-time policy
+- Keep provider credentials and token exchange server-side only
+
+## Milestones
+
+### M-001: Adapter contract and skeleton
+
+- Add `services/opensky-adapter` package and TypeScript server entrypoint
+- Define config and policy knobs (`maxBboxArea`, poll defaults)
+- Add token manager, OpenSky client wrappers, and row types
+
+### M-002: Cached live endpoint and polling controls
+
+- Add query-keyed snapshot cache
+- Add retry-aware and budget-aware poll scheduler
+- Expose `/live/states` route with bbox-area guardrail
+
+### M-003: Terria live layer integration
+
+- Add `api-table` live aircraft member in `wwwroot/init/simple.json`
+- Map `idKey=icao24`, point columns, time, and trail style
+- Add `liveAircraft` config block in `wwwroot/config.json`
+
+### M-004: Runtime and deployment wiring
+
+- Add local scripts for adapter development
+- Add Helm values for adapter endpoint and live layer seed
+- Publish `live-aircraft.json` via client config map template
+
+## Risks and Mitigations
+
+- Token expiry races -> shared token manager with single-flight refresh
+- Credit exhaustion / `429` -> centralized poller, bbox clamp, adaptive cadence
+- Ghost and jitter aircraft -> adapter-side normalization and stale eviction
+- Premature plugin complexity -> ship `api-table` path first
+
+## Validation Checklist
+
+- Adapter returns normalized `rows` envelope for valid bbox query
+- Oversized bbox returns policy error
+- Unauthorized response path refreshes token and retries once
+- Terria live layer loads from adapter and refreshes without append growth
+
+## Escalation Criteria
+
+Escalate to custom plugin/catalog item only if table-style configuration cannot
+express required domain behavior.
+
````
