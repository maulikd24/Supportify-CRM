"use client";

import { useActionState } from "react";
import Link from "next/link";

import { resetPasswordAction, type ResetPasswordState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: ResetPasswordState = {};

export function ResetPasswordForm({ token }: { token: string }) {
  const boundAction = resetPasswordAction.bind(null, token);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set a new password</CardTitle>
          <CardDescription>Choose a new password for your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.success ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">Your password has been updated.</p>
              <Button className="w-full" render={<Link href="/login" />}>
                Go to sign in
              </Button>
            </div>
          ) : (
            <form action={formAction}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="password">New password</FieldLabel>
                  <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
                </Field>
                {state.error && <FieldError>{state.error}</FieldError>}
                <Button type="submit" disabled={pending} className="w-full">
                  {pending ? "Saving..." : "Reset password"}
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
