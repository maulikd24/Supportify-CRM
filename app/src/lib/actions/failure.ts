/** Shape a withUserErrors()-wrapped server action returns for a user-facing problem. */
export type ActionFailure = { __actionError: string };

export function isActionFailure(value: unknown): value is ActionFailure {
  return typeof value === "object" && value !== null && "__actionError" in value;
}
