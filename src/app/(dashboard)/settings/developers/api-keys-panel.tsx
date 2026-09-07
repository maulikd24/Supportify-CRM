"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/utils/format";
import { createApiKeyAction, revokeApiKeyAction } from "./actions";
import type { ApiKey } from "@/generated/prisma/client";

export function ApiKeysPanel({ keys }: { keys: ApiKey[] }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleCreate(formData: FormData) {
    setPending(true);
    try {
      const result = await createApiKeyAction(formData);
      setNewKey(result.rawKey);
      formRef.current?.reset();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create key");
    } finally {
      setPending(false);
    }
  }

  async function handleRevoke(keyId: string) {
    try {
      await revokeApiKeyAction(keyId);
      toast.success("Key revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke key");
    }
  }

  function closeDialog(next: boolean) {
    setOpen(next);
    if (!next) setNewKey(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <Dialog open={open} onOpenChange={closeDialog}>
        <DialogTrigger render={<Button size="sm" className="w-fit" />}>New API Key</DialogTrigger>
        <DialogContent>
          {newKey ? (
            <>
              <DialogHeader>
                <DialogTitle>Save your API key</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                This is the only time it will be shown. Store it somewhere safe.
              </p>
              <Input readOnly value={newKey} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <DialogFooter className="mt-2">
                <Button onClick={() => closeDialog(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>New API Key</DialogTitle>
              </DialogHeader>
              <form ref={formRef} action={handleCreate}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="key-name">Name</FieldLabel>
                    <Input id="key-name" name="name" required placeholder="Zapier integration" />
                  </Field>
                </FieldGroup>
                <DialogFooter className="mt-4">
                  <Button type="submit" disabled={pending}>
                    {pending ? "Creating..." : "Create Key"}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => (
            <TableRow key={key.id}>
              <TableCell>{key.name}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{key.keyPrefix}...</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "Never"}
              </TableCell>
              <TableCell>
                <Badge variant={key.revokedAt ? "outline" : "default"}>{key.revokedAt ? "Revoked" : "Active"}</Badge>
              </TableCell>
              <TableCell>
                {!key.revokedAt && (
                  <Button size="sm" variant="outline" onClick={() => handleRevoke(key.id)}>
                    Revoke
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {keys.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                No API keys yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
