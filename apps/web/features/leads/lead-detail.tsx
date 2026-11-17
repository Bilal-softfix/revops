'use client';

import {
  type Lead,
  type Pipeline,
  buildCustomFieldsSchema,
  customFieldsForPipeline,
  formatPhone,
} from '@revops/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { CustomFieldInputs } from '@/components/form/custom-field-inputs';
import { SimpleSelect } from '@/components/form/simple-select';
import { FormError, TextField } from '@/components/form/text-field';
import { ErrorState, LoadingState } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LeadTasks } from '@/features/activities/lead-tasks';
import { LeadTimeline } from '@/features/activities/lead-timeline';
import { useCustomFields } from '@/features/custom-fields/queries';
import { usePipelines } from '@/features/pipelines/queries';
import { useMembers } from '@/features/team/queries';
import { errorMessage } from '@/lib/api/messages';
import { ApiError } from '@/lib/api/problem';
import {
  type CustomFieldFormValues,
  customFieldsPayload,
  initialInputs,
} from '@/lib/custom-fields';
import { formatDate } from '@/lib/format';
import { formatPaise, paiseToRupeesInput, rupeesToPaise } from '@/lib/money';
import { useSession } from '@/lib/session';
import { common } from '@/lib/strings/common';
import { leadStrings as s } from '@/lib/strings/leads';
import { useDeleteLead, useLead, useLeadSources, useUpdateLead } from './queries';
import { useStageChange } from './use-stage-change';

/** Lead page: timeline (notes) on the left; side panel with stage, owner, tasks and details. */
export function LeadDetail({ id }: { id: string }) {
  const lead = useLead(id);
  const pipelines = usePipelines();
  if (lead.isPending || pipelines.isPending) return <LoadingState rows={8} />;
  if (lead.isError) return <ErrorState error={lead.error} onRetry={() => void lead.refetch()} />;
  if (pipelines.isError) {
    return <ErrorState error={pipelines.error} onRetry={() => void pipelines.refetch()} />;
  }
  const pipeline = pipelines.data.items.find((p) => p.id === lead.data.pipelineId);
  if (!pipeline) return <ErrorState error={new Error('pipeline missing')} />;
  return <LeadPage lead={lead.data} pipeline={pipeline} pipelines={pipelines.data.items} />;
}

function LeadPage({
  lead,
  pipeline,
  pipelines,
}: {
  lead: Lead;
  pipeline: Pipeline;
  pipelines: readonly Pipeline[];
}) {
  const { can } = useSession();
  const router = useRouter();
  const { change, dialog, pending } = useStageChange();
  const update = useUpdateLead();
  const remove = useDeleteLead();
  const members = (useMembers().data?.pages.flatMap((p) => p.items) ?? []).filter(
    (m) => m.status === 'active',
  );
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const stage = pipeline.stages.find((x) => x.id === lead.stageId);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <Link href="/leads" className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {s.detail.back}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{lead.contact.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[formatPhone(lead.contact.phoneE164), lead.contact.email].filter(Boolean).join(' · ')}{' '}
            ·{' '}
            <Link href={`/contacts/${lead.contact.id}`} className="underline">
              {s.detail.openContact}
            </Link>
          </p>
        </div>
        <Badge
          variant={
            lead.status === 'lost' ? 'destructive' : lead.status === 'won' ? 'default' : 'secondary'
          }
        >
          {s.status[lead.status]}
        </Badge>
      </div>
      {lead.wonAt ? <p className="text-sm">{s.detail.won(formatDate(lead.wonAt))}</p> : null}
      {lead.lostAt ? (
        <p className="text-sm">{s.detail.lost(formatDate(lead.lostAt), lead.lostReason)}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <LeadTimeline leadId={lead.id} />
        <aside className="grid content-start gap-6" aria-label={s.detail.details}>
          <section className="grid gap-4 rounded-md border p-4">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">{s.detail.pipeline}</span>
              <span className="text-sm">{pipeline.name}</span>
              {pipelines.length > 1 ? (
                <Button
                  variant="link"
                  size="sm"
                  className="justify-start px-0"
                  onClick={() => setMoving(true)}
                >
                  {s.detail.movePipeline}
                </Button>
              ) : null}
            </div>
            <SimpleSelect
              label={s.detail.stage}
              value={stage?.id ?? ''}
              disabled={pending}
              options={pipeline.stages.map((x) => ({ value: x.id, label: x.name }))}
              onChange={(stageId) => {
                const target = pipeline.stages.find((x) => x.id === stageId);
                if (target) void change(lead, pipeline, target);
              }}
            />
            {can('lead.assign') ? (
              <SimpleSelect
                label={s.detail.owner}
                value={lead.owner?.id ?? ''}
                noneLabel={s.unassigned}
                options={members.map((m) => ({ value: m.userId, label: m.name }))}
                disabled={update.isPending}
                onChange={(ownerUserId) =>
                  void update
                    .mutateAsync({ id: lead.id, ownerUserId: ownerUserId || null })
                    .then(() => toast.success(s.saved))
                    .catch((e: unknown) => toast.error(errorMessage(e)))
                }
              />
            ) : (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">{s.detail.owner}</span>
                <span className="text-sm">{lead.owner?.name ?? s.unassigned}</span>
              </div>
            )}
          </section>

          <LeadTasks lead={lead} />

          <LeadDetailsForm key={`${lead.id}:${lead.pipelineId}:${lead.updatedAt}`} lead={lead} />

          {can('lead.delete') ? (
            <div>
              <Button variant="outline" onClick={() => setDeleting(true)}>
                {s.detail.delete}
              </Button>
            </div>
          ) : null}
        </aside>
      </div>

      {moving ? (
        <MovePipelineDialog
          pipelines={pipelines.filter((p) => p.id !== lead.pipelineId)}
          onClose={() => setMoving(false)}
          onMove={async (target, targetStage) => {
            setMoving(false);
            await change(lead, target, targetStage);
          }}
        />
      ) : null}
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s.detail.deleteTitle}</DialogTitle>
            <DialogDescription>{s.detail.deleteBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{common.cancel}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                void remove
                  .mutateAsync(lead.id)
                  .then(() => {
                    toast.success(s.deleted);
                    router.push('/leads');
                  })
                  .catch((e: unknown) => toast.error(errorMessage(e)))
              }
            >
              {s.detail.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}

/** Source, value and the custom fields of the lead's pipeline. Sends only what changed. */
function LeadDetailsForm({ lead }: { lead: Lead }) {
  const update = useUpdateLead();
  const sources = useLeadSources().data?.items ?? [];
  const defs = customFieldsForPipeline(useCustomFields('lead').data?.items ?? [], lead.pipelineId);
  const [sourceId, setSourceId] = useState(lead.source?.id ?? '');
  const [value, setValue] = useState(paiseToRupeesInput(lead.valuePaise));
  const [edited, setEdited] = useState<CustomFieldFormValues>({});
  const cfInputs = { ...initialInputs(defs, lead.customFields), ...edited };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setErrors({});
    setFormError(null);
    const valuePaise = rupeesToPaise(value);
    if (valuePaise === undefined) {
      setErrors({ valuePaise: s.form.valueHint });
      return;
    }
    const customFields = customFieldsPayload(defs, cfInputs, lead.customFields);
    const check = buildCustomFieldsSchema(defs, 'patch').safeParse(customFields);
    if (!check.success) {
      setErrors(
        Object.fromEntries(check.error.issues.map((i) => [String(i.path[0] ?? ''), i.message])),
      );
      return;
    }
    const body = {
      ...((sourceId || null) !== (lead.source?.id ?? null) ? { sourceId: sourceId || null } : {}),
      ...(valuePaise !== lead.valuePaise ? { valuePaise } : {}),
      ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
    };
    if (Object.keys(body).length === 0) return;
    try {
      await update.mutateAsync({ id: lead.id, ...body });
      toast.success(s.saved);
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(
          Object.fromEntries(
            Object.entries(error.fieldErrors).map(([k, v]) => [
              k.replace(/^customFields\./, ''),
              v,
            ]),
          ),
        );
      } else {
        setFormError(errorMessage(error));
      }
    }
  };

  return (
    <form
      noValidate
      className="grid gap-4 rounded-md border p-4"
      aria-label={s.detail.details}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-lg font-medium">{s.detail.details}</h2>
      <FormError message={formError} />
      <div className="grid gap-4">
        <SimpleSelect
          label={s.form.source}
          value={sourceId}
          noneLabel={s.filters.anySource}
          options={sources.map((x) => ({ value: x.id, label: x.name }))}
          error={errors.sourceId}
          onChange={setSourceId}
        />
        <TextField
          label={s.form.value}
          inputMode="decimal"
          hint={`${s.form.valueHint} · ${formatPaise(lead.valuePaise)}`}
          value={value}
          error={errors.valuePaise}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      {defs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{s.detail.noFields}</p>
      ) : (
        <CustomFieldInputs
          defs={defs}
          values={cfInputs}
          errors={errors}
          onChange={(key, v) => setEdited((current) => ({ ...current, [key]: v }))}
        />
      )}
      <div>
        <Button type="submit" disabled={update.isPending}>
          {s.detail.save}
        </Button>
      </div>
    </form>
  );
}

function MovePipelineDialog({
  pipelines,
  onClose,
  onMove,
}: {
  pipelines: readonly Pipeline[];
  onClose: () => void;
  onMove: (pipeline: Pipeline, stage: Pipeline['stages'][number]) => Promise<void>;
}) {
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? '');
  const target = pipelines.find((p) => p.id === pipelineId);
  const [stageId, setStageId] = useState('');
  const firstOpen = target?.stages.find((x) => x.category === 'open')?.id ?? '';
  const effectiveStage = target?.stages.some((x) => x.id === stageId) ? stageId : firstOpen;
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.detail.movePipelineTitle}</DialogTitle>
          <DialogDescription>{s.detail.movePipelineHint}</DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        <SimpleSelect
          label={s.form.pipeline}
          value={pipelineId}
          options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) => {
            setPipelineId(id);
            setStageId('');
          }}
        />
        <SimpleSelect
          label={s.form.stage}
          value={effectiveStage}
          options={(target?.stages ?? []).map((x) => ({ value: x.id, label: x.name }))}
          onChange={setStageId}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button
            disabled={!target || !effectiveStage}
            onClick={() => {
              const stage = target?.stages.find((x) => x.id === effectiveStage);
              if (target && stage) {
                onMove(target, stage).catch((e: unknown) => setError(errorMessage(e)));
              }
            }}
          >
            {s.detail.move}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
