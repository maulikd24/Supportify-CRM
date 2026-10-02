import { isActionFailure, type ActionFailure } from "@/lib/actions/failure";

/**
 * Client-side counterpart of withUserErrors(): calls a server action and turns a
 * returned ActionFailure back into a thrown Error carrying the real message, so
 * existing `try { await callAction(fooAction)(…) } catch (e) { toast.error(e.message) }`
 * code shows the right text in production.
 */
export function callAction<A extends unknown[], R>(
  action: (...args: A) => Promise<R | ActionFailure>,
): (...args: A) => Promise<Exclude<R, ActionFailure>> {
  return async (...args: A) => {
    const result = await action(...args);
    if (isActionFailure(result)) throw new Error(result.__actionError);
    return result as Exclude<R, ActionFailure>;
  };
}
