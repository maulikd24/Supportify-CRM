"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { callAction } from "@/lib/actions/call-action";
import { archiveTopicAction, mergeTopicAction, updateTopicAction } from "../actions";

type Option = { id: string; name: string };
const SELECT = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";

export function TopicEditor({
  topic,
  themes,
  teams,
  mergeTargets,
}: {
  topic: { id: string; name: string; description: string | null; parentId: string | null; ownerTeamId: string | null };
  themes: Option[];
  teams: Option[];
  mergeTargets: Option[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [name, setName] = useState(topic.name);
  const [description, setDescription] = useState(topic.description ?? "");
  const [parentId, setParentId] = useState(topic.parentId ?? "");
  const [ownerTeamId, setOwnerTeamId] = useState(topic.ownerTeamId ?? "");
  const [targetId, setTargetId] = useState("");
  const isTheme = !topic.parentId;

  async function run(fn: () => Promise<unknown>, success: string) {
    setPending(true);
    try {
      await fn();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () =>
        callAction(updateTopicAction)({
          topicId: topic.id,
          name,
          description: description || null,
          ...(isTheme ? {} : { parentId }),
          ownerTeamId: ownerTeamId || null,
        }),
      "Topic saved",
    );
    if (ok) setEditOpen(false);
  }

  async function merge(event: FormEvent) {
    event.preventDefault();
    const target = mergeTargets.find((t) => t.id === targetId);
    if (!target) return;
    if (await run(() => callAction(mergeTopicAction)({ sourceId: topic.id, targetId }), `Merged into ${target.name}`)) {
      setMergeOpen(false);
      router.push(`/cx/topics/${targetId}`);
    }
  }

  async function archive() {
    const message = isTheme
      ? `Archive the theme "${topic.name}"?`
      : `Archive "${topic.name}"? New conversations won't be sorted into it; its history is kept.`;
    if (confirm(message) && (await run(() => callAction(archiveTopicAction)(topic.id), "Topic archived"))) router.push("/cx/topics");
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogTrigger render={<Button size="sm" variant="outline" />}>Edit</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {isTheme ? "theme" : "topic"}</DialogTitle>
            <DialogDescription>Changes apply to conversations analysed from now on.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="topic-name">Name</FieldLabel>
                <Input id="topic-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
              </Field>
              <Field>
                <FieldLabel htmlFor="topic-description">Description</FieldLabel>
                <Textarea
                  id="topic-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="What belongs here. The analysis reads this when sorting conversations."
                />
              </Field>
              {!isTheme && (
                <Field>
                  <FieldLabel htmlFor="topic-theme">Theme</FieldLabel>
                  <select id="topic-theme" className={SELECT} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                    {themes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="topic-owner">Owner team</FieldLabel>
                <select id="topic-owner" className={SELECT} value={ownerTeamId} onChange={(e) => setOwnerTeamId(e.target.value)}>
                  <option value="">No owner</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {!isTheme && mergeTargets.length > 0 && (
        <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" />}>Merge</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Merge “{topic.name}”</DialogTitle>
              <DialogDescription>
                Its conversations and issues move to the topic you choose, and it stops being used. This can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={merge}>
              <Field>
                <FieldLabel htmlFor="merge-target">Merge into</FieldLabel>
                <select id="merge-target" className={SELECT} value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                  <option value="">Choose a topic…</option>
                  {mergeTargets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <DialogFooter className="mt-4">
                <Button type="submit" variant="destructive" disabled={pending || !targetId}>
                  {pending ? "Merging…" : "Merge"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      <Button size="sm" variant="ghost" disabled={pending} onClick={archive}>
        Archive
      </Button>
    </div>
  );
}
