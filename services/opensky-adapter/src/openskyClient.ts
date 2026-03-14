/**
 * OpenSky REST client wrapper for state-vector retrieval.
 */
import type { BoundingBox } from "./config";
import { TokenManager } from "./tokenManager";
import type { OpenSkyStatesResponse, RateLimitState } from "./types";

/**
 * Calls OpenSky using adapter-managed OAuth credentials. (ref: DL-001)
 */
export class OpenSkyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: TokenManager
  ) {}

  /**
   * Retrieves live state vectors and captures rate-limit response metadata. (ref: DL-003)
   */
  async fetchStates(
    bbox: BoundingBox
  ): Promise<{ data: OpenSkyStatesResponse; rateLimit: RateLimitState }> {
    const token = await this.tokens.getAccessToken();
    const params = new URLSearchParams({
      lamin: String(bbox.lamin),
      lomin: String(bbox.lomin),
      lamax: String(bbox.lamax),
      lomax: String(bbox.lomax),
      extended: "1"
    });

    const response = await fetch(
      `${this.baseUrl}/states/all?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    if (!response.ok && response.status !== 401) {
      throw new Error(`OpenSky returned ${response.status}`);
    }

    if (response.status === 401) {
      // One unauthorized retry keeps token expiry races local to the adapter boundary.
      // Retry behavior is part of shared token lifecycle handling. (ref: DL-001)
      this.tokens.invalidate();
      const retryToken = await this.tokens.getAccessToken();
      const retryResponse = await fetch(
        `${this.baseUrl}/states/all?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${retryToken}` }
        }
      );
      if (!retryResponse.ok) {
        throw new Error(
          `OpenSky returned ${retryResponse.status} after token refresh`
        );
      }
      return {
        data: await retryResponse.json(),
        rateLimit: {
          remaining: Number(
            retryResponse.headers.get("x-rate-limit-remaining") ?? 0
          ),
          retryAfterSeconds: Number(
            retryResponse.headers.get("x-rate-limit-retry-after-seconds") ?? 0
          )
        }
      };
    }

    return {
      data: await response.json(),
      rateLimit: {
        remaining: Number(response.headers.get("x-rate-limit-remaining") ?? 0),
        retryAfterSeconds: Number(
          response.headers.get("x-rate-limit-retry-after-seconds") ?? 0
        )
      }
    };
  }
}
