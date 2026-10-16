import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createDb, runMigrations } from "@veloq/db";
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "./app.js";
import { createAuth } from "./auth.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

await runMigrations(config.databaseUrl, process.env.MIGRATIONS_DIR || undefined);

const { db } = createDb(config.databaseUrl);
const auth = createAuth(db, { secret: config.authSecret, baseUrl: config.baseUrl });

const root = new Hono();
root.route("/", createApp({ db, auth, edition: config.edition }));

// In production the server also serves the built web app (one container).
if (config.webDist) {
  const dist = config.webDist;
  const indexHtml = await readFile(join(dist, "index.html"), "utf8");
  root.use("/*", serveStatic({ root: dist }));
  root.get("*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : c.html(indexHtml)));
}

serve({ fetch: root.fetch, port: config.port }, (info) => {
  console.log(`Veloq (${config.edition}) listening on http://localhost:${info.port}`);
});
