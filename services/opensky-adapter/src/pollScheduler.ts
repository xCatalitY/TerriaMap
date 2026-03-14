import type { RateLimitState } from "./types";

/**
 * Computes the next poll time from retry headers and remaining-credit budget.
 *
 * Retry-after takes precedence; otherwise cadence is widened as remaining
 * credits shrink to protect shared daily budget. (ref: DL-003)
 */
export function schedulePoll(
  now: number,
  rateLimit: RateLimitState,
  defaultPollSeconds: number
): number {
  if (rateLimit.retryAfterSeconds > 0) {
    return now + rateLimit.retryAfterSeconds * 1000;
  }

  // Remaining-credit-aware spacing protects the shared poller from exhausting daily budget.
  const budgetAwareSeconds =
    rateLimit.remaining > 0
      ? Math.max(defaultPollSeconds, Math.floor(86400 / rateLimit.remaining))
      : defaultPollSeconds;
  return now + budgetAwareSeconds * 1000;
}
