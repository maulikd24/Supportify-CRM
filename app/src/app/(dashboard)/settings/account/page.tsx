import { requireUser } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "./change-password-form";
import { TwoFactorSettings } from "./two-factor-settings";

export default async function AccountSettingsPage() {
  const session = await requireUser();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { twoFactorEnabled: true },
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Settings</p>
        <p className="mt-1 max-w-prose text-xs text-muted-foreground">
          Signed in as {session.user.name} ({session.user.email})
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>Update the password used to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Two-Factor Authentication</CardTitle>
          <CardDescription>
            {user.twoFactorEnabled
              ? "Enabled — an authenticator code is required at sign-in."
              : "Add an authenticator app code as a second sign-in step."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorSettings enabled={user.twoFactorEnabled} />
        </CardContent>
      </Card>
    </div>
  );
}
