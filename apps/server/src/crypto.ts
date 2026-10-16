import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/** API tokens look like kdx_<40 url-safe chars>. Only their SHA-256 is stored. */
export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = `kdx_${randomBytes(30).toString("base64url")}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 10) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomSecret(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function hmacSha256(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Encrypts stored secrets (webhook and integration secrets) at rest with
 * AES-256-GCM, using a key derived from AUTH_SECRET. A database dump alone
 * is not enough to forge signatures.
 */
export function createSealer(authSecret: string) {
  const key = Buffer.from(hkdfSync("sha256", authSecret, "kadrix", "secrets-at-rest-v1", 32));
  return {
    seal(plain: string): string {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
    },
    open(sealed: string): string {
      const [v, iv, tag, data] = sealed.split(".");
      if (v !== "v1" || !iv || !tag || !data) throw new Error("bad sealed value");
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
    },
  };
}
export type Sealer = ReturnType<typeof createSealer>;
