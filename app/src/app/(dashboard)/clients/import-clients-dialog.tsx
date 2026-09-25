"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { importClientsAction, type ImportSummary } from "./import-actions";

export function ImportClientsDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a CSV file first");
      return;
    }
    setPending(true);
    setSummary(null);
    try {
      const text = await file.text();
      const result = await importClientsAction(text);
      setSummary(result);
      if (result.created > 0) toast.success(`Imported ${result.created} client(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSummary(null);
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Upload className="size-4" />
        Import CSV
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Clients from CSV</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Columns: <code>name, mobile</code> (required), plus <code>email, clientType, leadSource,
            referralSource, dealValue, notes</code> and any custom field key. Re-uses the same columns as{" "}
            <a href="/api/export/clients" className="underline">
              Export clients
            </a>
            , so you can export, edit, and re-import.
          </p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="text-sm" />
          {summary && (
            <div className="rounded-md border p-3">
              <p>
                Created <strong>{summary.created}</strong>, skipped <strong>{summary.skipped}</strong>.
              </p>
              {summary.errors.length > 0 && (
                <ul className="mt-2 max-h-32 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">
                  {summary.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="mt-4">
          <Button onClick={handleImport} disabled={pending}>
            {pending ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
