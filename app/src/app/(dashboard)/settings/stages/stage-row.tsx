"use client";

import { useState } from "react";
import { toast } from "sonner";

import { TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { updateStageAction } from "./actions";
import type { Stage } from "@/generated/prisma/client";

export function StageRow({ stage }: { stage: Stage }) {
  const [name, setName] = useState(stage.name);
  const [slaHours, setSlaHours] = useState(stage.slaHours);
  const [isActive, setIsActive] = useState(stage.isActive);
  const [isTerminal, setIsTerminal] = useState(stage.isTerminal);
  const [pending, setPending] = useState(false);

  async function save(next: { name: string; slaHours: number; isActive: boolean; isTerminal: boolean }) {
    setPending(true);
    try {
      await updateStageAction(stage.id, next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update stage");
    } finally {
      setPending(false);
    }
  }

  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{stage.sequence}</TableCell>
      <TableCell>
        <Input
          className="w-40"
          value={name}
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => save({ name, slaHours, isActive, isTerminal })}
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          className="w-24"
          value={slaHours}
          disabled={pending}
          onChange={(e) => setSlaHours(Number(e.target.value))}
          onBlur={() => save({ name, slaHours, isActive, isTerminal })}
        />
      </TableCell>
      <TableCell>
        <Switch
          checked={isActive}
          disabled={pending}
          onCheckedChange={(checked) => {
            setIsActive(checked);
            save({ name, slaHours, isActive: checked, isTerminal });
          }}
        />
      </TableCell>
      <TableCell>
        <Switch
          checked={isTerminal}
          disabled={pending}
          onCheckedChange={(checked) => {
            setIsTerminal(checked);
            save({ name, slaHours, isActive, isTerminal: checked });
          }}
        />
      </TableCell>
      <TableCell>
        <Badge variant={isActive ? "default" : "outline"}>{isActive ? "Active" : "Inactive"}</Badge>
      </TableCell>
    </TableRow>
  );
}
