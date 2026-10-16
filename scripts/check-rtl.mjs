#!/usr/bin/env node
// Fails if web code uses physical (left/right) layout, which breaks Arabic.
// Use logical equivalents instead: ms/me, ps/pe, start/end, text-start/end,
// border-s/e, rounded-s/e, and CSS margin-inline-start etc.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIRS = ["apps/web/src"];

const CLASS_RULES = [
  /(?<![\w-])-?(?:ml|mr|pl|pr|left|right|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-[\w./[\]-]+/,
  /(?<![\w-])(?:text-left|text-right|float-left|float-right|clear-left|clear-right)(?![\w-])/,
  /(?<![\w-])(?:border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br)(?![a-z])/,
];
const CSS_RULES = [
  /\b(?:margin|padding|border)-(?:left|right)\b/,
  /(?:^|[\s;{])(?:left|right)\s*:/,
  /text-align\s*:\s*(?:left|right)/,
  /float\s*:\s*(?:left|right)/,
];

const ALLOW = "rtl-allow";
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(name)) check(p);
  }
}

function check(file) {
  const rules = file.endsWith(".css") ? CSS_RULES : CLASS_RULES;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (line.includes(ALLOW)) return;
      // For TS/TSX only look inside string literals, where class names live.
      const haystack = file.endsWith(".css") ? line : (line.match(/(["'`])(?:\\.|(?!\1).)*\1/g) ?? []).join(" ");
      for (const rule of rules) {
        const m = haystack.match(rule);
        if (m) problems.push(`${relative(ROOT, file)}:${i + 1}  "${m[0].trim()}"`);
      }
    });
}

for (const d of DIRS) walk(join(ROOT, d));

if (problems.length) {
  console.error("Physical left/right layout found. Use logical properties so Arabic (RTL) works:\n");
  for (const p of problems) console.error("  " + p);
  console.error(`\nIf a physical direction is truly intended, add the comment "${ALLOW}" on that line.`);
  process.exit(1);
}
console.log("RTL check passed: no physical left/right layout.");
