import { prisma } from "@/lib/db/prisma";
import { requireRole } from "@/lib/auth/require-role";
import { INTEGRATION_PROVIDERS, EMAIL_PROVIDERS } from "@/lib/integrations/registry";
import { MESSAGING_CHANNELS, messagingProviderKeyFor } from "@/lib/messaging/registry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PROVIDER_META } from "./provider-meta";
import { IntegrationCard } from "./integration-card";

export default async function IntegrationsSettingsPage() {
  const session = await requireRole(["ADMIN"]);

  const messagingProviders = MESSAGING_CHANNELS.map((c) => messagingProviderKeyFor(c));
  const allProviders = [...INTEGRATION_PROVIDERS, ...messagingProviders, ...EMAIL_PROVIDERS];

  // Webhook-receiving providers need a stable webhookToken to show on this page
  // even before an admin has configured credentials — ensure a (mock-mode,
  // disabled) row exists for each so the tokenized URL is always ready to copy.
  const webhookProviders = [...INTEGRATION_PROVIDERS, ...messagingProviders];
  await Promise.all(
    webhookProviders.map((provider) =>
      prisma.integrationConfig.upsert({
        where: { organizationId_provider: { organizationId: session.user.organizationId, provider } },
        update: {},
        create: { organizationId: session.user.organizationId, provider },
      }),
    ),
  );

  const configs = await prisma.integrationConfig.findMany({
    where: { organizationId: session.user.organizationId, provider: { in: allProviders } },
  });
  const configByProvider = new Map(configs.map((c) => [c.provider, c]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Each integration runs in Mock mode until you add real credentials — journeys and manual actions
          work fully against mock data in the meantime.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Business Tools</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {INTEGRATION_PROVIDERS.map((provider) => (
            <IntegrationCard
              key={provider}
              provider={provider}
              meta={PROVIDER_META[provider]}
              config={configByProvider.get(provider) ?? null}
            />
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Messaging Channels</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {messagingProviders.map((provider) => (
            <IntegrationCard
              key={provider}
              provider={provider}
              meta={PROVIDER_META[provider]}
              config={configByProvider.get(provider) ?? null}
            />
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">Notifications</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {EMAIL_PROVIDERS.map((provider) => (
            <IntegrationCard
              key={provider}
              provider={provider}
              meta={PROVIDER_META[provider]}
              config={configByProvider.get(provider) ?? null}
            />
          ))}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook URLs</CardTitle>
          <CardDescription>
            Point each provider&apos;s outbound webhooks/automations at these URLs to feed events back into
            Supportify. Each URL is unique to your organization — don&apos;t share it with other tenants of the
            same provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm font-mono text-muted-foreground break-all">
          {INTEGRATION_PROVIDERS.map((provider) => (
            <span key={provider}>
              /api/webhooks/{provider}/{configByProvider.get(provider)?.webhookToken}
            </span>
          ))}
          {MESSAGING_CHANNELS.map((channel) => (
            <span key={channel}>
              /api/webhooks/messaging/{channel}/{configByProvider.get(messagingProviderKeyFor(channel))?.webhookToken}
            </span>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
