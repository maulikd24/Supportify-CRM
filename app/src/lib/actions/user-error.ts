import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";

import type { ActionFailure } from "@/lib/actions/failure";

export { isActionFailure, type ActionFailure } from "@/lib/actions/failure";

/**
 * An error whose message is safe and meant for the person using the app
 * ("SOP not found", "Your plan has no free seats…").
 *
 * Production builds of Next.js replace the message of any error *thrown* from a
 * server action with a generic one, so user-facing problems must be *returned*.
 * Throw UserError inside an action wrapped with withUserErrors(); the client
 * calls it through callAction() and gets a normal Error with the real message.
 */
export class UserError extends Error {
  override name = "UserError";
}


/**
 * Wraps a server action so UserError and validation (zod) errors are returned as
 * an ActionFailure instead of thrown. Anything else — real bugs, and Next's own
 * redirect()/notFound() signals — is re-thrown unchanged.
 */
export function withUserErrors<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R | ActionFailure> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof UserError) return { __actionError: error.message };
      if (error instanceof ZodError) {
        return { __actionError: error.issues[0]?.message ?? "Please check the form and try again." };
      }
      throw error;
    }
  };
}
