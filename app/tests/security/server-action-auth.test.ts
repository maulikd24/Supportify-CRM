import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { isRedirect, signedOut } from "../helpers";

/**
 * Every export of a "use server" file is a publicly callable POST endpoint —
 * reachable by anyone, logged in or not, regardless of which page imports it.
 * This calls every exported action while signed out and requires each to bounce
 * to /login before doing anything. An action that "only gets called from a
 * guarded action" (the old checkDuplicateClientAction) fails here.
 */

const SRC = path.resolve(__dirname, "../../src");

// Actions that are meant to work signed out. Anything else must require a session.
const PUBLIC_ACTIONS = new Set([
  "app/(dashboard)/actions#logoutAction", // only clears the caller's own (possibly absent) session
  "app/forgot-password/actions#forgotPasswordAction",
  "app/login/actions#loginAction",
  "app/login/sso/actions#startSsoLoginAction",
  "app/login/sso/complete/actions#completeSsoLoginAction",
  "app/reset-password/[token]/actions#resetPasswordAction",
  "app/signup/actions#signupAction",
  "lib/auth/google-signin-action#signInWithGoogleAction",
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "generated") return [];
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Exported action names, read from source — importing the public auth modules would pull in the real next-auth. */
const serverActions = walk(SRC).flatMap((file) => {
  const source = readFileSync(file, "utf8");
  if (!/^\s*["']use server["']/.test(source)) return [];
  const rel = path.relative(SRC, file).replace(/\.tsx?$/, "");
  const names = [...source.matchAll(/export\s+(?:async\s+function|const)\s+(\w+)/g)].map((m) => m[1]);
  return [{ rel, names }];
});
// Only files with at least one action that must be guarded get imported and called.
const guardedFiles = serverActions.filter(({ rel, names }) => names.some((n) => !PUBLIC_ACTIONS.has(`${rel}#${n}`)));

beforeEach(() => signedOut());

describe("every server action requires a signed-in user", () => {
  it("finds the app's server action files", () => {
    expect(guardedFiles.length).toBeGreaterThan(20);
  });

  it.each(guardedFiles.map(({ rel, names }) => [rel, names] as const))("%s", async (rel, names) => {
    const mod = (await import(path.join(SRC, rel))) as Record<string, unknown>;
    const unguarded: string[] = [];

    for (const name of names) {
      const action = mod[name];
      if (typeof action !== "function" || PUBLIC_ACTIONS.has(`${rel}#${name}`)) continue;
      // Plausible junk arguments: the guard must reject before any of them are looked at.
      const outcome = await (action as (...args: unknown[]) => Promise<unknown>)("x", new FormData(), "x").then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      if (outcome.ok || !isRedirect(outcome.error, "/login")) unguarded.push(name);
    }

    expect(unguarded, "exported server actions that ran without a signed-in user").toEqual([]);
  });

  it("has no stale public allowlist entries", () => {
    const all = new Set(serverActions.flatMap(({ rel, names }) => names.map((n) => `${rel}#${n}`)));
    expect([...PUBLIC_ACTIONS].filter((a) => !all.has(a))).toEqual([]);
  });
});
