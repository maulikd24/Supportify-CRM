import { requireRole } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiKeysPanel } from "./api-keys-panel";
import { WebhooksPanel } from "./webhooks-panel";

export default async function DevelopersSettingsPage() {
  const session = await requireRole(["ADMIN"]);
  const organizationId = session.user.organizationId;

  const [apiKeys, webhooks] = await Promise.all([
    prisma.apiKey.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
    prisma.webhookEndpoint.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Developers</h1>
        <p className="text-sm text-muted-foreground">
          API keys and webhooks for integrating Supportify with your own systems.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">API Keys</CardTitle>
          <CardDescription>
            Authenticate requests to the REST API with{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">Authorization: Bearer &lt;key&gt;</code>. See{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">GET /api/v1/clients</code> and{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">GET /api/v1/reviews</code>. Access to each
            endpoint follows your CRM / QA Sentinel subscriptions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeysPanel keys={apiKeys} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhooks</CardTitle>
          <CardDescription>
            Get notified when things happen in Supportify. Each delivery is signed with HMAC-SHA256 in the{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">X-Supportify-Signature</code> header.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WebhooksPanel webhooks={webhooks} />
        </CardContent>
      </Card>
    </div>
  );
}
