import type { Session } from "next-auth";

import type { OrgRole, Role } from "@/generated/prisma/client";

/** Thrown by the stubbed next/navigation redirect() — an auth guard bouncing the caller. */
export class RedirectError extends Error {
  constructor(public readonly url: string) {
    super(`redirect(${url})`);
  }
}

export type TestUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  organizationId: string;
  orgRole: OrgRole;
  isPlatformAdmin?: boolean;
};

let session: Session | null = null;

/** Every subsequent auth() call (and so every guard) sees this user, until changed. */
export function actAs(user: TestUser | null) {
  session = user
    ? {
        user: { ...user, isPlatformAdmin: user.isPlatformAdmin ?? false },
        expires: new Date(Date.now() + 3_600_000).toISOString(),
      }
    : null;
}

export function currentSession(): Session | null {
  return session;
}
