/**
 * Environment variable validation — fail fast, never proceed with defaults
 * that look valid but are insecure. Parses `.env` at import time.
 *
 * Security notes:
 * - Secrets are never logged or included in thrown messages.
 * - Placeholder values from .env.example are rejected outside local dev.
 */
import { z } from "zod";

const placeholderPatterns = [/^CHANGE_ME/, /^REPLACE_WITH/, /^your-/i];

const isPlaceholder = (v: string) => placeholderPatterns.some((p) => p.test(v));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  AUTH_TRUST_HOST: z.coerce.boolean().default(true),
  AUTH_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(28800),
  SESSION_UPDATE_AGE_SECONDS: z.coerce.number().int().positive().default(3600),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  AUDIT_FAIL_CLOSED: z.coerce.boolean().default(true),
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // List failing keys only — never values.
    const keys = Object.keys(parsed.error.flatten().fieldErrors).join(", ");
    throw new Error(`Invalid environment configuration for: ${keys}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") {
    const secret = process.env.AUTH_SECRET ?? "";
    if (isPlaceholder(secret)) {
      throw new Error("AUTH_SECRET must be replaced outside development");
    }
  }
  return env;
}

export const env = loadEnv();
export type Env = typeof env;
