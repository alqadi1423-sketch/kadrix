import { parseEdition, type Edition } from "@veloq/core";

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
  githubWebhookSecret: string | null;
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
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET || null,
  };
}
