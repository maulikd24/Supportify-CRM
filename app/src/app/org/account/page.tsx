import { requireUser } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Panel } from "@/components/dashboard/panel";
import { ChangePasswordForm } from "./change-password-form";
import { TwoFactorSettings } from "./two-factor-settings";

export default async function AccountSettingsPage({ searchParams }: { searchParams: Promise<{ setup2fa?: string }> }) {
  const session = await requireUser();
  const { setup2fa } = await searchParams;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { twoFactorEnabled: true, organization: { select: { require2fa: true, name: true } } },
  });
  const mustSetUp2fa = user.organization.require2fa && !user.twoFactorEnabled;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Signed in as {session.user.name} ({session.user.email})
      </p>

      {mustSetUp2fa && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-5 py-4 text-[13px]">
          <p className="font-semibold">{user.organization.name} requires two-factor authentication.</p>
          <p className="mt-0.5 text-muted-foreground">
            {setup2fa ? "Set it up below to continue using Supportify." : "Set it up below — you'll be asked to before using the app."}
          </p>
        </div>
      )}

      <Panel
        eyebrow="Sign-in"
        title="Two-factor authentication"
        description={
          user.twoFactorEnabled
            ? "On — an authenticator code is required when you sign in."
            : "Add an authenticator app code as a second sign-in step."
        }
        bodyClassName="px-5 pb-5"
      >
        <TwoFactorSettings enabled={user.twoFactorEnabled} required={user.organization.require2fa} />
      </Panel>

      <Panel eyebrow="Sign-in" title="Password" description="Update the password you use to sign in." bodyClassName="px-5 pb-5">
        <ChangePasswordForm />
      </Panel>
    </div>
  );
}
