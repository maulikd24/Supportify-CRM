import { requireRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SsoDomainForm } from "./sso-domain-form";
import { OpenAdminPortalButton } from "./open-admin-portal-button";

export default async function SsoSettingsPage() {
  const session = await requireRole(["ADMIN"]);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: session.user.organizationId } });

  const connected = Boolean(organization.workosOrganizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Single Sign-On</h1>
        <p className="text-sm text-muted-foreground">
          Let your team sign in with your company&apos;s identity provider (Okta, Azure AD, Google Workspace, and
          others) instead of a password.
        </p>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            SSO Domain
            <Badge variant={connected ? "default" : "outline"}>{connected ? "Configured" : "Not set up"}</Badge>
          </CardTitle>
          <CardDescription>
            The email domain (e.g. <code className="rounded bg-muted px-1 py-0.5 text-xs">acme.com</code>) your team
            signs in with. Anyone entering an email on this domain at{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/login/sso</code> is routed to your identity
            provider.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SsoDomainForm currentDomain={organization.ssoDomain} />
        </CardContent>
      </Card>

      {connected && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="text-base">Identity Provider Connection</CardTitle>
            <CardDescription>
              Configure the actual SAML or OIDC connection to your identity provider in WorkOS&apos;s hosted setup
              flow — upload your IdP&apos;s metadata there, not here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OpenAdminPortalButton />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
