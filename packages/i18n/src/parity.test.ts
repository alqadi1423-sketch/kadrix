import { describe, expect, it } from "vitest";
import { messages } from "./index.js";

function flatten(obj: object, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v as object, key));
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe("Arabic and English stay equal", () => {
  const ar = flatten(messages.ar);
  const en = flatten(messages.en);

  it("have the same keys", () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it("have no empty strings", () => {
    for (const [k, v] of Object.entries({ ...ar, ...en })) expect(v.trim(), k).not.toBe("");
  });

  it("use the same placeholders", () => {
    for (const key of Object.keys(en)) {
      expect(placeholders(ar[key] ?? ""), key).toEqual(placeholders(en[key] ?? ""));
    }
  });
});
