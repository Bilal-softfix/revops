'use client';

import {
  type Lead,
  type Pipeline,
  buildCustomFieldsSchema,
  contactConflictSchema,
  createLeadRequestSchema,
  customFieldsForPipeline,
  formatPhone,
} from '@revops/shared';
import { useState } from 'react';
import { CustomFieldInputs } from '@/components/form/custom-field-inputs';
import { SimpleSelect } from '@/components/form/simple-select';
import { FormError, TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { useContacts } from '@/features/contacts/queries';
import { useCustomFields } from '@/features/custom-fields/queries';
import { useMembers } from '@/features/team/queries';
import { errorMessage } from '@/lib/api/messages';
import { ApiError } from '@/lib/api/problem';
import {
  type CustomFieldFormValues,
  customFieldsPayload,
  initialInputs,
} from '@/lib/custom-fields';
import { rupeesToPaise } from '@/lib/money';
import { useSession } from '@/lib/session';
import { common } from '@/lib/strings/common';
import { contactStrings } from '@/lib/strings/contacts';
import { leadStrings as s } from '@/lib/strings/leads';
import { useCreateLead, useLeadSources } from './queries';

/** New lead: contact (new or existing), pipeline + stage, owner, source, value, custom fields. */
export function LeadForm({
  pipelines,
  initialPipelineId,
  onCreated,
  onCancel,
}: {
  pipelines: readonly Pipeline[];
  initialPipelineId?: string | undefined;
  onCreated: (lead: Lead) => void;
  onCancel: () => void;
}) {
  const { session, can } = useSession();
  const create = useCreateLead();
  const canAssign = can('lead.assign');
  const sources = useLeadSources().data?.items.filter((x) => x.isActive) ?? [];
  const members = (useMembers().data?.pages.flatMap((p) => p.items) ?? []).filter(
    (m) => m.status === 'active',
  );
  const allDefs = useCustomFields('lead').data?.items ?? [];

  const fallback = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const [pipelineId, setPipelineId] = useState(initialPipelineId ?? fallback?.id ?? '');
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? fallback;
  const firstOpen = pipeline?.stages.find((x) => x.category === 'open')?.id ?? '';
  const [stageId, setStageId] = useState('');
  const effectiveStage = pipeline?.stages.some((x) => x.id === stageId) ? stageId : firstOpen;
  const stage = pipeline?.stages.find((x) => x.id === effectiveStage);

  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [search, setSearch] = useState('');
  const [contactId, setContactId] = useState('');
  const found = useContacts(search.trim()).data?.pages.flatMap((p) => p.items) ?? [];

  const [ownerUserId, setOwnerUserId] = useState(session.user.id);
  const [sourceId, setSourceId] = useState('');
  const [value, setValue] = useState('');
  const [lostReason, setLostReason] = useState('');
  const defs = pipeline ? customFieldsForPipeline(allDefs, pipeline.id) : [];
  const [cf, setCf] = useState<CustomFieldFormValues>({});
  const cfInputs = { ...initialInputs(defs, undefined), ...cf };

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
    const customFields = customFieldsPayload(defs, cfInputs, undefined);
    const cfCheck = buildCustomFieldsSchema(defs, 'create').safeParse(customFields);
    if (!cfCheck.success) {
      setErrors(
        Object.fromEntries(
          cfCheck.error.issues.map((i) => [`customFields.${String(i.path[0] ?? '')}`, i.message]),
        ),
      );
      return;
    }
    const body: Record<string, unknown> = {
      pipelineId: pipeline?.id,
      stageId: effectiveStage,
      ...(canAssign ? { ownerUserId: ownerUserId || null } : {}),
      ...(sourceId ? { sourceId } : {}),
      ...(valuePaise !== null ? { valuePaise } : {}),
      ...(stage?.category === 'lost' && lostReason.trim() ? { lostReason: lostReason.trim() } : {}),
      ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
      ...(mode === 'existing'
        ? contactId
          ? { contactId }
          : {}
        : {
            contact: {
              name,
              ...(phone.trim() ? { phone } : {}),
              ...(email.trim() ? { email } : {}),
            },
          }),
    };
    const parsed = createLeadRequestSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [i.path.map(String).join('.'), i.message]),
        ),
      );
      return;
    }
    try {
      onCreated(await create.mutateAsync(parsed.data));
    } catch (error) {
      const conflict =
        error instanceof ApiError && error.code === 'contact_exists'
          ? contactConflictSchema.safeParse(error.problem.conflict)
          : undefined;
      if (conflict?.success) {
        // Only for a contact the user can't see (otherwise the API links to it): who handles it.
        const field = conflict.data.field === 'phone' ? 'phone number' : 'email';
        setFormError(contactStrings.conflict.hidden(field, conflict.data.ownerName));
      } else if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      } else {
        setFormError(errorMessage(error));
      }
    }
  };

  const cfErrors = Object.fromEntries(
    Object.entries(errors)
      .filter(([k]) => k.startsWith('customFields.'))
      .map(([k, v]) => [k.slice('customFields.'.length), v]),
  );

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormError message={formError} />
      <fieldset className="grid gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">{s.form.contactMode}</legend>
        <div className="flex gap-4 text-sm">
          {(['new', 'existing'] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="radio"
                name="contact-mode"
                className="size-4 accent-primary"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {m === 'new' ? s.form.newContact : s.form.existingContact}
            </label>
          ))}
        </div>
        {mode === 'new' ? (
          <>
            <TextField
              label={s.form.contactName}
              value={name}
              error={errors['contact.name']}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label={s.form.phone}
              inputMode="tel"
              value={phone}
              error={errors['contact.phone'] ?? errors.contact}
              onChange={(e) => setPhone(e.target.value)}
            />
            <TextField
              label={s.form.email}
              type="email"
              value={email}
              error={errors['contact.email']}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{s.form.linkedHint}</p>
          </>
        ) : (
          <>
            <TextField
              label={s.form.findContact}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setContactId('');
              }}
            />
            <SimpleSelect
              label={s.form.pickContact}
              value={contactId}
              noneLabel={found.length === 0 ? s.form.noMatch : s.form.pickContact}
              options={found.map((c) => ({
                value: c.id,
                label: [c.name, formatPhone(c.phoneE164) || c.email].filter(Boolean).join(' · '),
              }))}
              error={errors.contactId ?? errors.contact}
              onChange={setContactId}
            />
          </>
        )}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <SimpleSelect
          label={s.form.pipeline}
          value={pipeline?.id ?? ''}
          options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
          error={errors.pipelineId}
          onChange={(id) => {
            setPipelineId(id);
            setStageId('');
          }}
        />
        <SimpleSelect
          label={s.form.stage}
          value={effectiveStage}
          options={(pipeline?.stages ?? []).map((x) => ({ value: x.id, label: x.name }))}
          error={errors.stageId}
          onChange={setStageId}
        />
        {canAssign ? (
          <SimpleSelect
            label={s.form.owner}
            value={ownerUserId}
            noneLabel={s.unassigned}
            options={members.map((m) => ({ value: m.userId, label: m.name }))}
            error={errors.ownerUserId}
            onChange={setOwnerUserId}
          />
        ) : null}
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
          hint={s.form.valueHint}
          value={value}
          error={errors.valuePaise}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      {stage?.category === 'lost' ? (
        <TextField
          label={s.form.lostReason}
          value={lostReason}
          error={errors.lostReason}
          onChange={(e) => setLostReason(e.target.value)}
        />
      ) : null}
      <CustomFieldInputs
        defs={defs}
        values={cfInputs}
        errors={cfErrors}
        onChange={(key, v) => setCf((current) => ({ ...current, [key]: v }))}
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {common.cancel}
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {s.form.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
