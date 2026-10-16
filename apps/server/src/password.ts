/**
 * Screens a new password the way NIST SP 800-63B-4 asks: no composition
 * rules, but refuse values that are common, repetitive or built from the
 * account's own details. Length limits live in the auth config.
 */
const COMMON = [
  "password", "passw0rd", "qwerty", "azerty", "letmein", "welcome", "iloveyou", "admin", "monkey",
  "dragon", "football", "baseball", "sunshine", "princess", "trustno1", "abc123", "changeme",
  "veloq", "secret", "default", "login", "master", "superman", "starwars", "whatever",
  "كلمةالمرور", "كلمةسر", "مرحبا",
];
const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "abcdefghijklmnopqrstuvwxyz", "ضصثقفغعهخحجد", "شسيبلاتنمكط"];

function squash(s: string) {
  return s.normalize("NFKC").toLowerCase().replace(/[\s._-]+/g, "");
}

export function passwordProblem(password: string, context: string[] = []): string | null {
  const p = squash(password);
  if (new Set(p).size <= 3) return "Password is too repetitive";
  // Strip the common words and keyboard runs: what is left must still be substantial.
  let rest = p;
  for (const w of [...COMMON, ...context.flatMap((c) => squash(c).split("@")).filter((w) => w.length >= 4)]) {
    rest = rest.split(squash(w)).join("");
  }
  for (const row of ROWS) {
    for (let len = row.length; len >= 4; len--) {
      for (let i = 0; i + len <= row.length; i++) {
        const run = row.slice(i, i + len);
        rest = rest.split(run).join("").split([...run].reverse().join("")).join("");
      }
    }
  }
  rest = rest.replace(/(.)\1{2,}/g, "$1");
  if ([...rest].length < 8) return "Password is too easy to guess";
  return null;
}
