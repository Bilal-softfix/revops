'use client';

import type { Lead, Pipeline, Stage } from '@revops/shared';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { FormError, TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/api/messages';
import { common } from '@/lib/strings/common';
import { leadStrings as s } from '@/lib/strings/leads';
import { useChangeLeadStage } from './queries';

interface Pending {
  lead: Lead;
  pipeline: Pipeline;
  stage: Stage;
}

/**
 * One way to move a lead (stage picker, board drag-drop, pipeline move): open/won stages move
 * at once; a lost stage first asks for a reason (the pipeline's presets, or free text).
 */
export function useStageChange(): {
  change: (lead: Lead, pipeline: Pipeline, stage: Stage) => Promise<void>;
  dialog: ReactNode;
  pending: boolean;
} {
  const mutation = useChangeLeadStage();
  const [lost, setLost] = useState<Pending | null>(null);

  const move = async ({ lead, pipeline, stage }: Pending, lostReason?: string): Promise<void> => {
    await mutation.mutateAsync({
      id: lead.id,
      stageId: stage.id,
      ...(pipeline.id !== lead.pipelineId ? { pipelineId: pipeline.id } : {}),
      ...(lostReason ? { lostReason } : {}),
    });
    toast.success(s.stageChanged(stage.name));
  };

  const change = async (lead: Lead, pipeline: Pipeline, stage: Stage) => {
    if (stage.id === lead.stageId && pipeline.id === lead.pipelineId) return;
    if (stage.category === 'lost') {
      setLost({ lead, pipeline, stage });
      return;
    }
    await move({ lead, pipeline, stage }).catch((error: unknown) =>
      toast.error(errorMessage(error)),
    );
  };

  const dialog = lost ? (
    <LostReasonDialog
      pending={lost}
      onCancel={() => setLost(null)}
      onConfirm={async (reason) => {
        await move(lost, reason);
        setLost(null);
      }}
    />
  ) : null;

  return { change, dialog, pending: mutation.isPending };
}

function LostReasonDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: Pending;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const presets = pending.pipeline.lostReasons;
  const [choice, setChoice] = useState<string>(presets[0] ?? '');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = custom.trim() || choice;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.lost.title(pending.stage.name)}</DialogTitle>
          <DialogDescription>{s.lost.body}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason) return;
            setBusy(true);
            setError(null);
            onConfirm(reason)
              .catch((e: unknown) => setError(errorMessage(e)))
              .finally(() => setBusy(false));
          }}
        >
          <FormError message={error} />
          {presets.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="sr-only">{s.form.lostReason}</legend>
              {presets.map((preset) => (
                <label key={preset} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="lost-reason"
                    className="size-4 accent-primary"
                    checked={!custom.trim() && choice === preset}
                    onChange={() => {
                      setChoice(preset);
                      setCustom('');
                    }}
                  />
                  {preset}
                </label>
              ))}
            </fieldset>
          ) : null}
          <TextField
            label={presets.length > 0 ? s.lost.custom : s.form.lostReason}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              {common.cancel}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !reason}>
              {s.lost.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
