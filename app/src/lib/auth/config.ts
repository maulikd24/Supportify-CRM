import { randomBytes } from "crypto";

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db/prisma";
import type { OrgRole, Role } from "@/generated/prisma/client";
import { decryptJson } from "@/lib/security/crypto";
import { verifyTotpToken, consumeRecoveryCode } from "@/lib/security/two-factor";
import { consumeVerificationToken } from "@/lib/auth/verification-tokens";
import { passesFirstFactor } from "@/lib/auth/login-challenge";
import { provisionOrganization } from "@/lib/auth/provision-organization";
import { isLockedOut, registerLoginFailure, resetLoginFailures } from "@/lib/auth/login-lockout";
import { hashIdentifier, ipFromHeaders, rateLimit } from "@/lib/security/rate-limit";
import { sessionAllowed, ssoRequiredFor, type AuthMethod } from "@/lib/security/policy";
import { recordAudit } from "@/lib/audit/record";

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
      authMethod: AuthMethod;
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
    authTime?: number;
    authMethod?: AuthMethod;
  }
}

// Only offer Google sign-in when both OAuth credentials are configured —
// registering the provider without them sends Google an undefined client ID
// and surfaces NextAuth's generic "Server error" page.
const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Stands in for the password at the 2FA step — see src/lib/auth/login-challenge.ts.
        challenge: { label: "Login challenge", type: "text" },
        code: { label: "Two-factor code", type: "text" },
      },
      authorize: async (credentials, request) => {
        const email = credentials?.email;
        const password = credentials?.password;
        const challenge = credentials?.challenge;
        const code = credentials?.code;
        if (typeof email !== "string") return null;

        // The NextAuth callback endpoint can be called directly, bypassing loginAction's throttle.
        const [byIp, byEmail] = await Promise.all([
          rateLimit("loginByIp", `authorize:${ipFromHeaders(request.headers)}`),
          rateLimit("loginByEmail", `authorize:${hashIdentifier(email)}`),
        ]);
        if (!byIp.allowed || !byEmail.allowed) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) return null;

        if (isLockedOut(user)) {
          // Generic failure — don't reveal lockout state to an attacker
          // probing whether an account exists/is locked.
          return null;
        }

        // The password — or, at the 2FA step, a challenge from the password step. The code check below still applies.
        const valid = await passesFirstFactor(user, { password, challenge });
        if (!valid) {
          await registerLoginFailure(user);
          return null;
        }

        const org = await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { requireSso: true } });
        if (org && ssoRequiredFor(org, user.orgRole)) return null;

        if (user.twoFactorEnabled) {
          if (typeof code !== "string" || !code) return null;

          const secret = user.twoFactorSecret ? decryptJson<string>(user.twoFactorSecret) : null;
          const validTotp = secret ? verifyTotpToken(secret, code) : false;

          if (!validTotp) {
            const hashes = Array.isArray(user.twoFactorRecoveryCodes)
              ? (user.twoFactorRecoveryCodes as string[])
              : [];
            const remaining = await consumeRecoveryCode(hashes, code);
            if (!remaining) {
              await registerLoginFailure(user);
              return null;
            }
            // Recovery codes are single-use — burn it immediately so it can't be replayed.
            await prisma.user.update({ where: { id: user.id }, data: { twoFactorRecoveryCodes: remaining } });
          }
        }

        await resetLoginFailures(user);

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
    ...(googleEnabled
      ? [
          Google({
            // NextAuth v5 auto-detects env vars as AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET
            // by default — pass these explicitly so the GOOGLE_CLIENT_ID/SECRET
            // names already configured in Vercel are the ones actually used.
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // The augmented `User` type (role/organizationId/orgRole/isPlatformAdmin)
            // requires every provider to return those fields. Google's own profile
            // has no concept of them, so this just satisfies the type with
            // placeholders — the `signIn` callback below resolves the real values
            // (creating a new org on first login) and overwrites them before the
            // `jwt` callback ever reads this object.
            profile(profile) {
              return {
                id: profile.sub,
                name: profile.name,
                email: profile.email,
                image: profile.picture,
                role: "RM" as Role,
                organizationId: "",
                orgRole: "MEMBER" as OrgRole,
                isPlatformAdmin: false,
              };
            },
          }),
        ]
      : []),
  ],
  events: {
    // Every successful sign-in (password, SSO, Google) lands in the org's audit trail.
    signIn: async ({ user, account }) => {
      if (!user?.id || !user.organizationId) return;
      await recordAudit({
        organizationId: user.organizationId,
        userId: user.id,
        entity: "User",
        entityId: user.id,
        action: account?.provider === "sso" ? "auth.sso_login" : "auth.login_succeeded",
        newValue: { method: account?.provider ?? "credentials" },
      });
    },
  },
  callbacks: {
    signIn: async ({ user, account, profile }) => {
      if (account?.provider !== "google") return true;

      const email = profile?.email;
      if (!email || !profile?.email_verified) return false;

      const existing = await prisma.user.findUnique({ where: { email }, include: { organization: { select: { requireSso: true } } } });
      if (existing && !existing.isActive) return false;
      if (existing && ssoRequiredFor(existing.organization, existing.orgRole)) return "/login?error=SsoRequired";

      let dbUser: { id: string; role: Role; organizationId: string; orgRole: OrgRole; isPlatformAdmin: boolean } | null = existing;

      if (!dbUser) {
        // First-time Google sign-in: create a new org exactly like self-serve
        // email signup does, trialing both products (Google's OAuth profile
        // has no product-picker step to drive this choice from).
        const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
        const orgName = profile.name ? `${profile.name}'s Organization` : "My Organization";
        dbUser = await provisionOrganization({
          orgName,
          ownerName: profile.name ?? email,
          ownerEmail: email,
          passwordHash: unusablePasswordHash,
          products: ["QA_SENTINEL", "CRM"],
          emailVerifiedAt: new Date(),
        });
      }

      user.id = dbUser.id;
      user.role = dbUser.role;
      user.organizationId = dbUser.organizationId;
      user.orgRole = dbUser.orgRole;
      user.isPlatformAdmin = dbUser.isPlatformAdmin;
      return true;
    },
    jwt: async ({ token, user, account }) => {
      if (user?.id) {
        // Initial sign-in: NextAuth provides `user` from authorize().
        token.id = user.id;
        token.role = user.role;
        token.organizationId = user.organizationId;
        token.orgRole = user.orgRole;
        token.isPlatformAdmin = user.isPlatformAdmin;
        token.authTime = Date.now();
        token.authMethod =
          account?.provider === "sso" ? "sso" : account?.provider === "google" ? "google" : "password";
        return token;
      }

      if (!token.id) return null;
      // Sessions issued before policies existed: start their clock now.
      token.authTime ??= Date.now();
      token.authMethod ??= "unknown";

      // Every subsequent request: re-fetch current role/active status so admin
      // changes (role edits, deactivation, org membership) take effect on the
      // user's very next request instead of only after they next log in.
      const current = await prisma.user.findUnique({
        where: { id: token.id },
        select: {
          role: true,
          isActive: true,
          organizationId: true,
          orgRole: true,
          isPlatformAdmin: true,
          sessionsRevokedAt: true,
          organization: { select: { sessionMaxHours: true, sessionsRevokedAt: true, requireSso: true } },
        },
      });
      if (!current || !current.isActive) return null;

      // Org security policies: session limit, "sign out everywhere", require SSO.
      if (
        !sessionAllowed({
          authTime: token.authTime,
          authMethod: token.authMethod,
          orgRole: current.orgRole,
          userSessionsRevokedAt: current.sessionsRevokedAt,
          org: current.organization,
        })
      ) {
        return null;
      }

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
      session.user.authMethod = token.authMethod ?? "unknown";
      return session;
    },
  },
});
