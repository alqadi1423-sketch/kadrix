import { schema, type Database } from "@kadrix/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { haveIBeenPwned, twoFactor } from "better-auth/plugins";
import { passwordProblem } from "./password.js";

/** Header the API sets to the resolved client address before calling auth. */
export const CLIENT_IP_HEADER = "x-kadrix-client-ip";

export interface AuthOptions {
  secret: string;
  baseUrl: string;
  /** Better Auth's own limiter (strict rules for sign-in and sign-up). Off in tests. */
  rateLimit?: boolean;
  /** Extra origins accepted besides baseUrl. */
  trustedOrigins?: string[];
  /** Refuse passwords found in known breaches (asks Have I Been Pwned with k-anonymity). */
  breachCheck?: boolean;
}

export function createAuth(db: Database, opts: AuthOptions) {
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.baseUrl,
    trustedOrigins: [opts.baseUrl, ...(opts.trustedOrigins ?? [])],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
      },
    }),
    // Two-step sign-in with an authenticator app, plus one-time backup codes.
    plugins: [twoFactor({ issuer: "Kadrix" }), ...(opts.breachCheck ? [haveIBeenPwned()] : [])],
    // NIST SP 800-63B-4: 15+ characters when a password is the only factor,
    // long passphrases allowed, no composition rules, common choices refused.
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 15,
      maxPasswordLength: 128,
    },
    rateLimit: { enabled: opts.rateLimit ?? true, window: 60, max: 100 },
    advanced: { ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        // Agent accounts never sign in or reset a password; they use tokens.
        if (typeof body.email === "string" && body.email.toLowerCase().endsWith("@agents.kadrix.invalid")) {
          throw new APIError("FORBIDDEN", { message: "Agents sign in with API tokens", code: "AGENT_ACCOUNT" });
        }
        const pw = ctx.path === "/sign-up/email" || ctx.path === "/reset-password" ? body.password ?? body.newPassword : ctx.path === "/change-password" ? body.newPassword : undefined;
        if (typeof pw !== "string") return;
        const problem = passwordProblem(pw, [String(body.email ?? ""), String(body.name ?? "")]);
        if (problem) throw new APIError("BAD_REQUEST", { message: problem, code: "WEAK_PASSWORD" });
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
