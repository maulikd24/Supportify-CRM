"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import {
  startTwoFactorSetupAction,
  confirmTwoFactorSetupAction,
  disableTwoFactorAction,
  regenerateRecoveryCodesAction,
} from "./actions";

type Step = "idle" | "setup" | "recovery-codes" | "disable" | "regenerate";

export function TwoFactorSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  async function handleStart() {
    setPending(true);
    try {
      const result = await startTwoFactorSetupAction();
      setSecret(result.secret);
      setQrDataUrl(result.qrDataUrl);
      setStep("setup");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start setup");
    } finally {
      setPending(false);
    }
  }

  async function handleConfirm(formData: FormData) {
    setPending(true);
    try {
      const result = await confirmTwoFactorSetupAction(formData);
      setRecoveryCodes(result.recoveryCodes);
      setStep("recovery-codes");
      toast.success("Two-factor authentication enabled");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Invalid code");
    } finally {
      setPending(false);
    }
  }

  async function handleDisable(formData: FormData) {
    setPending(true);
    try {
      await disableTwoFactorAction(formData);
      toast.success("Two-factor authentication disabled");
      setStep("idle");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disable 2FA");
    } finally {
      setPending(false);
    }
  }

  async function handleRegenerate(formData: FormData) {
    setPending(true);
    try {
      const result = await regenerateRecoveryCodesAction(formData);
      setRecoveryCodes(result.recoveryCodes);
      setStep("recovery-codes");
      toast.success("Recovery codes regenerated — your old codes no longer work");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to regenerate codes");
    } finally {
      setPending(false);
    }
  }

  if (step === "recovery-codes") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Save these recovery codes somewhere safe. Each one can be used once to sign in if you lose access to your
          authenticator app. They won&apos;t be shown again.
        </p>
        <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm">
          {recoveryCodes.map((code) => (
            <div key={code}>{code}</div>
          ))}
        </div>
        <Button className="w-fit" onClick={() => setStep("idle")}>
          Done
        </Button>
      </div>
    );
  }

  if (step === "setup") {
    return (
      <form action={handleConfirm} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Scan this QR code with your authenticator app (Google Authenticator, 1Password, Authy, etc.), then enter the
          6-digit code it shows.
        </p>
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrDataUrl} alt="Two-factor setup QR code" className="size-40 rounded-md border" />
        )}
        <FieldGroup>
          <Field>
            <FieldLabel>Manual entry key</FieldLabel>
            <Input readOnly value={secret} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-code">Code from your app</FieldLabel>
            <Input id="confirm-code" name="code" inputMode="numeric" required maxLength={6} autoFocus />
          </Field>
        </FieldGroup>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Verifying..." : "Enable 2FA"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setStep("idle")} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (step === "disable") {
    return (
      <form action={handleDisable} className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="disable-password">Current password</FieldLabel>
            <Input id="disable-password" name="currentPassword" type="password" required autoFocus />
            <FieldDescription>Confirm your password to turn off two-factor authentication.</FieldDescription>
          </Field>
        </FieldGroup>
        <div className="flex gap-2">
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending ? "Disabling..." : "Disable 2FA"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setStep("idle")} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (step === "regenerate") {
    return (
      <form action={handleRegenerate} className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="regen-password">Current password</FieldLabel>
            <Input id="regen-password" name="currentPassword" type="password" required autoFocus />
            <FieldDescription>Your existing recovery codes will stop working.</FieldDescription>
          </Field>
        </FieldGroup>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Generating..." : "Regenerate codes"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setStep("idle")} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {enabled ? (
        <>
          <Button variant="outline" onClick={() => setStep("regenerate")}>
            Regenerate recovery codes
          </Button>
          <Button variant="destructive" onClick={() => setStep("disable")}>
            Disable 2FA
          </Button>
        </>
      ) : (
        <Button onClick={handleStart} disabled={pending}>
          {pending ? "Starting..." : "Enable 2FA"}
        </Button>
      )}
    </div>
  );
}
