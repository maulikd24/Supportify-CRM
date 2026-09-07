import Link from "next/link";

import { prisma } from "@/lib/db/prisma";
import { consumeVerificationToken } from "@/lib/auth/verification-tokens";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await consumeVerificationToken(token, "EMAIL_VERIFY");

  if (result) {
    await prisma.user.update({ where: { id: result.userId }, data: { emailVerifiedAt: new Date() } });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{result ? "Email verified" : "Link expired"}</CardTitle>
          <CardDescription>
            {result
              ? "Your email address has been verified."
              : "This verification link is invalid or has expired. Log in and request a new one from your account settings."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" render={<Link href="/login" />}>
            Go to sign in
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
