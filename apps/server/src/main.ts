import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { createDb, runMigrations } from "@kadrix/db";
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "./app.js";
import { createSealer } from "./crypto.js";
import { createMailer, startDigestWorker } from "./services/digest.js";
import { startDeliveryWorker } from "./services/webhooks.js";
import { createAiProvider } from "./ai.js";
import { allowedOrigins } from "./context.js";
import { createAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { createPgEventBus } from "./events.js";
import { mountCollab } from "./collab.js";
import { startRecurrenceWorker } from "./services/recurrence.js";
import { mountRealtime } from "./realtime.js";
import { createDiskStorage } from "./storage.js";

const config = loadConfig();

await runMigrations(config.databaseUrl, process.env.MIGRATIONS_DIR || undefined);

const { db } = createDb(config.databaseUrl);
// Setting the attempt budget to 0 turns off both layers of auth rate limiting.
const auth = createAuth(db, { secret: config.authSecret, baseUrl: config.baseUrl, rateLimit: config.authAttemptsPer5Min > 0,
  breachCheck: config.passwordBreachCheck,
  trustedOrigins: config.trustedOrigins,
});
const origins = allowedOrigins(config.baseUrl, config.trustedOrigins);
const events = createPgEventBus(config.databaseUrl);
const storage = createDiskStorage(config.dataDir);
const sealer = createSealer(config.authSecret);
startDeliveryWorker(db, { sealer, allowPrivate: config.allowPrivateWebhooks, baseUrl: config.baseUrl });

const mailer = await createMailer(config.smtpUrl, config.mailFrom);
if (mailer) startDigestWorker(db, mailer, config.baseUrl);
startRecurrenceWorker(db, events);

const root = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: root });
mountRealtime(root, upgradeWebSocket, { db, auth, events, origins });
mountCollab(root, upgradeWebSocket, { db, auth, events, origins });
root.route(
  "/",
  createApp({
    db,
    auth,
    edition: config.edition,
    events,
    storage,
    baseUrl: config.baseUrl,
    sealer,
    allowPrivateWebhooks: config.allowPrivateWebhooks,
    rateLimitPerMinute: config.rateLimitPerMinute,
    authAttemptsPer5Min: config.authAttemptsPer5Min,
    trustProxy: config.trustProxy,
    trustedOrigins: config.trustedOrigins,
    ai: createAiProvider(config.ai),
  }),
);

// In production the server also serves the built web app (one container).
if (config.webDist) {
  const dist = config.webDist;
  const indexHtml = await readFile(join(dist, "index.html"), "utf8");
  // Hashed build files never change; the service worker must always be fresh.
  root.use("/assets/*", async (c, next) => {
    await next();
    c.header("cache-control", "public, max-age=31536000, immutable");
  });
  root.use("/sw.js", async (c, next) => {
    await next();
    c.header("cache-control", "no-cache");
  });
  root.use("/*", serveStatic({ root: dist }));
  root.get("*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : c.html(indexHtml)));
}

const server = serve({ fetch: root.fetch, port: config.port }, (info) => {
  console.log(`Kadrix (${config.edition}) listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
