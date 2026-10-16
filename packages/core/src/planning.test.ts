import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  burndown,
  criticalPath,
  isWorkingDay,
  velocity,
  workingDaysBetween,
} from "./planning.js";

const SA = [5, 6]; // Friday, Saturday
const WEST = [6, 0]; // Saturday, Sunday

describe("working days", () => {
  // 2026-10-16 is a Friday.
  it("respects the configured weekend", () => {
    expect(isWorkingDay("2026-10-16", SA)).toBe(false);
    expect(isWorkingDay("2026-10-16", WEST)).toBe(true);
    expect(isWorkingDay("2026-10-18", SA)).toBe(true); // Sunday
  });
  it("counts working days inclusively", () => {
    // Sun 18 .. Sat 24 October
    expect(workingDaysBetween("2026-10-18", "2026-10-24", SA)).toBe(5);
    expect(workingDaysBetween("2026-10-18", "2026-10-24", WEST)).toBe(5);
    expect(workingDaysBetween("2026-10-24", "2026-10-18", SA)).toBe(0);
  });
  it("adds working days skipping weekends", () => {
    // Thu 22 + 1 working day in Saudi = Sun 25
    expect(addWorkingDays("2026-10-22", 1, SA)).toBe("2026-10-25");
    // Starting on a weekend rolls forward first
    expect(addWorkingDays("2026-10-16", 0, SA)).toBe("2026-10-18");
  });
});

describe("burndown", () => {
  it("tracks remaining work and scope changes", () => {
    const pts = burndown(
      [
        { weight: 3, addedOn: "2026-10-18", closedOn: "2026-10-20" },
        { weight: 2, addedOn: "2026-10-18", closedOn: null },
        { weight: 5, addedOn: "2026-10-21", closedOn: null }, // added mid-cycle
      ],
      "2026-10-18",
      "2026-10-29",
      SA,
      "2026-10-22",
    );
    expect(pts.map((p) => p.date)).toEqual(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"]);
    expect(pts[0]).toMatchObject({ scope: 5, remaining: 5, ideal: 5 });
    expect(pts[2]).toMatchObject({ remaining: 2 });
    expect(pts[3]).toMatchObject({ scope: 10, remaining: 7 });
    // The ideal line falls but never goes below zero.
    expect(pts.every((p, i) => i === 0 || p.ideal <= pts[i - 1]!.ideal)).toBe(true);
  });
  it("keeps the ideal line flat over weekends", () => {
    const pts = burndown([{ weight: 4, addedOn: "2026-10-15", closedOn: null }], "2026-10-15", "2026-10-20", SA, "2026-10-20");
    const byDate = Object.fromEntries(pts.map((p) => [p.date, p.ideal]));
    expect(byDate["2026-10-16"]).toBe(byDate["2026-10-15"]);
    expect(byDate["2026-10-17"]).toBe(byDate["2026-10-15"]);
    expect(byDate["2026-10-20"]).toBe(0);
  });
});

describe("velocity", () => {
  it("averages the last three cycles", () => {
    expect(velocity([10, 20, 30, 40])).toBe(30);
    expect(velocity([])).toBeNull();
  });
});

describe("critical path", () => {
  it("finds the longest dependency chain", () => {
    const r = criticalPath(
      [
        { id: "design", duration: 3 },
        { id: "api", duration: 5 },
        { id: "ui", duration: 2 },
        { id: "docs", duration: 1 },
        { id: "release", duration: 1 },
      ],
      [
        { from: "design", to: "api" },
        { from: "design", to: "ui" },
        { from: "api", to: "release" },
        { from: "ui", to: "release" },
        { from: "docs", to: "release" },
      ],
    );
    expect(r.path).toEqual(["design", "api", "release"]);
    expect(r.length).toBe(9);
    expect(r.earliestStart.release).toBe(8);
  });
  it("survives dependency loops", () => {
    const r = criticalPath(
      [
        { id: "a", duration: 1 },
        { id: "b", duration: 1 },
        { id: "c", duration: 2 },
      ],
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    );
    expect(r.path).toEqual(["c"]);
  });
});
