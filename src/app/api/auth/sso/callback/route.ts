import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db/prisma";
import { getWorkos, workosClientId } from "@/lib/sso/workos";
import { issueVerificationToken } from "@/lib/auth/verification-tokens";

/**
 * WorkOS redirects here after the user authenticates with their IdP. This is
 * a plain Route Handler (not a Server Action), so it can't set NextAuth's
 * session cookie itself — instead it verifies the identity server-to-server
 * with WorkOS, JIT-provisions the User if needed, mints a short-lived
 * single-use SSO_LOGIN token, and hands off to /login/sso/complete, which
 * exchanges that token for a real session via the "sso" Credentials provider.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");

  const loginUrl = new URL("/login", url.origin);

  if (errorParam || !code) {
    loginUrl.searchParams.set("ssoError", "Sign-in with your identity provider was cancelled or failed.");
    return NextResponse.redirect(loginUrl);
  }

  let profile: { email: string; organizationId?: string; firstName?: string; lastName?: string };
  try {
    const result = await getWorkos().sso.getProfileAndToken({ code, clientId: workosClientId() });
    profile = result.profile;
  } catch {
    loginUrl.searchParams.set("ssoError", "We couldn't verify your identity provider's response. Please try again.");
    return NextResponse.redirect(loginUrl);
  }

  if (!profile.organizationId) {
    loginUrl.searchParams.set("ssoError", "This identity provider connection is not linked to an organization.");
    return NextResponse.redirect(loginUrl);
  }

  const organization = await prisma.organization.findUnique({
    where: { workosOrganizationId: profile.organizationId },
  });
  if (!organization) {
    loginUrl.searchParams.set("ssoError", "No Supportify organization is linked to this identity provider.");
    return NextResponse.redirect(loginUrl);
  }

  let user = await prisma.user.findUnique({ where: { email: profile.email } });
  if (!user) {
    // JIT provisioning: first SSO login for this person creates their account.
    // They never set a password — the random hash below is unusable and only
    // exists because passwordHash is required on the shared User row.
    const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    user = await prisma.user.create({
      data: {
        organizationId: organization.id,
        orgRole: "MEMBER",
        name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.email,
        email: profile.email,
        passwordHash: unusablePasswordHash,
        emailVerifiedAt: new Date(),
      },
    });
  } else if (user.organizationId !== organization.id) {
    // An existing account with this email belongs to a different org — never
    // silently move it or sign in as it, that's a cross-tenant identity mixup.
    loginUrl.searchParams.set("ssoError", "This email is already registered under a different organization.");
    return NextResponse.redirect(loginUrl);
  } else if (!user.isActive) {
    loginUrl.searchParams.set("ssoError", "Your account has been deactivated. Contact your admin.");
    return NextResponse.redirect(loginUrl);
  }

  const token = await issueVerificationToken(user.id, "SSO_LOGIN");

  const completeUrl = new URL("/login/sso/complete", url.origin);
  completeUrl.searchParams.set("token", token);
  return NextResponse.redirect(completeUrl);
}
