import { describe, expect, it } from "vitest";
import {
  CSV_PRESETS,
  cumulativeFlow,
  flowTimes,
  buildTsQuery,
  foldSearchText,
  issuesFromCsv,
  issuesFromGitHub,
  matchesConditions,
  nextOccurrence,
  normalizeFieldValue,
  parseCsv,
  parseDuration,
  percentile,
} from "./extend.js";

describe("custom field values", () => {
  const select = { kind: "select" as const, options: [{ id: "a" }, { id: "b" }] };
  it("normalizes by kind and clears on empty", () => {
    expect(normalizeFieldValue({ kind: "number", options: [] }, 3)).toBe(3);
    expect(normalizeFieldValue(select, "a")).toBe("a");
    expect(normalizeFieldValue({ ...select, kind: "multiSelect" }, ["a", "a", "b"])).toEqual(["a", "b"]);
    expect(normalizeFieldValue(select, "")).toBeNull();
  });
  it("rejects values of the wrong shape", () => {
    expect(() => normalizeFieldValue(select, "zzz")).toThrow();
    expect(() => normalizeFieldValue({ kind: "number", options: [] }, "3")).toThrow();
    expect(() => normalizeFieldValue({ kind: "url", options: [] }, "javascript:alert(1)")).toThrow();
  });
});

describe("recurrence", () => {
  it("daily with an interval", () => {
    const r = { freq: "daily" as const, interval: 2, weekdays: [], dayOfMonth: null, startDate: "2026-10-01" };
    expect(nextOccurrence(r, null)).toBe("2026-10-01");
    expect(nextOccurrence(r, "2026-10-01")).toBe("2026-10-03");
    expect(nextOccurrence(r, "2026-10-02")).toBe("2026-10-03");
  });
  it("weekly on Sunday and Wednesday every other week", () => {
    // 2026-10-04 is a Sunday.
    const r = { freq: "weekly" as const, interval: 2, weekdays: [0, 3], dayOfMonth: null, startDate: "2026-10-04" };
    expect(nextOccurrence(r, null)).toBe("2026-10-04");
    expect(nextOccurrence(r, "2026-10-04")).toBe("2026-10-07");
    expect(nextOccurrence(r, "2026-10-07")).toBe("2026-10-18");
  });
  it("monthly on the 31st falls back to the last day", () => {
    const r = { freq: "monthly" as const, interval: 1, weekdays: [], dayOfMonth: 31, startDate: "2026-01-15" };
    expect(nextOccurrence(r, null)).toBe("2026-01-31");
    expect(nextOccurrence(r, "2026-01-31")).toBe("2026-02-28");
    expect(nextOccurrence(r, "2026-02-28")).toBe("2026-03-31");
  });
});

describe("automation conditions", () => {
  const issue = { stateId: "s1", stateCategory: "started" as const, priority: 1, type: "bug", assigneeId: null, labelIds: ["l1"], title: "Login خطأ" };
  it("all conditions must hold", () => {
    expect(matchesConditions(issue, [])).toBe(true);
    expect(matchesConditions(issue, [{ field: "priority", op: "is", value: 1 }, { field: "type", op: "is", value: "bug" }])).toBe(true);
    expect(matchesConditions(issue, [{ field: "assigneeId", op: "is", value: null }])).toBe(true);
    expect(matchesConditions(issue, [{ field: "labelId", op: "isNot", value: "l1" }])).toBe(false);
    expect(matchesConditions(issue, [{ field: "title", op: "contains", value: "خطأ" }])).toBe(true);
    expect(matchesConditions(issue, [{ field: "stateCategory", op: "isNot", value: "started" }])).toBe(false);
  });
});

describe("parseDuration", () => {
  it("reads English and Arabic", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("2d")).toBe(960);
    expect(parseDuration("١س ٣٠د")).toBe(90);
    expect(parseDuration("٢ ساعة")).toBe(120);
    expect(parseDuration("١٫٥ س")).toBe(90);
  });
  it("refuses noise", () => {
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("1h banana")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});

describe("reports", () => {
  const t = (d: string) => new Date(`${d}T12:00:00Z`);
  it("lead and cycle time from transitions", () => {
    const times = flowTimes(
      [{ issueId: "a", createdAt: t("2026-10-01") }, { issueId: "b", createdAt: t("2026-10-01") }],
      [
        { issueId: "a", toCategory: "unstarted", at: t("2026-10-01") },
        { issueId: "a", toCategory: "started", at: t("2026-10-03") },
        { issueId: "a", toCategory: "completed", at: t("2026-10-06") },
        { issueId: "b", toCategory: "started", at: t("2026-10-02") },
      ],
    );
    expect(times).toEqual([{ issueId: "a", doneAt: t("2026-10-06"), leadDays: 5, cycleDays: 3 }]);
    expect(percentile([1, 2, 3, 4, 10], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 10], 85)).toBe(10);
  });
  it("cumulative flow counts end-of-day categories", () => {
    const cfd = cumulativeFlow(
      [{ issueId: "a", createdAt: t("2026-10-01"), category: "completed" }],
      [
        { issueId: "a", toCategory: "unstarted", at: t("2026-10-01") },
        { issueId: "a", toCategory: "completed", at: t("2026-10-02") },
      ],
      "2026-09-30",
      "2026-10-02",
    );
    expect(cfd.map((r) => [r.date, r.unstarted, r.completed])).toEqual([
      ["2026-09-30", 0, 0],
      ["2026-10-01", 1, 0],
      ["2026-10-02", 0, 1],
    ]);
  });
});

describe("import", () => {
  it("parses quoted CSV with a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
  it("maps a Jira export, including repeated label columns", () => {
    const csv = [
      "Summary,Issue key,Issue Type,Status,Priority,Labels,Labels,Assignee,Created",
      'إصلاح الدخول,WEB-7,Bug,In Progress,High,auth,mobile,Sara@Example.com,2026-10-01 10:00',
      "Write docs,WEB-8,Story,Done,Low,,,,",
    ].join("\n");
    const [a, b] = issuesFromCsv(csv, CSV_PRESETS.jira);
    expect(a).toMatchObject({ externalId: "WEB-7", title: "إصلاح الدخول", type: "bug", stateCategory: "started", priority: 2, labels: ["auth", "mobile"], assigneeEmail: "sara@example.com" });
    expect(b).toMatchObject({ type: "feature", stateCategory: "completed", priority: 4, labels: [] });
  });
  it("maps GitHub issues and skips pull requests", () => {
    const out = issuesFromGitHub([
      { number: 1, title: "Crash", state: "closed", state_reason: "completed", labels: [{ name: "bug" }] },
      { number: 2, title: "Idea", state: "closed", state_reason: "not_planned" },
      { number: 3, title: "PR", state: "open", pull_request: {} },
    ]);
    expect(out.map((i) => [i.externalId, i.stateCategory, i.type])).toEqual([
      ["#1", "completed", "bug"],
      ["#2", "canceled", "task"],
    ]);
  });
});

describe("Arabic search folding", () => {
  it("folds letter variants and diacritics", () => {
    expect(foldSearchText("إدارةُ المشاريع")).toBe(foldSearchText("ادارة المشاريع"));
    expect(foldSearchText("مدرسة")).toBe("مدرسه");
    expect(foldSearchText("مـــشروع")).toBe("مشروع");
    expect(foldSearchText("مستشفى")).toBe("مستشفي");
  });
});

describe("buildTsQuery", () => {
  it("prefix-matches every word and handles the Arabic article", () => {
    expect(buildTsQuery("login page")).toBe("login:* & page:*");
    expect(buildTsQuery("المشروع")).toBe("(المشروع:* | مشروع:* | والمشروع:* | بالمشروع:* | كالمشروع:* | فالمشروع:* | للمشروع:*)");
    expect(buildTsQuery("إدارة")).toContain("اداره:*");
  });
  it("drops query syntax", () => {
    expect(buildTsQuery("a & b | !c:* ('")).toBe("a:* & b:* & c:*");
    expect(buildTsQuery("&&&")).toBeNull();
  });
});
