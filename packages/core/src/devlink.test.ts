import { describe, expect, it } from "vitest";
import { branchName, findIssueKeys, keysFromBranch } from "./devlink.js";

describe("findIssueKeys", () => {
  it("classifies closing and linking words", () => {
    expect(findIssueKeys("Fixes VEL-42 and refs VEL-7")).toEqual([
      { key: "VEL-42", intent: "closes" },
      { key: "VEL-7", intent: "links" },
    ]);
  });
  it("handles lists, colons and case", () => {
    expect(findIssueKeys("closes: vel-1, VEL-2")).toEqual([
      { key: "VEL-1", intent: "closes" },
      { key: "VEL-2", intent: "closes" },
    ]);
  });
  it("lets skip remove a key", () => {
    expect(findIssueKeys("Refactor (skip VEL-9)")).toEqual([]);
  });
  it("understands Arabic closing words", () => {
    expect(findIssueKeys("يصلح WEB-3 في صفحة الدخول")).toEqual([{ key: "WEB-3", intent: "closes" }]);
  });
  it("prefers closing when a key appears twice", () => {
    expect(findIssueKeys("VEL-5 tidy up. Resolves VEL-5")).toEqual([{ key: "VEL-5", intent: "closes" }]);
  });
  it("ignores look-alikes inside words and URLs paths stay safe", () => {
    expect(findIssueKeys("UTF-8 is fine, ABCDEFG-1 too long, x-1 too short")).toEqual([{ key: "UTF-8", intent: "links" }]);
  });
});

describe("branches", () => {
  it("finds keys in branch names", () => {
    expect(keysFromBranch("vel-42-fix-login")).toEqual(["VEL-42"]);
    expect(keysFromBranch("feature/WEB-7_new")).toEqual(["WEB-7"]);
    expect(keysFromBranch("main")).toEqual([]);
  });
  it("suggests ASCII branch names, also for Arabic titles", () => {
    expect(branchName("VEL-42", "Fix the Login page!")).toBe("vel-42-fix-the-login-page");
    expect(branchName("WEB-3", "إصلاح صفحة الدخول")).toBe("web-3");
  });
});
