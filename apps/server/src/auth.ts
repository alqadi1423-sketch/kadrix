import { schema, type Database } from "@veloq/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export function createAuth(db: Database, opts: { secret: string; baseUrl: string }) {
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.baseUrl,
    trustedOrigins: [opts.baseUrl],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
