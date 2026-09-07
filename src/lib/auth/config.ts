import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db/prisma";
import type { OrgRole, Role } from "@/generated/prisma/client";
import { decryptJson } from "@/lib/security/crypto";
import { verifyTotpToken, consumeRecoveryCode } from "@/lib/security/two-factor";
import { consumeVerificationToken } from "@/lib/auth/verification-tokens";

declare module "next-auth" {
  interface User {
    role: Role;
    organizationId: string;
    orgRole: OrgRole;
    isPlatformAdmin: boolean;
  }
  interface Session {
    user: {
      id: string;
      role: Role;
      name: string;
      email: string;
      organizationId: string;
      orgRole: OrgRole;
      isPlatformAdmin: boolean;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
    organizationId: string;
    orgRole: OrgRole;
    isPlatformAdmin: boolean;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        code: { label: "Two-factor code", type: "text" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        const code = credentials?.code;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        if (user.twoFactorEnabled) {
          if (typeof code !== "string" || !code) return null;

          const secret = user.twoFactorSecret ? decryptJson<string>(user.twoFactorSecret) : null;
          const validTotp = secret ? verifyTotpToken(secret, code) : false;

          if (!validTotp) {
            const hashes = Array.isArray(user.twoFactorRecoveryCodes)
              ? (user.twoFactorRecoveryCodes as string[])
              : [];
            const remaining = await consumeRecoveryCode(hashes, code);
            if (!remaining) return null;
            // Recovery codes are single-use — burn it immediately so it can't be replayed.
            await prisma.user.update({ where: { id: user.id }, data: { twoFactorRecoveryCodes: remaining } });
          }
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
          orgRole: user.orgRole,
          isPlatformAdmin: user.isPlatformAdmin,
        };
      },
    }),
    Credentials({
      id: "sso",
      name: "SSO",
      credentials: { token: { label: "Token", type: "text" } },
      authorize: async (credentials) => {
        // The token is minted by the WorkOS callback route (src/app/api/auth/sso/callback/route.ts)
        // immediately after it verifies the identity server-to-server with WorkOS — it is the only
        // thing this provider trusts, never a bare userId, so this endpoint can't be used to sign in
        // as an arbitrary account.
        const token = credentials?.token;
        if (typeof token !== "string" || !token) return null;

        const consumed = await consumeVerificationToken(token, "SSO_LOGIN");
        if (!consumed) return null;

        const user = await prisma.user.findUnique({ where: { id: consumed.userId } });
        if (!user || !user.isActive) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
          orgRole: user.orgRole,
          isPlatformAdmin: user.isPlatformAdmin,
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user?.id) {
        // Initial sign-in: NextAuth provides `user` from authorize().
        token.id = user.id;
        token.role = user.role;
        token.organizationId = user.organizationId;
        token.orgRole = user.orgRole;
        token.isPlatformAdmin = user.isPlatformAdmin;
        return token;
      }

      if (!token.id) return null;

      // Every subsequent request: re-fetch current role/active status so admin
      // changes (role edits, deactivation, org membership) take effect on the
      // user's very next request instead of only after they next log in.
      const current = await prisma.user.findUnique({
        where: { id: token.id },
        select: { role: true, isActive: true, organizationId: true, orgRole: true, isPlatformAdmin: true },
      });
      if (!current || !current.isActive) return null;

      token.role = current.role;
      token.organizationId = current.organizationId;
      token.orgRole = current.orgRole;
      token.isPlatformAdmin = current.isPlatformAdmin;
      return token;
    },
    session: async ({ session, token }) => {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.organizationId = token.organizationId;
      session.user.orgRole = token.orgRole;
      session.user.isPlatformAdmin = token.isPlatformAdmin;
      return session;
    },
  },
});
