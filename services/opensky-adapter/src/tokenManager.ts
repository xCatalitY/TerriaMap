/**
 * OAuth token lifecycle helpers for OpenSky API calls.
 */
type TokenState = {
  accessToken: string;
  expiresAt: number;
};

/**
 * Manages shared bearer tokens for adapter requests. (ref: DL-001)
 */
export class TokenManager {
  private current?: TokenState;
  private inflight?: Promise<string>;

  constructor(
    private readonly authUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshMarginSeconds = 30
  ) {}

  /** Clears cached token so the next getAccessToken() triggers a fresh exchange. */
  invalidate(): void {
    this.current = undefined;
  }

  /**
   * Returns a valid token, refreshing once per concurrent burst.
   */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.current && now < this.current.expiresAt) {
      return this.current.accessToken;
    }

    // Single-flight refresh avoids duplicate token exchanges under concurrent polling.
    this.inflight ??= this.refresh();
    try {
      return await this.inflight;
    } finally {
      this.inflight = undefined;
    }
  }

  /**
   * Exchanges client credentials for a new bearer token.
   */
  private async refresh(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret
    });
    const response = await fetch(this.authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!response.ok) {
      throw new Error(`Auth server returned ${response.status}`);
    }
    const payload = await response.json();
    const expiresIn = Number(payload.expires_in ?? 1800);
    this.current = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + (expiresIn - this.refreshMarginSeconds) * 1000
    };
    return this.current.accessToken;
  }
}
