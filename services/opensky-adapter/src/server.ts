/**
 * Adapter process composition and route wiring.
 */
import express from "express";
import { loadConfig } from "./config";
import { TokenManager } from "./tokenManager";
import { OpenSkyClient } from "./openskyClient";
import { StateCache } from "./stateCache";
import { PollCoordinator } from "./pollCoordinator";
import { buildLiveStatesRoute } from "./routes/liveStates";
import { buildLiveCzmlRoute } from "./routes/liveCzml";

/**
 * Creates app dependencies behind a server-side OpenSky boundary. (ref: DL-001)
 */
export function createServer() {
  const config = loadConfig();
  const tokens = new TokenManager(
    config.authUrl,
    config.clientId,
    config.clientSecret
  );
  const client = new OpenSkyClient(config.openskyBaseUrl, tokens);
  const cache = new StateCache();
  const poller = new PollCoordinator(client, cache, config.defaultPollSeconds);
  const app = express();

  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept"
    );
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  // Route contract serves normalized snapshots consumed by Terria api-table. (ref: DL-002)
  app.use(buildLiveStatesRoute(cache, poller, config.maxBboxArea));
  app.use(buildLiveCzmlRoute(cache, poller, config.maxBboxArea));

  return { app, client, cache, config };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { app } = createServer();
  app.listen(4010);
}
