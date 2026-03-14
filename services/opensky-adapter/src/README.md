# OpenSky Adapter

## Overview

The adapter exposes live aircraft positions as a normalized snapshot API for TerriaMap. It owns OpenSky OAuth2 credential handling, shared credit-aware polling, and freshness enforcement so the Terria client receives a stable row contract with no provider secrets.

## Architecture

```
TerriaMap (api-table, refreshInterval=30s)
  -> GET /live/states?lamin=...&lomin=...&lamax=...&lomax=...
    -> liveStates.ts  (bbox validation, area policy, quantization)
      -> PollCoordinator.ensureFresh  (demand-driven, single-flight per key)
        -> OpenSkyClient.fetchStates  (bearer auth, /states/all, rate-limit headers)
          -> TokenManager.getAccessToken  (cached token, single-flight refresh)
        -> normalizeStates  (dedup, null-position reject, stale eviction)
        -> StateCache.set  (snapshot stored by quantized query key)
      -> StateCache.getOrCreate  (snapshot returned to Terria)
      -> schedulePoll  (next poll time from rate-limit headers and budget)
```

Components own distinct responsibilities and do not share state across boundaries:

- `TokenManager`: token cache and OAuth2 exchange only; no polling or HTTP routing.
- `OpenSkyClient`: upstream fetch and rate-limit header capture only; no caching or scheduling.
- `normalizeStates`: pure transformation; no I/O or side effects.
- `StateCache`: read/write snapshot store; no scheduling or expiry logic.
- `PollCoordinator`: orchestrates fetch -> normalize -> cache -> schedule; owns per-key inflight deduplication and re-poll timers.
- `liveStates.ts`: HTTP boundary; validates requests and delegates to coordinator and cache.

## Design Decisions

**Dedicated adapter service, not a terriajs-server route (DL-001)**
OpenSky requires OAuth2 client credentials that cannot safely be delivered to the browser. terriajs-server is a static file and proxy server with no token lifecycle or scheduling primitives. A separate service isolates provider-specific logic and allows independent scaling and failure containment.

**api-table catalog item, not a custom Terria plugin (DL-002)**
TerriaMap ships api-table support for auto-refreshing table-backed point layers. A row-object snapshot feed fits that path with minimal change surface. Custom plugin work is deferred until the normalized dataset path proves insufficient (see Escalation Criteria below).

**Centralized polling by quantized bbox query key (DL-003)**
OpenSky charges credits per request. Per-viewer polling would multiply credit burn proportionally to concurrent users. A shared poller per quantized bbox key amortizes cost across all viewers with overlapping bounding boxes. Bbox coordinates are quantized to 1-degree integer boundaries so that distinct viewport shapes map to a bounded set of shared keys.

**Adapter-owned normalization (DL-004)**
Raw OpenSky state vectors can contain null latitude or longitude and stale contact timestamps. Pushing raw records into Terria produces ghost aircraft and positional jitter. The adapter rejects null positions, deduplicates by icao24, and evicts aircraft whose last_contact exceeds the stale threshold before the snapshot is stored.

## Invariants

- OpenSky OAuth credentials and token exchange never leave the adapter process.
- Aircraft identity in published rows is always keyed by icao24.
- Rows with null latitude or longitude are rejected before any snapshot is written.
- Polling cadence is set by rate-limit response headers and remaining-credit budget, not by the maximum documented provider resolution.
- Bbox query keys are always quantized to 1-degree integer boundaries before cache lookup or storage.
- One inflight upstream fetch per query key at any moment (single-flight in PollCoordinator).

## Escalation Criteria

Escalate from api-table to a custom Terria catalog type only when:

- Users require heading-based aircraft rotation (api-table points do not rotate).
- Users require 3D aircraft models (api-table does not support model rendering).
- Users require altitude-based marker scaling or vertical positioning in 3D view.
- Trail interpolation quality is insufficient for smooth aircraft tracking.
