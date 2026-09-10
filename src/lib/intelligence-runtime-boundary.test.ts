/**
 * The fragmentation guard.
 *
 * The law, enforced: no business app may become its own isolated AI brain.
 * This test scans the suite for reasoning bypasses, direct provider imports,
 * direct provider or gateway URLs, and run-id plumbing outside transport
 * code, and fails when any file trips a rule without being either canonical
 * machinery or a documented, dated exception in
 * src/lib/intelligence-runtime-boundary.ts.
 *
 * An exception is a migration debt, not permission: each names the runtime
 * contract the file must adopt. The test also fails on stale exceptions
 * (file gone) so the registry stays honest.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

import {
  CANONICAL_REASONING_MODULES,
  FORBIDDEN_PROVIDER_IMPORTS,
  FORBIDDEN_PROVIDER_URLS,
  REASONING_EXCEPTIONS,
  RUN_ID_ALLOWED_PREFIXES,
  RUN_ID_PLUMBING,
} from "./intelligence-runtime-boundary";

const ROOT = process.cwd();
const SCAN_DIRS = ["src/routes", "src/components", "src/data", "src/lib", "src/domain"];

function walk(dir: string): string[] {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const path = join(dir, entry);
    const stat = statSync(join(ROOT, path));
    if (stat.isDirectory()) {
      out.push(...walk(path));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap(walk);
const EXCEPTION_FILES = new Set(REASONING_EXCEPTIONS.map((entry) => entry.file));
const CANONICAL = new Set(CANONICAL_REASONING_MODULES);

/** Files allowed to trip a rule: canonical machinery, the registry itself, or documented debt. */
function isAllowed(file: string): boolean {
  return (
    CANONICAL.has(file) ||
    EXCEPTION_FILES.has(file) ||
    file === "src/lib/intelligence-runtime-boundary.ts"
  );
}

describe("intelligence runtime boundary", () => {
  it("scans a meaningful portion of the suite", () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("no undocumented file imports provider transport or selection modules", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      if (isAllowed(file)) continue;
      const content = readFileSync(join(ROOT, file), "utf8");
      for (const specifier of FORBIDDEN_PROVIDER_IMPORTS) {
        if (content.includes(specifier)) {
          violations.push(`${file} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no undocumented file calls a provider or gateway URL directly", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      if (isAllowed(file)) continue;
      const content = readFileSync(join(ROOT, file), "utf8");
      for (const url of FORBIDDEN_PROVIDER_URLS) {
        if (content.includes(url)) {
          violations.push(`${file} references ${url}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("run-id plumbing stays in transport code and API route handlers", () => {
    const violations: string[] = [];
    for (const file of FILES) {
      if (isAllowed(file)) continue;
      const content = readFileSync(join(ROOT, file), "utf8");
      if (!content.includes(RUN_ID_PLUMBING)) continue;
      if (!RUN_ID_ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix))) {
        violations.push(`${file} imports ${RUN_ID_PLUMBING}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("every documented exception still exists and names its migration", () => {
    for (const exception of REASONING_EXCEPTIONS) {
      expect(
        existsSync(join(ROOT, exception.file)),
        `${exception.file} is gone, remove its entry`,
      ).toBe(true);
      expect(exception.migration.length).toBeGreaterThan(0);
      expect(exception.bypass.length).toBeGreaterThan(0);
    }
  });

  it("every canonical module exists", () => {
    for (const module of CANONICAL_REASONING_MODULES) {
      expect(existsSync(join(ROOT, module)), `${module} is missing`).toBe(true);
    }
  });
});
