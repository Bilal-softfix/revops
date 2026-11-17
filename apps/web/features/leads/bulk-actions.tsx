'use client';

import type { BulkLeadResult, Member, Pipeline } from '@revops/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { SimpleSelect } from '@/components/form/simple-select';
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
import { useSession } from '@/lib/session';
import { common } from '@/lib/strings/common';
import { leadStrings } from '@/lib/strings/leads';
import { useBulkAssignLeads, useBulkChangeLeadStage } from './queries';

const s = leadStrings.bulk;
/** Select value for "no owner" (Radix Select can't hold an empty value). */
const UNASSIGNED = 'unassigned';

const announce = (result: BulkLeadResult) =>
  toast.success(
    s.result({
      updated: result.updatedIds.length,
      unchanged: result.unchangedIds.length,
      notFound: result.notFoundIds.length,
    }),
  );

/**
 * "N selected" bar over the leads list (M1-T6): assign to a member (or nobody), move to a stage,
 * clear. Rendered only for `lead.bulk` roles; on success the selection is cleared.
 */
export function BulkActionBar({
  selectedIds,
  pipelines,
  members,
  defaultPipelineId,
  onDone,
}: {
  selectedIds: readonly string[];
  pipelines: readonly Pipeline[];
  members: readonly Member[];
  /** The selected leads' pipeline when they share one. */
  defaultPipelineId: string | undefined;
  onDone: () => void;
}) {
  const { can } = useSession();
  const [open, setOpen] = useState<'assign' | 'move' | null>(null);
  const count = selectedIds.length;
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={s.barLabel}
      className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2"
    >
      <span className="text-sm font-medium" data-testid="bulk-selected">
        {s.selected(count)}
      </span>
      {can('lead.assign') ? (
        <Button variant="outline" size="sm" onClick={() => setOpen('assign')}>
          {s.assign}
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => setOpen('move')}>
        {s.move}
      </Button>
      <Button variant="ghost" size="sm" onClick={onDone}>
        {s.clear}
      </Button>
      {open === 'assign' ? (
        <AssignDialog
          leadIds={selectedIds}
          members={members}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            onDone();
          }}
        />
      ) : null}
      {open === 'move' ? (
        <MoveDialog
          leadIds={selectedIds}
          pipelines={pipelines}
          defaultPipelineId={defaultPipelineId}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            onDone();
          }}
        />
      ) : null}
    </div>
  );
}

function AssignDialog({
  leadIds,
  members,
  onClose,
  onDone,
}: {
  leadIds: readonly string[];
  members: readonly Member[];
  onClose: () => void;
  onDone: () => void;
}) {
  const assign = useBulkAssignLeads();
  const [owner, setOwner] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.assignTitle(leadIds.length)}</DialogTitle>
          <DialogDescription>{s.assignHint}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!owner) return;
            setError(null);
            assign
              .mutateAsync({
                leadIds: [...leadIds],
                ownerUserId: owner === UNASSIGNED ? null : owner,
              })
              .then((result) => {
                announce(result);
                onDone();
              })
              .catch((e: unknown) => setError(errorMessage(e)));
          }}
        >
          <FormError message={error} />
          <SimpleSelect
            label={s.owner}
            value={owner}
            onChange={setOwner}
            options={[
              { value: UNASSIGNED, label: s.unassigned },
              ...members.map((m) => ({ value: m.userId, label: m.name })),
            ]}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {common.cancel}
            </Button>
            <Button type="submit" disabled={assign.isPending || !owner}>
              {s.assignConfirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Pipeline + stage picker; a lost stage also asks for the reason (presets or free text). */
function MoveDialog({
  leadIds,
  pipelines,
  defaultPipelineId,
  onClose,
  onDone,
}: {
  leadIds: readonly string[];
  pipelines: readonly Pipeline[];
  defaultPipelineId: string | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const move = useBulkChangeLeadStage();
  const [pipelineId, setPipelineId] = useState(
    defaultPipelineId ?? pipelines.find((p) => p.isDefault)?.id ?? pipelines[0]?.id ?? '',
  );
  const [stageId, setStageId] = useState('');
  const [choice, setChoice] = useState('');
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pipeline = pipelines.find((p) => p.id === pipelineId);
  const stage = pipeline?.stages.find((x) => x.id === stageId);
  const lost = stage?.category === 'lost';
  const presets = pipeline?.lostReasons ?? [];
  const reason = custom.trim() || choice;
  const ready = Boolean(stage) && (!lost || Boolean(reason));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.moveTitle(leadIds.length)}</DialogTitle>
          <DialogDescription>{s.moveHint}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!stage || !ready) return;
            setError(null);
            move
              .mutateAsync({
                leadIds: [...leadIds],
                pipelineId,
                stageId: stage.id,
                ...(lost ? { lostReason: reason } : {}),
              })
              .then((result) => {
                announce(result);
                onDone();
              })
              .catch((e: unknown) => setError(errorMessage(e)));
          }}
        >
          <FormError message={error} />
          <SimpleSelect
            label={s.pipeline}
            value={pipelineId}
            onChange={(id) => {
              setPipelineId(id);
              setStageId('');
              setChoice('');
            }}
            options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
          />
          <SimpleSelect
            label={s.stage}
            value={stageId}
            onChange={(id) => {
              setStageId(id);
              setChoice(presets[0] ?? '');
            }}
            options={(pipeline?.stages ?? []).map((x) => ({ value: x.id, label: x.name }))}
          />
          {lost ? (
            <div className="grid gap-2">
              {presets.length > 0 ? (
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">{s.lostReason}</legend>
                  {presets.map((preset) => (
                    <label key={preset} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="bulk-lost-reason"
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
                label={presets.length > 0 ? s.customReason : s.lostReason}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {common.cancel}
            </Button>
            <Button
              type="submit"
              variant={lost ? 'destructive' : 'default'}
              disabled={move.isPending || !ready}
            >
              {s.moveConfirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
