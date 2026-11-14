// All settings come from environment variables. Nothing secret lives in the code.

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const efforts = ["low", "medium", "high"] as const;
type Effort = (typeof efforts)[number];
function effort(value: string | undefined): Effort {
  return (efforts as readonly string[]).includes(value ?? "") ? (value as Effort) : "medium";
}

export const config = {
  port: num(process.env.PORT, 3000),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: process.env.DATABASE_URL ?? "",

  // Claude
  hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
  model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
  effort: effort(process.env.CLAUDE_EFFORT),
  // Development only: canned answers instead of real Claude calls.
  fakeAi: process.env.FAKE_AI === "1",

  // Access
  passcode: process.env.APP_PASSCODE ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "",

  // Display
  usdToNok: num(process.env.USD_TO_NOK, 10.5),

  // Limits
  maxPhotosPerBatch: 40,
  maxUploadBytes: 20 * 1024 * 1024,
};
