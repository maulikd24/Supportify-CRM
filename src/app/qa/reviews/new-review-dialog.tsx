"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { createReviewAction, createBulkReviewAction, type BulkReviewSummary } from "./actions";

export function NewReviewDialog({ sops, disabled }: { sops: { id: string; name: string }[]; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [pending, setPending] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<BulkReviewSummary | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  async function handleSubmit(formData: FormData) {
    const sopId = String(formData.get("sopId"));
    setPending(true);
    setBulkSummary(null);

    if (mode === "bulk") {
      try {
        const summary = await createBulkReviewAction(String(formData.get("ticketIds") || ""), sopId);
        setBulkSummary(summary);
        if (summary.reviewed > 0) toast.success(`Reviewed ${summary.reviewed} ticket(s)`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Bulk review failed");
      } finally {
        setPending(false);
      }
      return;
    }

    try {
      const { reviewId } = await createReviewAction(formData);
      toast.success("Review complete");
      setOpen(false);
      formRef.current?.reset();
      router.push(`/qa/reviews/${reviewId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to run review");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setBulkSummary(null);
      }}
    >
      <DialogTrigger render={<Button size="sm" disabled={disabled} />}>
        <Plus className="size-4" />
        New Review
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run a QA Review</DialogTitle>
        </DialogHeader>
        <Tabs value={mode} onValueChange={(v) => v && setMode(v as "single" | "bulk")}>
          <TabsList>
            <TabsTrigger value="single">Single ticket</TabsTrigger>
            <TabsTrigger value="bulk">Bulk (multiple tickets)</TabsTrigger>
          </TabsList>
          <form ref={formRef} action={handleSubmit}>
            <TabsContent value="single" className="mt-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="ticketId">Zendesk Ticket ID</FieldLabel>
                  <Input id="ticketId" name="ticketId" placeholder="12345" />
                </Field>
              </FieldGroup>
            </TabsContent>
            <TabsContent value="bulk" className="mt-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="ticketIds">Zendesk Ticket IDs</FieldLabel>
                  <Textarea id="ticketIds" name="ticketIds" rows={5} placeholder={"12345\n12346\n12347"} />
                  <FieldDescription>One per line or comma-separated — up to 100 at a time.</FieldDescription>
                </Field>
              </FieldGroup>
            </TabsContent>

            <FieldGroup className="mt-4">
              <Field>
                <FieldLabel htmlFor="sopId">SOP</FieldLabel>
                <Select name="sopId" defaultValue={sops[0]?.id}>
                  <SelectTrigger id="sopId" className="w-full">
                    <SelectValue>{(v: string) => sops.find((s) => s.id === v)?.name ?? v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {sops.map((sop) => (
                      <SelectItem key={sop.id} value={sop.id}>
                        {sop.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>

            {bulkSummary && (
              <div className="mt-4 rounded-md border p-3 text-sm">
                <p>
                  Reviewed <strong>{bulkSummary.reviewed}</strong>, failed <strong>{bulkSummary.failed}</strong>
                  {bulkSummary.quotaBlocked > 0 && (
                    <>
                      , <strong>{bulkSummary.quotaBlocked}</strong> skipped (quota reached)
                    </>
                  )}
                  .
                </p>
                {bulkSummary.errors.length > 0 && (
                  <ul className="mt-2 max-h-32 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">
                    {bulkSummary.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <DialogFooter className="mt-4">
              <Button type="submit" disabled={pending || sops.length === 0}>
                {pending ? "Scoring..." : mode === "bulk" ? "Run Bulk Review" : "Run Review"}
              </Button>
            </DialogFooter>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
