"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { loginAction, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthLogo } from "@/components/auth-logo";
import { GoogleSignInButton, googleAuthEnabled } from "@/components/google-signin-button";

const initialState: LoginState = {};

function SsoErrorBanner() {
  const params = useSearchParams();
  const ssoError = params.get("ssoError");
  if (!ssoError) return null;
  return <FieldError>{ssoError}</FieldError>;
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const stage = state.stage ?? "credentials";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4">
      <AuthLogo />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{stage === "2fa" ? "Two-factor verification" : "Sign in"}</CardTitle>
          <CardDescription>
            {stage === "2fa"
              ? "Enter the 6-digit code from your authenticator app."
              : "Access your Supportify dashboard"}
          </CardDescription>
        </CardHeader>
        {stage !== "2fa" && (
          <div className="px-6">
            <Suspense fallback={null}>
              <SsoErrorBanner />
            </Suspense>
          </div>
        )}
        <CardContent>
          <form action={formAction}>
            <FieldGroup>
              {stage === "2fa" ? (
                <>
                  <input type="hidden" name="email" value={state.email ?? ""} />
                  <input type="hidden" name="password" value={state.password ?? ""} />
                  <Field>
                    <FieldLabel htmlFor="code">Authentication code</FieldLabel>
                    <Input
                      id="code"
                      name="code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      required
                    />
                    <FieldDescription>You can also enter one of your recovery codes.</FieldDescription>
                  </Field>
                  {state.error && <FieldError>{state.error}</FieldError>}
                  <Button type="submit" disabled={pending} className="w-full">
                    {pending ? "Verifying..." : "Verify"}
                  </Button>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input id="email" name="email" type="email" autoComplete="email" required />
                  </Field>
                  <Field>
                    <div className="flex items-center justify-between">
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <Link href="/forgot-password" className="text-xs text-muted-foreground underline underline-offset-4">
                        Forgot password?
                      </Link>
                    </div>
                    <Input id="password" name="password" type="password" autoComplete="current-password" required />
                  </Field>
                  {state.error && <FieldError>{state.error}</FieldError>}
                  <Button type="submit" disabled={pending} className="w-full">
                    {pending ? "Signing in..." : "Sign in"}
                  </Button>
                </>
              )}
            </FieldGroup>
          </form>
          {stage !== "2fa" && (
            <>
              {googleAuthEnabled && (
                <>
                  <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                    <div className="h-px flex-1 bg-border" />
                    or
                    <div className="h-px flex-1 bg-border" />
                  </div>
                  <GoogleSignInButton label="Continue with Google" />
                </>
              )}
              <p className="mt-4 text-center text-sm text-muted-foreground">
                <Link href="/login/sso" className="underline underline-offset-4">
                  Sign in with SSO
                </Link>
              </p>
            </>
          )}
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="underline underline-offset-4">
              Start a free trial
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
