'use client';

import type {
  CustomFieldDef,
  CustomFieldFilterValue,
  LeadFilters,
  LeadSource,
  Member,
  Pipeline,
} from '@revops/shared';
import { useState } from 'react';
import { SimpleSelect } from '@/components/form/simple-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cleanFilters, dayEnd, dayOf, dayStart } from '@/lib/lead-filters';
import { leadStrings as s } from '@/lib/strings/leads';

/** Text input that reports its value on blur / Enter (no request per keystroke). */
function CommitInput({
  label,
  value,
  onCommit,
  type = 'text',
  className,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  type?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <div className={className ?? 'grid gap-1.5'}>
      <Label>
        <span className="text-sm">{label}</span>
        <Input
          type={type}
          value={draft ?? value}
          onChange={(event) => {
            if (type === 'date') onCommit(event.target.value);
            else setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
      </Label>
    </div>
  );
}

/**
 * The filter bar: pipeline, stage, status, owner, source, created range, search, and filters on
 * the custom fields of the chosen pipeline (all lead fields when no pipeline is chosen).
 */
export function LeadFiltersBar({
  filters,
  onChange,
  pipelines,
  sources,
  members,
  defs,
  canSeeAll,
  showStage,
}: {
  filters: LeadFilters;
  onChange: (filters: LeadFilters) => void;
  pipelines: readonly Pipeline[];
  sources: readonly LeadSource[];
  members: readonly Member[];
  defs: readonly CustomFieldDef[];
  canSeeAll: boolean;
  showStage: boolean;
}) {
  const set = (patch: Partial<LeadFilters>) => onChange(cleanFilters({ ...filters, ...patch }));
  const setField = (key: string, value: CustomFieldFilterValue | undefined) =>
    set({ customFields: { ...filters.customFields, [key]: value } as LeadFilters['customFields'] });
  const pipeline = pipelines.find((p) => p.id === filters.pipelineId);
  const cf = filters.customFields ?? {};
  const fieldFilterCount = Object.keys(cf).length;

  return (
    <div className="grid gap-3 rounded-md border p-3" role="search" aria-label={s.filters.title}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CommitInput
          label={s.filters.search}
          value={filters.q ?? ''}
          onCommit={(q) => set({ q: q.trim() || undefined })}
        />
        <SimpleSelect
          label={s.filters.pipeline}
          value={filters.pipelineId ?? ''}
          noneLabel={showStage ? s.filters.any : undefined}
          options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) =>
            set({ pipelineId: id || undefined, stageIds: undefined, customFields: undefined })
          }
        />
        {showStage && pipeline ? (
          <SimpleSelect
            label={s.filters.stage}
            value={filters.stageIds?.[0] ?? ''}
            noneLabel={s.filters.anyStage}
            options={pipeline.stages.map((x) => ({ value: x.id, label: x.name }))}
            onChange={(id) => set({ stageIds: id ? [id] : undefined })}
          />
        ) : null}
        <SimpleSelect
          label={s.filters.status}
          value={filters.status ?? ''}
          noneLabel={s.filters.anyStatus}
          options={(['open', 'won', 'lost'] as const).map((x) => ({
            value: x,
            label: s.status[x],
          }))}
          onChange={(v) => set({ status: (v || undefined) as LeadFilters['status'] })}
        />
        {canSeeAll ? (
          <SimpleSelect
            label={s.filters.owner}
            value={filters.owner ?? ''}
            noneLabel={s.filters.anyOwner}
            options={[
              { value: 'me', label: s.filters.me },
              { value: 'unassigned', label: s.unassigned },
              ...members.map((m) => ({ value: m.userId, label: m.name })),
            ]}
            onChange={(v) => set({ owner: v || undefined })}
          />
        ) : null}
        <SimpleSelect
          label={s.filters.source}
          value={filters.sourceId ?? ''}
          noneLabel={s.filters.anySource}
          options={sources.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(v) => set({ sourceId: v || undefined })}
        />
        <CommitInput
          type="date"
          label={s.filters.from}
          value={dayOf(filters.createdFrom, 'from')}
          onCommit={(d) => set({ createdFrom: d ? dayStart(d) : undefined })}
        />
        <CommitInput
          type="date"
          label={s.filters.to}
          value={dayOf(filters.createdTo, 'to')}
          onCommit={(d) => set({ createdTo: d ? dayEnd(d) : undefined })}
        />
      </div>
      {defs.length > 0 ? (
        <details open={fieldFilterCount > 0}>
          <summary className="cursor-pointer text-sm font-medium">
            {s.filters.more}
            {fieldFilterCount > 0 ? ` (${fieldFilterCount})` : ''}
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {defs.map((def) => (
              <FieldFilter
                key={def.key}
                def={def}
                value={cf[def.key]}
                onChange={(v) => setField(def.key, v)}
              />
            ))}
          </div>
        </details>
      ) : null}
      <div>
        <Button variant="ghost" size="sm" onClick={() => onChange({})}>
          {s.filters.clear}
        </Button>
      </div>
    </div>
  );
}

function FieldFilter({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDef;
  value: CustomFieldFilterValue | undefined;
  onChange: (value: CustomFieldFilterValue | undefined) => void;
}) {
  if (def.type === 'select' || def.type === 'multiselect') {
    const current = Array.isArray(value)
      ? (value[0] ?? '')
      : typeof value === 'string'
        ? value
        : '';
    return (
      <SimpleSelect
        label={def.label}
        value={current}
        noneLabel={s.filters.any}
        options={def.options ?? []}
        onChange={(v) => onChange(v ? [v] : undefined)}
      />
    );
  }
  if (def.type === 'bool') {
    return (
      <SimpleSelect
        label={def.label}
        value={value === true ? 'yes' : value === false ? 'no' : ''}
        noneLabel={s.filters.any}
        options={[
          { value: 'yes', label: s.filters.yes },
          { value: 'no', label: s.filters.no },
        ]}
        onChange={(v) => onChange(v === '' ? undefined : v === 'yes')}
      />
    );
  }
  if (def.type === 'text') {
    return (
      <CommitInput
        label={def.label}
        value={typeof value === 'string' ? value : ''}
        onCommit={(v) => onChange(v.trim() || undefined)}
      />
    );
  }
  // number / date: a min–max range.
  const range = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const parse = (v: string) =>
    def.type === 'number' ? (v === '' ? undefined : Number(v)) : v || undefined;
  const update = (bound: 'min' | 'max', v: string) => {
    const next = { ...range, [bound]: parse(v) };
    if (next.min === undefined) delete next.min;
    if (next.max === undefined) delete next.max;
    if (
      def.type === 'number' &&
      [next.min, next.max].some((n) => n !== undefined && Number.isNaN(n))
    ) {
      return;
    }
    onChange(next.min === undefined && next.max === undefined ? undefined : next);
  };
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="mb-1 text-sm">{def.label}</legend>
      <CommitInput
        type={def.type === 'date' ? 'date' : 'text'}
        label={s.filters.min}
        value={range.min === undefined ? '' : String(range.min)}
        onCommit={(v) => update('min', v)}
      />
      <CommitInput
        type={def.type === 'date' ? 'date' : 'text'}
        label={s.filters.max}
        value={range.max === undefined ? '' : String(range.max)}
        onCommit={(v) => update('max', v)}
      />
    </fieldset>
  );
}
