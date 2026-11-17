'use client';

import type { CustomFieldDef } from '@revops/shared';
import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CustomFieldFormValues, CustomFieldInputValue } from '@/lib/custom-fields';

const NONE = '__none__';

/**
 * Renders inputs for a tenant's custom fields (M1-T2), driven entirely by the definitions — no
 * field is known to the code. Controlled: `values` + `onChange`; `errors` by field key.
 */
export function CustomFieldInputs({
  defs,
  values,
  errors,
  onChange,
}: {
  defs: readonly CustomFieldDef[];
  values: CustomFieldFormValues;
  errors: Record<string, string>;
  onChange: (key: string, value: CustomFieldInputValue) => void;
}) {
  if (defs.length === 0) return null;
  return (
    <fieldset className="grid gap-4">
      {defs.map((def) => (
        <CustomFieldInput
          key={def.key}
          def={def}
          value={values[def.key]}
          error={errors[def.key]}
          onChange={(value) => onChange(def.key, value)}
        />
      ))}
    </fieldset>
  );
}

function CustomFieldInput({
  def,
  value,
  error,
  onChange,
}: {
  def: CustomFieldDef;
  value: CustomFieldInputValue | undefined;
  error: string | undefined;
  onChange: (value: CustomFieldInputValue) => void;
}) {
  const id = useId();
  const label = `${def.label}${def.required ? ' *' : ''}`;
  const errorId = `${id}-error`;
  const described = error ? errorId : undefined;
  const text = typeof value === 'string' ? value : '';

  let control: React.ReactNode;
  switch (def.type) {
    case 'bool':
      control = (
        <label className="flex items-center gap-2 text-sm">
          <input
            id={id}
            type="checkbox"
            className="size-4 accent-primary"
            checked={value === true}
            aria-describedby={described}
            onChange={(event) => onChange(event.target.checked)}
          />
          {label}
        </label>
      );
      return (
        <div className="grid gap-1">
          {control}
          {error ? <FieldError id={errorId} message={error} /> : null}
        </div>
      );
    case 'select':
      control = (
        <Select value={text || NONE} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
          <SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>—</SelectItem>
            {(def.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case 'multiselect': {
      const selected = Array.isArray(value) ? value : [];
      control = (
        <div id={id} role="group" aria-describedby={described} className="flex flex-wrap gap-3">
          {(def.options ?? []).map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selected.includes(option.value)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((v) => v !== option.value),
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      );
      break;
    }
    default:
      control = (
        <Input
          id={id}
          type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
          inputMode={def.type === 'number' ? 'decimal' : undefined}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control}
      {error ? <FieldError id={errorId} message={error} /> : null}
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} className="text-xs text-destructive">
      {message}
    </p>
  );
}
