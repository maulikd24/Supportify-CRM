"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { completeSsoLoginAction } from "./actions";

export function CompleteSsoLogin({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    completeSsoLoginAction(token).then((result) => {
      if (!cancelled && result?.error) setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{error ? "Sign-in failed" : "Signing you in..."}</CardTitle>
          <CardDescription>
            {error ?? "Completing sign-in with your identity provider."}
          </CardDescription>
        </CardHeader>
        {error && (
          <CardContent>
            <Link href="/login/sso" className="text-sm underline underline-offset-4">
              Try again
            </Link>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
