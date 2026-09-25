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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Account</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as {session.user.name} ({session.user.email})
        </p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Change Password</CardTitle>
          <CardDescription>Update the password used to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Two-Factor Authentication</CardTitle>
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
