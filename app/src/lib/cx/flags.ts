/**
 * CX Intelligence ships in phases; until it can import and analyse conversations it stays
 * hidden: no product switcher entry, no billing card, no trials, and /cx returns 404.
 * NEXT_PUBLIC_ so the sidebar (a client component) sees the same value as the server.
 */
export function cxEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CX_INTELLIGENCE_ENABLED === "true";
}
