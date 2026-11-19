'use client';

import {
  DEFAULT_STAGE_PROBABILITY,
  type Pipeline,
  STAGE_CATEGORIES,
  type Stage,
  type StageCategory,
  stageHasLeadsSchema,
} from '@revops/shared';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError, TextField } from '@/components/form/text-field';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/states';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { errorMessage } from '@/lib/api/messages';
import { ApiError } from '@/lib/api/problem';
import { common } from '@/lib/strings/common';
import { pipelineStrings as s } from '@/lib/strings/pipelines';
import {
  useAddStage,
  useCreatePipeline,
  useDeletePipeline,
  useDeleteStage,
  usePipelines,
  useReorderPipelines,
  useReorderStages,
  useUpdatePipeline,
  useUpdateStage,
} from './queries';

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
/** `ids` with the item at `index` swapped one place up (-1) or down (+1). */
const moved = (ids: string[], index: number, by: -1 | 1) => {
  const next = [...ids];
  const [item] = next.splice(index, 1);
  if (item) next.splice(index + by, 0, item);
  return next;
};
const categoryVariant = (c: StageCategory) =>
  c === 'won' ? 'default' : c === 'lost' ? 'destructive' : 'secondary';

type Editing =
  | { kind: 'pipeline'; pipeline: Pipeline | null }
  | { kind: 'stage'; pipeline: Pipeline; stage: Stage | null }
  | { kind: 'deletePipeline'; pipeline: Pipeline }
  | { kind: 'deleteStage'; pipeline: Pipeline; stage: Stage };

/** Settings → Pipelines (owners/admins): pipelines and their stages. */
export function PipelinesView() {
  const pipelines = usePipelines();
  const reorder = useReorderPipelines();
  const [editing, setEditing] = useState<Editing | null>(null);
  const close = () => setEditing(null);
  const items = pipelines.data?.items ?? [];

  return (
    <div className="mx-auto grid max-w-5xl gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          <p className="text-sm text-muted-foreground">{s.description}</p>
        </div>
        <Button onClick={() => setEditing({ kind: 'pipeline', pipeline: null })}>
          <Plus aria-hidden />
          {s.newPipeline}
        </Button>
      </div>
      {pipelines.isPending ? (
        <LoadingState rows={6} />
      ) : pipelines.isError ? (
        <ErrorState error={pipelines.error} onRetry={() => void pipelines.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={s.empty} />
      ) : (
        items.map((pipeline, index) => (
          <PipelineCard
            key={pipeline.id}
            pipeline={pipeline}
            first={index === 0}
            last={index === items.length - 1}
            busy={reorder.isPending}
            onMove={(by) =>
              void reorder
                .mutateAsync(
                  moved(
                    items.map((p) => p.id),
                    index,
                    by,
                  ),
                )
                .catch((error: unknown) => toast.error(errorMessage(error)))
            }
            onEdit={setEditing}
          />
        ))
      )}
      {editing?.kind === 'pipeline' ? (
        <PipelineDialog pipeline={editing.pipeline} onClose={close} />
      ) : null}
      {editing?.kind === 'stage' ? (
        <StageDialog pipeline={editing.pipeline} stage={editing.stage} onClose={close} />
      ) : null}
      {editing?.kind === 'deletePipeline' ? (
        <DeletePipelineDialog pipeline={editing.pipeline} onClose={close} />
      ) : null}
      {editing?.kind === 'deleteStage' ? (
        <DeleteStageDialog pipeline={editing.pipeline} stage={editing.stage} onClose={close} />
      ) : null}
    </div>
  );
}

function PipelineCard({
  pipeline,
  first,
  last,
  busy,
  onMove,
  onEdit,
}: {
  pipeline: Pipeline;
  first: boolean;
  last: boolean;
  busy: boolean;
  onMove: (by: -1 | 1) => void;
  onEdit: (editing: Editing) => void;
}) {
  const update = useUpdatePipeline();
  const reorderStages = useReorderStages();
  const headingId = `pipeline-${pipeline.id}`;
  const stageIds = pipeline.stages.map((st) => st.id);

  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-3 rounded-xl border bg-card p-5 shadow-card"
      data-testid={`pipeline-${pipeline.name}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 id={headingId} className="text-lg font-medium">
            {pipeline.name}
          </h2>
          {pipeline.isDefault ? (
            <Badge variant="secondary" title={s.defaultHint}>
              {s.default}
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={s.moveUp(pipeline.name)}
            disabled={first || busy}
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={s.moveDown(pipeline.name)}
            disabled={last || busy}
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden />
          </Button>
          {!pipeline.isDefault ? (
            <Button
              variant="outline"
              size="sm"
              disabled={update.isPending}
              onClick={() =>
                void update
                  .mutateAsync({ id: pipeline.id, isDefault: true })
                  .then(() => toast.success(s.defaultSet(pipeline.name)))
                  .catch((error: unknown) => toast.error(errorMessage(error)))
              }
            >
              {s.makeDefault}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit({ kind: 'pipeline', pipeline })}
          >
            {s.rename}
          </Button>
          {!pipeline.isDefault ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit({ kind: 'deletePipeline', pipeline })}
            >
              {s.delete}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{s.columns.stage}</TableHead>
              <TableHead>{s.columns.category}</TableHead>
              <TableHead>{s.columns.probability}</TableHead>
              <TableHead className="text-right">{s.columns.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pipeline.stages.map((stage, index) => (
              <TableRow key={stage.id} data-testid={`stage-${stage.name}`}>
                <TableCell className="font-medium">{stage.name}</TableCell>
                <TableCell>
                  <Badge variant={categoryVariant(stage.category)}>
                    {s.categories[stage.category]}
                  </Badge>
                </TableCell>
                <TableCell>{stage.probability}%</TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={s.moveUp(stage.name)}
                    disabled={index === 0 || reorderStages.isPending}
                    onClick={() =>
                      void reorderStages
                        .mutateAsync({
                          pipelineId: pipeline.id,
                          stageIds: moved(stageIds, index, -1),
                        })
                        .catch((error: unknown) => toast.error(errorMessage(error)))
                    }
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={s.moveDown(stage.name)}
                    disabled={index === stageIds.length - 1 || reorderStages.isPending}
                    onClick={() =>
                      void reorderStages
                        .mutateAsync({
                          pipelineId: pipeline.id,
                          stageIds: moved(stageIds, index, 1),
                        })
                        .catch((error: unknown) => toast.error(errorMessage(error)))
                    }
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit({ kind: 'stage', pipeline, stage })}
                  >
                    {s.rename}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onEdit({ kind: 'deleteStage', pipeline, stage })}
                  >
                    {s.delete}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit({ kind: 'stage', pipeline, stage: null })}
        >
          <Plus aria-hidden />
          {s.addStage}
        </Button>
      </div>
    </section>
  );
}

/** Create (pipeline = null) or edit a pipeline's name and lost reasons. */
function PipelineDialog({ pipeline, onClose }: { pipeline: Pipeline | null; onClose: () => void }) {
  const create = useCreatePipeline();
  const update = useUpdatePipeline();
  const [name, setName] = useState(pipeline?.name ?? '');
  const [reasons, setReasons] = useState(pipeline?.lostReasons.join('\n') ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  const submit = async () => {
    setErrors({});
    setFormError(null);
    const body = { name: name.trim(), lostReasons: lines(reasons) };
    try {
      if (pipeline) {
        await update.mutateAsync({ id: pipeline.id, ...body });
        toast.success(s.saved);
      } else {
        const created = await create.mutateAsync(body);
        toast.success(s.created(created.name));
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'pipeline_name_taken') {
        setErrors({ name: error.message });
      } else if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      } else {
        setFormError(errorMessage(error));
      }
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {pipeline ? s.editPipelineTitle(pipeline.name) : s.newPipelineTitle}
          </DialogTitle>
          {pipeline ? null : <DialogDescription>{s.newPipelineHint}</DialogDescription>}
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FormError message={formError} />
          <TextField
            label={s.fields.name}
            value={name}
            error={errors.name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="lost-reasons">{s.fields.lostReasons}</Label>
            <textarea
              id="lost-reasons"
              rows={4}
              className="rounded-md border bg-transparent px-3 py-2 text-sm"
              value={reasons}
              aria-invalid={errors.lostReasons ? true : undefined}
              onChange={(event) => setReasons(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {errors.lostReasons ?? s.fields.lostReasonsHint}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pipeline ? s.save : s.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Add (stage = null) or edit a stage. */
function StageDialog({
  pipeline,
  stage,
  onClose,
}: {
  pipeline: Pipeline;
  stage: Stage | null;
  onClose: () => void;
}) {
  const add = useAddStage();
  const update = useUpdateStage();
  const [name, setName] = useState(stage?.name ?? '');
  const [category, setCategory] = useState<StageCategory>(stage?.category ?? 'open');
  const [probability, setProbability] = useState(
    String(stage?.probability ?? DEFAULT_STAGE_PROBABILITY.open),
  );
  const [probabilityTouched, setProbabilityTouched] = useState(stage !== null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const effectiveProbability = probabilityTouched
    ? probability
    : String(DEFAULT_STAGE_PROBABILITY[category]);

  const submit = async () => {
    setErrors({});
    setFormError(null);
    const n = Number(effectiveProbability);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      setErrors({ probability: '0–100' });
      return;
    }
    try {
      if (stage) {
        await update.mutateAsync({
          pipelineId: pipeline.id,
          stageId: stage.id,
          name: name.trim(),
          probability: n,
          ...(category !== stage.category ? { category } : {}),
        });
      } else {
        await add.mutateAsync({
          pipelineId: pipeline.id,
          name: name.trim(),
          category,
          probability: n,
        });
      }
      toast.success(s.saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'stage_name_taken') {
        setErrors({ name: error.message });
      } else if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      } else {
        setFormError(errorMessage(error));
      }
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {stage ? s.editStageTitle(stage.name) : s.addStageTitle(pipeline.name)}
          </DialogTitle>
          <DialogDescription>{pipeline.name}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FormError message={formError} />
          <TextField
            label={s.fields.stageName}
            value={name}
            error={errors.name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="stage-category">{s.fields.category}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as StageCategory)}>
              <SelectTrigger id="stage-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {s.categories[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{s.categoryHints[category]}</p>
          </div>
          <TextField
            label={s.fields.probability}
            inputMode="numeric"
            value={effectiveProbability}
            error={errors.probability}
            onChange={(event) => {
              setProbabilityTouched(true);
              setProbability(event.target.value);
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {common.cancel}
            </Button>
            <Button type="submit" disabled={add.isPending || update.isPending}>
              {stage ? s.save : s.addStage}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeletePipelineDialog({ pipeline, onClose }: { pipeline: Pipeline; onClose: () => void }) {
  const remove = useDeletePipeline();
  const [formError, setFormError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.deletePipelineTitle(pipeline.name)}</DialogTitle>
          <DialogDescription>{s.deletePipelineBody}</DialogDescription>
        </DialogHeader>
        <FormError message={formError} />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{common.cancel}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              void remove
                .mutateAsync(pipeline.id)
                .then(() => {
                  toast.success(s.deleted(pipeline.name));
                  onClose();
                })
                .catch((error: unknown) => setFormError(errorMessage(error)))
            }
          >
            {s.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * AC flow: first try a plain delete; if the stage has leads the API answers 409
 * `stage_has_leads` and the dialog asks where to move them (same pipeline and category).
 */
function DeleteStageDialog({
  pipeline,
  stage,
  onClose,
}: {
  pipeline: Pipeline;
  stage: Stage;
  onClose: () => void;
}) {
  const remove = useDeleteStage();
  const [blocked, setBlocked] = useState<{ leadCount: number; targets: Stage[] } | null>(null);
  const [moveTo, setMoveTo] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setFormError(null);
    try {
      await remove.mutateAsync({
        pipelineId: pipeline.id,
        stageId: stage.id,
        ...(moveTo ? { moveTo } : {}),
      });
      toast.success(s.stageDeleted(stage.name, blocked ? blocked.leadCount : 0));
      onClose();
    } catch (error) {
      const info =
        error instanceof ApiError && error.code === 'stage_has_leads'
          ? stageHasLeadsSchema.safeParse(error.problem)
          : null;
      if (info?.success) {
        const targets = pipeline.stages.filter((st) => info.data.targetStageIds.includes(st.id));
        setBlocked({ leadCount: info.data.leadCount, targets });
        setMoveTo(targets[0]?.id ?? '');
      } else {
        setFormError(errorMessage(error));
      }
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.deleteStageTitle(stage.name)}</DialogTitle>
          <DialogDescription>
            {blocked ? s.stageHasLeads(blocked.leadCount) : s.deleteStageBody}
          </DialogDescription>
        </DialogHeader>
        <FormError message={formError} />
        {blocked && blocked.targets.length === 0 ? (
          <p role="alert" className="text-sm text-destructive">
            {s.noTarget(s.categories[stage.category])}
          </p>
        ) : null}
        {blocked && blocked.targets.length > 0 ? (
          <div className="grid gap-1.5">
            <Label htmlFor="move-to">{s.moveTo}</Label>
            <Select value={moveTo} onValueChange={setMoveTo}>
              <SelectTrigger id="move-to" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {blocked.targets.map((target) => (
                  <SelectItem key={target.id} value={target.id}>
                    {target.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{common.cancel}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending || (blocked !== null && !moveTo)}
            onClick={() => void submit()}
          >
            {blocked ? s.moveAndDelete : s.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
