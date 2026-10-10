"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { callAction } from "@/lib/actions/call-action";
import { acceptProposalAction, addTopicAction, proposalImpactAction } from "./actions";

type Option = { id: string; name: string };
const SELECT = "h-9 rounded-md border border-input bg-transparent px-2 text-sm";

const conversations = (n: number) => `${n.toLocaleString("en-IN")} ${n === 1 ? "conversation" : "conversations"}`;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function AddTopicForm({ themes }: { themes: Option[] }) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(themes[0]?.id ?? "");
  const [pending, setPending] = useState(false);

  async function add(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await callAction(addTopicAction)({ name, parentId: parentId || null });
      toast.success(parentId ? "Topic added" : "Theme added");
      setName("");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={add} className="flex flex-wrap items-center gap-2 border-t border-border p-4">
      <Input aria-label="Name" className="min-w-48 flex-1" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      <select aria-label="Theme" className={SELECT} value={parentId} onChange={(e) => setParentId(e.target.value)}>
        {themes.map((t) => (
          <option key={t.id} value={t.id}>
            Topic under {t.name}
          </option>
        ))}
        <option value="">New theme</option>
      </select>
      <Button type="submit" size="sm" disabled={pending || !name.trim()}>
        Add
      </Button>
    </form>
  );
}

export function AcceptProposal({ proposed, themes }: { proposed: string; themes: Option[] }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [parentId, setParentId] = useState(themes[0]?.id ?? "");
  const [reanalyse, setReanalyse] = useState(true);
  const [pending, setPending] = useState(false);

  async function start() {
    setOpen(true);
    setCount(null);
    try {
      setCount(await callAction(proposalImpactAction)(proposed));
    } catch (error) {
      toast.error(errorMessage(error));
      setOpen(false);
    }
  }

  async function accept(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await callAction(acceptProposalAction)({ proposed, parentId, reanalyse: reanalyse && (count ?? 0) > 0 });
      toast.success(result.reanalysed > 0 ? `Topic added; re-analysing ${conversations(result.reanalysed)}` : "Topic added");
      setOpen(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={start} disabled={themes.length === 0}>
        Add as topic
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add “{proposed}”</DialogTitle>
            <DialogDescription>New conversations will be sorted into it from now on.</DialogDescription>
          </DialogHeader>
          <form onSubmit={accept} className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="proposal-theme">Theme</FieldLabel>
              <select id="proposal-theme" className={`${SELECT} w-full`} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            {count == null ? (
              <p className="text-sm text-muted-foreground">Counting matching conversations…</p>
            ) : count > 0 ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={reanalyse} onChange={(e) => setReanalyse(e.target.checked)} />
                <span>
                  Also re-analyse {count === 1 ? "the conversation" : `the ${conversations(count)}`} from the last 30 days that suggested it.
                  <span className="block text-xs text-muted-foreground">Uses {count.toLocaleString("en-IN")} of this month&apos;s analysis allowance.</span>
                </span>
              </label>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={pending || count == null || !parentId}>
                {pending ? "Adding…" : "Add topic"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
