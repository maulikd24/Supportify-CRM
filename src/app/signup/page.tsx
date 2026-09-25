"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signupAction, type SignupState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthLogo } from "@/components/auth-logo";
import { GoogleSignInButton, googleAuthEnabled } from "@/components/google-signin-button";

const initialState: SignupState = {};

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <AuthLogo />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your Supportify account</CardTitle>
          <CardDescription>Start a 14-day free trial — no card required</CardDescription>
        </CardHeader>
        <CardContent>
          {googleAuthEnabled && (
            <>
              <GoogleSignInButton label="Sign up with Google" />
              <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" />
                or sign up with email
                <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}
          <form action={formAction}>
            <FieldGroup>
              <Field data-invalid={Boolean(state.fieldErrors?.orgName)}>
                <FieldLabel htmlFor="orgName">Company name</FieldLabel>
                <Input id="orgName" name="orgName" type="text" autoComplete="organization" required />
                {state.fieldErrors?.orgName && <FieldError>{state.fieldErrors.orgName}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(state.fieldErrors?.name)}>
                <FieldLabel htmlFor="name">Your name</FieldLabel>
                <Input id="name" name="name" type="text" autoComplete="name" required />
                {state.fieldErrors?.name && <FieldError>{state.fieldErrors.name}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(state.fieldErrors?.email)}>
                <FieldLabel htmlFor="email">Work email</FieldLabel>
                <Input id="email" name="email" type="email" autoComplete="email" required />
                {state.fieldErrors?.email && <FieldError>{state.fieldErrors.email}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(state.fieldErrors?.password)}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                {state.fieldErrors?.password && <FieldError>{state.fieldErrors.password}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(state.fieldErrors?.products)}>
                <FieldLabel>What do you want to trial?</FieldLabel>
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="products" value="QA_SENTINEL" defaultChecked />
                    QA Sentinel — AI ticket review
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="products" value="CRM" defaultChecked />
                    CRM — client pipeline & journeys
                  </label>
                </div>
                <FieldDescription>You can add the other one later from Billing.</FieldDescription>
                {state.fieldErrors?.products && <FieldError>{state.fieldErrors.products}</FieldError>}
              </Field>
              {state.error && <FieldError>{state.error}</FieldError>}
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Creating account..." : "Start free trial"}
              </Button>
            </FieldGroup>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="underline underline-offset-4">
              Sign in
            </Link>
          </p>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            By signing up, you agree to our{" "}
            <Link href="/terms" className="underline underline-offset-4">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline underline-offset-4">
              Privacy Policy
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
