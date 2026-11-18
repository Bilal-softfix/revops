'use client';

import type { LeadSource } from '@revops/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/form/text-field';
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
import { errorMessage } from '@/lib/api/messages';
import { common } from '@/lib/strings/common';
import { leadSourceStrings } from '@/lib/strings/lead-sources';
import { embedSnippet, parseMapping } from './form-settings';
import { useUpdateLeadSource } from './queries';

const s = leadSourceStrings.form;
const textareaClass =
  'min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Web form capture settings (M2-T2): allowed websites, captcha, field mapping, embed code. */
export function FormSettingsDialog({
  source,
  onClose,
}: {
  source: LeadSource | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={source !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        {source ? <FormSettingsBody key={source.id} source={source} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function FormSettingsBody({ source, onClose }: { source: LeadSource; onClose: () => void }) {
  const update = useUpdateLeadSource();
  const [origins, setOrigins] = useState(source.config.allowedOrigins.join('\n'));
  const [captcha, setCaptcha] = useState(source.config.captcha);
  const [mappingText, setMappingText] = useState(
    Object.entries(source.config.fieldMapping)
      .map(([field, target]) => `${field} = ${target}`)
      .join('\n'),
  );
  const [error, setError] = useState<string | null>(null);
  const snippet = embedSnippet(window.location.origin, source.publicKey);

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const { mapping, bad } = parseMapping(mappingText);
        if (bad.length > 0) {
          setError(s.mappingBadLines(bad));
          return;
        }
        update
          .mutateAsync({
            id: source.id,
            config: {
              ...source.config,
              allowedOrigins: origins
                .split('\n')
                .map((o) => o.trim())
                .filter(Boolean),
              captcha,
              fieldMapping: mapping,
            },
          })
          .then(() => {
            toast.success(leadSourceStrings.saved);
            onClose();
          })
          .catch((e: unknown) => setError(errorMessage(e)));
      }}
    >
      <DialogHeader>
        <DialogTitle>{s.title(source.name)}</DialogTitle>
        <DialogDescription>{s.description}</DialogDescription>
      </DialogHeader>
      <FormError message={error} />
      <div className="grid gap-1.5">
        <Label htmlFor="form-origins">{s.origins}</Label>
        <textarea
          id="form-origins"
          className={textareaClass}
          value={origins}
          placeholder="https://www.example.com"
          onChange={(event) => setOrigins(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{s.originsHint}</p>
      </div>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-primary"
          checked={captcha}
          onChange={(event) => setCaptcha(event.target.checked)}
        />
        <span className="grid gap-0.5">
          <span className="font-medium">{s.captcha}</span>
          <span className="text-muted-foreground">{s.captchaHint}</span>
        </span>
      </label>
      <div className="grid gap-1.5">
        <Label htmlFor="form-mapping">{s.mapping}</Label>
        <textarea
          id="form-mapping"
          className={textareaClass}
          value={mappingText}
          placeholder={'your_name = name\nwhatsapp = phone\ndevice = lead.device_model'}
          onChange={(event) => setMappingText(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{s.mappingHint}</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="form-snippet">{s.snippet}</Label>
        <textarea
          id="form-snippet"
          readOnly
          className={`${textareaClass} min-h-36`}
          value={snippet}
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void navigator.clipboard
                .writeText(snippet)
                .then(() => toast.success(leadSourceStrings.copied))
                .catch(() => undefined)
            }
          >
            {s.copySnippet}
          </Button>
          <p className="text-xs text-muted-foreground">{s.snippetHint}</p>
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {common.cancel}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={update.isPending}>
          {common.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
