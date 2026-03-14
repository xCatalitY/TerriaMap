# src/

TypeScript source for the OpenSky adapter service.

## Files

| File                 | What                                                                   | When to read                                              |
| -------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `server.ts`          | Process entrypoint: composes config, tokens, client, cache, routes     | Understanding service startup, adding routes              |
| `config.ts`          | Environment variable loading and adapter configuration types           | Adding config knobs, modifying bbox or cadence defaults   |
| `tokenManager.ts`    | OAuth2 bearer token lifecycle with single-flight refresh               | Debugging auth failures, modifying token expiry handling  |
| `openskyClient.ts`   | OpenSky REST client: bbox query, auth, rate-limit header capture       | Modifying upstream requests, handling new provider errors |
| `types.ts`           | STATE_VECTOR_INDEX mapping, OpenSkyStatesResponse, AircraftSnapshotRow | Changing row contract, adding fields                      |
| `normalizer.ts`      | Raw state-vector to AircraftSnapshotRow transformation                 | Changing normalization rules, adding fields to rows       |
| `stateCache.ts`      | In-memory snapshot store keyed by quantized bbox query key             | Debugging cache behavior, modifying freshness metadata    |
| `pollScheduler.ts`   | Next-poll-time calculation from rate-limit headers and budget          | Modifying cadence logic, debugging credit exhaustion      |
| `pollCoordinator.ts` | Demand-driven per-key poller with single-flight and re-poll timers     | Modifying polling coordination, debugging stale snapshots |
| `README.md`          | Architecture decisions, invariants, tradeoffs                          | Understanding adapter design before making changes        |

## Subdirectories

| Directory | What                                        | When to read                                 |
| --------- | ------------------------------------------- | -------------------------------------------- |
| `routes/` | Express route builders for public endpoints | Adding endpoints, modifying route validation |
