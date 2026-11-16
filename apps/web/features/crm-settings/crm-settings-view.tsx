'use client';

import { AGENT_CONTACT_VISIBILITY, type AgentContactVisibility } from '@revops/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/form/text-field';
import { ErrorState, LoadingState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/messages';
import { crmSettingsStrings as s } from '@/lib/strings/crm-settings';
import { useCrmSettings, useUpdateCrmSettings } from './queries';

/** Settings → CRM settings (owners/admins): agent contact visibility (M1-T1 setting, UI in T3b). */
export function CrmSettingsView() {
  const settings = useCrmSettings();
  const update = useUpdateCrmSettings();
  // The unsaved choice; null = show what is stored.
  const [draft, setDraft] = useState<AgentContactVisibility | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const stored = settings.data?.agentContactVisibility;
  const visibility = draft ?? stored ?? null;

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="text-sm text-muted-foreground">{s.description}</p>
      </div>
      {settings.isPending ? (
        <LoadingState rows={2} />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <form
          noValidate
          className="grid gap-4 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!visibility) return;
            setFormError(null);
            update
              .mutateAsync({ agentContactVisibility: visibility })
              .then(() => {
                setDraft(null);
                toast.success(s.saved);
              })
              .catch((error: unknown) => setFormError(errorMessage(error)));
          }}
        >
          <FormError message={formError} />
          <fieldset className="grid gap-3">
            <legend className="mb-1 font-medium">{s.visibility.legend}</legend>
            <p className="text-sm text-muted-foreground">{s.visibility.hint}</p>
            {AGENT_CONTACT_VISIBILITY.map((option) => (
              <label key={option} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <input
                  type="radio"
                  name="agentContactVisibility"
                  value={option}
                  className="mt-0.5 size-4 accent-primary"
                  checked={visibility === option}
                  onChange={() => setDraft(option)}
                />
                <span className="grid gap-0.5">
                  <span className="font-medium">{s.visibility[option]}</span>
                  <span className="text-muted-foreground">{s.visibility[`${option}Hint`]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div>
            <Button type="submit" disabled={update.isPending || visibility === stored}>
              {s.save}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
