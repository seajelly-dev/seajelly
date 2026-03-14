export const AGENT_LIMITS = {
  MAX_STEPS: 40,
  MAX_TOKENS: 65536,
  /** Vercel timeout = 300s; leave ~25s for catch/markFailed/cleanup */
  MAX_WALL_TIME_MS: 275_000,
  MAX_SESSION_MESSAGES: 40,
  SUMMARY_THRESHOLD: 30,
} as const;
