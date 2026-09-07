"use client";

import { useActionState } from "react";
import Link from "next/link";

import { startSsoLoginAction, type SsoLoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: SsoLoginState = {};

export default function SsoLoginPage() {
  const [state, formAction, pending] = useActionState(startSsoLoginAction, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in with SSO</CardTitle>
          <CardDescription>Enter your work email to continue to your identity provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Work email</FieldLabel>
                <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
              </Field>
              {state.error && <FieldError>{state.error}</FieldError>}
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Redirecting..." : "Continue"}
              </Button>
            </FieldGroup>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/login" className="underline underline-offset-4">
              Sign in with a password instead
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
