# opensky-adapter/

OpenSky Network live aircraft adapter: OAuth2 token lifecycle, credit-aware polling, and normalized snapshot API for TerriaMap.

## Files

| File           | What                                        | When to read                                 |
| -------------- | ------------------------------------------- | -------------------------------------------- |
| `package.json` | Package manifest, scripts, and dependencies | Adding dependencies, running adapter locally |

## Subdirectories

| Directory | What                                  | When to read                                       |
| --------- | ------------------------------------- | -------------------------------------------------- |
| `src/`    | TypeScript source for adapter service | Modifying polling, token, cache, or route behavior |

## Build

```
yarn install
yarn dev   # runs tsx src/server.ts on port 4010
```

## Test

```
node --test
```
