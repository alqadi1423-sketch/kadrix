import { describe, expect, it } from "vitest";
import { passwordProblem } from "./password.js";

describe("passwordProblem", () => {
  it("accepts passphrases in any language", () => {
    expect(passwordProblem("correct-horse-battery")).toBeNull();
    expect(passwordProblem("قهوة الصباح مع المطر")).toBeNull();
  });
  it("refuses repetitive, common and keyboard-run passwords", () => {
    expect(passwordProblem("aaaaaaaaaaaaaaaa")).not.toBeNull();
    expect(passwordProblem("passwordpassword1")).not.toBeNull();
    expect(passwordProblem("qwertyuiop123456")).not.toBeNull();
    expect(passwordProblem("123456789012345")).not.toBeNull();
  });
  it("refuses passwords built from the account's own details", () => {
    expect(passwordProblem("mohammed.alqadi2026", ["mohammed.alqadi@example.com"])).not.toBeNull();
  });
});
