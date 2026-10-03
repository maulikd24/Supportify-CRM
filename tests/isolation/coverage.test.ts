import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CASES, EXEMPT } from "./cases";

const SRC = path.resolve(__dirname, "../../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (entry === "generated" || entry === "node_modules") return [];
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

/** Every export of a "use server" file is a publicly callable endpoint. */
function exportedServerActions(): string[] {
  return walk(SRC).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    if (!/^\s*["']use server["']/.test(source)) return [];
    const rel = path.relative(SRC, file).replace(/\.(ts|tsx)$/, "").split(path.sep).join("/");
    return [...source.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => `${rel}#${m[1]}`);
  });
}

describe("server action isolation coverage", () => {
  const actions = exportedServerActions();
  const covered = new Set(CASES.map((c) => c.action));

  it("finds the app's server actions", () => {
    expect(actions.length).toBeGreaterThan(50);
  });

  it("every exported server action has an isolation case or a documented exemption", () => {
    const missing = actions.filter((a) => !covered.has(a) && !(a in EXEMPT));
    expect(missing, "add a case to tests/isolation/cases.ts (or an EXEMPT entry with a reason)").toEqual([]);
  });

  it("has no stale cases or exemptions for actions that no longer exist", () => {
    const known = new Set(actions);
    const stale = [...covered, ...Object.keys(EXEMPT)].filter((a) => !known.has(a));
    expect(stale).toEqual([]);
  });
});
