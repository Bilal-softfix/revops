'use client';

import {
  CUSTOM_FIELD_TYPES,
  type CustomFieldDef,
  type CustomFieldEntity,
  type CustomFieldType,
  createCustomFieldRequestSchema,
} from '@revops/shared';
import { Plus } from 'lucide-react';
import { usePipelines } from '@/features/pipelines/queries';
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
import { toKey } from '@/lib/slug';
import { common } from '@/lib/strings/common';
import { customFieldStrings as s } from '@/lib/strings/custom-fields';
import {
  useCreateCustomField,
  useCustomFields,
  useDeleteCustomField,
  useUpdateCustomField,
} from './queries';

const isChoice = (type: CustomFieldType) => type === 'select' || type === 'multiselect';
const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** Settings → Custom fields (owners/admins): contact and lead fields of this workspace. */
export function CustomFieldsView() {
  const [adding, setAdding] = useState<CustomFieldEntity | null>(null);
  const [editing, setEditing] = useState<CustomFieldDef | null>(null);
  const [deleting, setDeleting] = useState<CustomFieldDef | null>(null);
  const remove = useDeleteCustomField();
  return (
    <div className="mx-auto grid max-w-5xl gap-8">
      <div>
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="text-sm text-muted-foreground">{s.description}</p>
      </div>
      {(['contact', 'lead'] as const).map((entity) => (
        <FieldSection
          key={entity}
          entity={entity}
          onAdd={() => setAdding(entity)}
          onEdit={setEditing}
          onDelete={setDeleting}
        />
      ))}
      {adding ? <AddFieldDialog entity={adding} onClose={() => setAdding(null)} /> : null}
      {editing ? <EditFieldDialog def={editing} onClose={() => setEditing(null)} /> : null}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s.deleteConfirmTitle(deleting?.label ?? '')}</DialogTitle>
            <DialogDescription>{s.deleteConfirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{common.cancel}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                const target = deleting;
                setDeleting(null);
                if (!target) return;
                void remove
                  .mutateAsync(target.id)
                  .then(() => toast.success(s.deleted(target.label)))
                  .catch((error: unknown) => toast.error(errorMessage(error)));
              }}
            >
              {s.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldSection({
  entity,
  onAdd,
  onEdit,
  onDelete,
}: {
  entity: CustomFieldEntity;
  onAdd: () => void;
  onEdit: (def: CustomFieldDef) => void;
  onDelete: (def: CustomFieldDef) => void;
}) {
  const fields = useCustomFields(entity);
  return (
    <section aria-labelledby={`${entity}-fields`} className="grid gap-3">
      <div className="flex items-center justify-between">
        <h2 id={`${entity}-fields`} className="text-lg font-medium">
          {s.sections[entity]}
        </h2>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus aria-hidden />
          {s.add}
        </Button>
      </div>
      {fields.isPending ? (
        <LoadingState rows={3} />
      ) : fields.isError ? (
        <ErrorState error={fields.error} onRetry={() => void fields.refetch()} />
      ) : fields.data.items.length === 0 ? (
        <EmptyState title={s.empty} />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{s.columns.label}</TableHead>
                <TableHead>{s.columns.key}</TableHead>
                <TableHead>{s.columns.type}</TableHead>
                <TableHead>{s.columns.required}</TableHead>
                {entity === 'lead' ? <TableHead>{s.columns.pipelines}</TableHead> : null}
                <TableHead className="text-right">{s.columns.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.data.items.map((def) => (
                <TableRow key={def.id} data-testid={`field-${entity}-${def.key}`}>
                  <TableCell className="font-medium">{def.label}</TableCell>
                  <TableCell>
                    <code className="text-xs">{def.key}</code>
                  </TableCell>
                  <TableCell>
                    {s.types[def.type]}
                    {def.options ? (
                      <span className="text-muted-foreground"> · {def.options.length}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {def.required ? <Badge variant="secondary">{s.yes}</Badge> : s.no}
                  </TableCell>
                  {entity === 'lead' ? (
                    <TableCell>
                      <ScopeSummary pipelineIds={def.pipelineIds} />
                    </TableCell>
                  ) : null}
                  <TableCell className="space-x-2 text-right">
                    <Button variant="outline" size="sm" onClick={() => onEdit(def)}>
                      {s.edit}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onDelete(def)}>
                      {s.delete}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function AddFieldDialog({ entity, onClose }: { entity: CustomFieldEntity; onClose: () => void }) {
  const create = useCreateCustomField();
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<CustomFieldType>('text');
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState('');
  const [pipelineIds, setPipelineIds] = useState<string[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const effectiveKey = keyTouched ? key : toKey(label);

  const submit = async () => {
    setErrors({});
    setFormError(null);
    const parsed = createCustomFieldRequestSchema.safeParse({
      entity,
      key: effectiveKey,
      label,
      type,
      required,
      ...(entity === 'lead' ? { pipelineIds } : {}),
      ...(isChoice(type)
        ? {
            options: lines(options).map((l) => ({
              value: toKey(l, { allowLeadingDigit: true }),
              label: l,
            })),
          }
        : {}),
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? ''), i.message])),
      );
      return;
    }
    try {
      const def = await create.mutateAsync(parsed.data);
      toast.success(s.created(def.label));
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'custom_field_exists') {
        setErrors({ key: error.message });
      } else if (error instanceof ApiError && error.fieldErrors.pipelineIds) {
        setErrors({ pipelineIds: error.fieldErrors.pipelineIds });
      } else {
        setFormError(errorMessage(error));
      }
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.addTitle}</DialogTitle>
          <DialogDescription>{s.sections[entity]}</DialogDescription>
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
            label={s.fields.label}
            value={label}
            error={errors.label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <TextField
            label={s.fields.key}
            hint={s.fields.keyHint}
            value={effectiveKey}
            error={errors.key}
            onChange={(event) => {
              setKeyTouched(true);
              setKey(event.target.value);
            }}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="field-type">{s.fields.type}</Label>
            <Select value={type} onValueChange={(v) => setType(v as CustomFieldType)}>
              <SelectTrigger id="field-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {s.types[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{s.fields.typeHint}</p>
          </div>
          {isChoice(type) ? (
            <OptionsTextarea
              label={s.fields.options}
              value={options}
              error={errors.options}
              onChange={setOptions}
            />
          ) : null}
          <RequiredCheckbox checked={required} onChange={setRequired} />
          {entity === 'lead' ? (
            <ScopePicker value={pipelineIds} error={errors.pipelineIds} onChange={setPipelineIds} />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {common.cancel}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {s.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditFieldDialog({ def, onClose }: { def: CustomFieldDef; onClose: () => void }) {
  const update = useUpdateCustomField();
  const [label, setLabel] = useState(def.label);
  const [required, setRequired] = useState(def.required);
  const [optionLabels, setOptionLabels] = useState(def.options?.map((o) => o.label) ?? []);
  const [newOptions, setNewOptions] = useState('');
  const [pipelineIds, setPipelineIds] = useState<string[] | null>(def.pipelineIds);
  const [scopeError, setScopeError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setFormError(null);
    setScopeError(undefined);
    if (pipelineIds !== null && pipelineIds.length === 0) {
      setScopeError(s.scope.pickOne);
      return;
    }
    const scopeChanged = JSON.stringify(pipelineIds) !== JSON.stringify(def.pipelineIds);
    const options = def.options
      ? [
          ...def.options.map((o, i) => ({ value: o.value, label: optionLabels[i] ?? o.label })),
          ...lines(newOptions).map((l) => ({
            value: toKey(l, { allowLeadingDigit: true }),
            label: l,
          })),
        ]
      : undefined;
    try {
      await update.mutateAsync({
        id: def.id,
        label,
        required,
        ...(options ? { options } : {}),
        ...(def.entity === 'lead' && scopeChanged ? { pipelineIds } : {}),
      });
      toast.success(s.saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.pipelineIds) {
        setScopeError(error.fieldErrors.pipelineIds);
      } else {
        setFormError(errorMessage(error));
      }
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.editTitle(def.label)}</DialogTitle>
          <DialogDescription>
            {s.fields.key}: <code>{def.key}</code> · {s.types[def.type]}
          </DialogDescription>
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
            label={s.fields.label}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          {def.options ? (
            <>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{s.fields.existingOptions}</legend>
                {def.options.map((option, i) => (
                  <TextField
                    key={option.value}
                    label={option.value}
                    value={optionLabels[i] ?? ''}
                    onChange={(event) =>
                      setOptionLabels((all) =>
                        all.map((l, j) => (j === i ? event.target.value : l)),
                      )
                    }
                  />
                ))}
              </fieldset>
              <OptionsTextarea
                label={s.fields.newOptions}
                value={newOptions}
                onChange={setNewOptions}
              />
            </>
          ) : null}
          <RequiredCheckbox checked={required} onChange={setRequired} />
          {def.entity === 'lead' ? (
            <ScopePicker value={pipelineIds} error={scopeError} onChange={setPipelineIds} />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {common.cancel}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {s.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "All pipelines" or the names of the pipelines a lead field is limited to. */
function ScopeSummary({ pipelineIds }: { pipelineIds: string[] | null }) {
  const pipelines = usePipelines();
  if (pipelineIds === null) return <span className="text-muted-foreground">{s.scope.all}</span>;
  if (pipelineIds.length === 0) return <span className="text-destructive">{s.scope.none}</span>;
  const names = pipelineIds.map(
    (id) => pipelines.data?.items.find((p) => p.id === id)?.name ?? '…',
  );
  return <span>{names.join(', ')}</span>;
}

/**
 * "Shown in": all pipelines (null, the default) or a chosen set. Forms, validation (incl.
 * required) and API responses of a lead only include fields shown in its pipeline.
 */
function ScopePicker({
  value,
  error,
  onChange,
}: {
  value: string[] | null;
  error?: string | undefined;
  onChange: (value: string[] | null) => void;
}) {
  const pipelines = usePipelines();
  const items = pipelines.data?.items ?? [];
  return (
    <fieldset className="grid gap-2" aria-describedby={error ? 'scope-error' : undefined}>
      <legend className="mb-1 text-sm font-medium">{s.scope.legend}</legend>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="field-scope"
          className="size-4 accent-primary"
          checked={value === null}
          onChange={() => onChange(null)}
        />
        {s.scope.all}
        <span className="text-xs text-muted-foreground">{s.scope.allHint}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="field-scope"
          className="size-4 accent-primary"
          checked={value !== null}
          onChange={() => onChange(value ?? [])}
        />
        {s.scope.selected}
      </label>
      {value !== null ? (
        <div className="ml-6 grid gap-1.5">
          {items.map((pipeline) => (
            <label key={pipeline.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={value.includes(pipeline.id)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? items
                          .map((p) => p.id)
                          .filter((id) => id === pipeline.id || value.includes(id))
                      : value.filter((id) => id !== pipeline.id),
                  )
                }
              />
              {pipeline.name}
            </label>
          ))}
        </div>
      ) : null}
      {error ? (
        <p id="scope-error" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function OptionsTextarea({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="field-options">{label}</Label>
      <textarea
        id="field-options"
        rows={4}
        className="rounded-md border bg-transparent px-3 py-2 text-sm"
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function RequiredCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {s.fields.required}
    </label>
  );
}
