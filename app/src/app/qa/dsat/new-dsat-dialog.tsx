"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { submitDsatAction } from "./actions";

export function NewDsatDialog({ hasZendesk }: { hasZendesk: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"manual" | "zendesk">("manual");
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  async function handleSubmit(formData: FormData) {
    formData.set("inputMode", mode);
    setPending(true);
    try {
      const { analysisId } = await submitDsatAction(formData);
      toast.success("Analysis complete");
      setOpen(false);
      formRef.current?.reset();
      router.push(`/qa/dsat/${analysisId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to analyse ticket");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        New Analysis
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Analyse a DSAT ticket</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={handleSubmit}>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "manual" | "zendesk")}>
            <TabsList>
              <TabsTrigger value="manual">Paste conversation</TabsTrigger>
              <TabsTrigger value="zendesk" disabled={!hasZendesk}>
                Zendesk ticket
              </TabsTrigger>
            </TabsList>
            <TabsContent value="manual" className="mt-4">
              <Field>
                <FieldLabel htmlFor="manualConversation">Conversation</FieldLabel>
                <Textarea
                  id="manualConversation"
                  name="manualConversation"
                  rows={8}
                  placeholder={"[CUSTOMER]: ...\n[AGENT]: ..."}
                />
              </Field>
            </TabsContent>
            <TabsContent value="zendesk" className="mt-4">
              <Field>
                <FieldLabel htmlFor="ticketId">Zendesk Ticket ID</FieldLabel>
                <Input id="ticketId" name="ticketId" placeholder="12345" />
              </Field>
            </TabsContent>
          </Tabs>
          <FieldGroup className="mt-4">
            <Field>
              <FieldLabel htmlFor="manualSubject">Subject (optional)</FieldLabel>
              <Input id="manualSubject" name="manualSubject" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="agentName">Agent name</FieldLabel>
                <Input id="agentName" name="agentName" />
              </Field>
              <Field>
                <FieldLabel htmlFor="customerName">Customer name</FieldLabel>
                <Input id="customerName" name="customerName" />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="context">Additional context (optional)</FieldLabel>
              <Textarea id="context" name="context" rows={2} />
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Analysing..." : "Run Analysis"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
