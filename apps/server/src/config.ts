import { parseEdition, type Edition } from "@veloq/core";
import type { AiConfig } from "./ai.js";

export interface Config {
  databaseUrl: string;
  authSecret: string;
  baseUrl: string;
  port: number;
  edition: Edition;
  /** Directory with the built web app to serve, if any. */
  webDist: string | null;
  /** Where uploaded files are stored. */
  dataDir: string;
  allowPrivateWebhooks: boolean;
  rateLimitPerMinute: number;
  authAttemptsPer5Min: number;
  trustProxy: number;
  smtpUrl: string | null;
  ai: AiConfig;
  passwordBreachCheck: boolean;
  mailFrom: string;
}

export function loadConfig(env = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  const authSecret = env.AUTH_SECRET;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!authSecret || authSecret.length < 32) {
    throw new Error("AUTH_SECRET is required and must be at least 32 characters");
  }
  return {
    databaseUrl,
    authSecret,
    baseUrl: env.BASE_URL ?? "http://localhost:3000",
    port: Number(env.PORT ?? 3000),
    edition: parseEdition(env.VELOQ_EDITION),
    webDist: env.WEB_DIST ?? null,
    dataDir: env.DATA_DIR ?? "./data",
    allowPrivateWebhooks: env.WEBHOOK_ALLOW_PRIVATE === "1",
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 600),
    authAttemptsPer5Min: Number(env.AUTH_ATTEMPTS_PER_5_MIN ?? 20),
    trustProxy: Number(env.TRUST_PROXY ?? 0),
    smtpUrl: env.SMTP_URL || null,
    passwordBreachCheck: env.PASSWORD_BREACH_CHECK === "1",
    ai: {
      provider: env.AI_PROVIDER === "anthropic" || env.AI_PROVIDER === "openai-compatible" ? env.AI_PROVIDER : null,
      baseUrl: env.AI_BASE_URL || null,
      apiKey: env.AI_API_KEY || null,
      model: env.AI_MODEL || null,
    },
    mailFrom: env.MAIL_FROM ?? "Veloq <no-reply@localhost>",
  };
}
