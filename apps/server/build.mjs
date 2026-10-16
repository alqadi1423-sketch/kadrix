import { build } from "esbuild";

// Bundle the server together with the @veloq/* workspace packages into one
// file. Third-party dependencies stay external and are installed in the
// production image.
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external: ["hono", "@hono/*", "better-auth", "better-auth/*", "drizzle-orm", "drizzle-orm/*", "postgres", "zod"],
});
