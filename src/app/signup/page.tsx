"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signupAction, type SignupState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldError, FieldDescription } from "@/components/ui/field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: SignupState = {};

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signupAction, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your Supportify account</CardTitle>
          <CardDescription>Start a 14-day free trial — no card required</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="orgName">Company name</FieldLabel>
                <Input id="orgName" name="orgName" type="text" autoComplete="organization" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="name">Your name</FieldLabel>
                <Input id="name" name="name" type="text" autoComplete="name" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="email">Work email</FieldLabel>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </Field>
              <Field>
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
        </CardContent>
      </Card>
    </div>
  );
}
