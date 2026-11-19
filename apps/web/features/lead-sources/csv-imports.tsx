'use client';

import {
  type CsvColumnMapping,
  type CsvImport,
  type CsvImportPreview,
  type LeadSource,
  MAPPING_BUILTINS,
} from '@revops/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { SimpleSelect } from '@/components/form/simple-select';
import { FormError } from '@/components/form/text-field';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCustomFields } from '@/features/custom-fields/queries';
import { errorMessage } from '@/lib/api/messages';
import { common } from '@/lib/strings/common';
import { leadSourceStrings } from '@/lib/strings/lead-sources';
import { useCsvImports, useStartCsvImport, useUploadCsv } from './queries';

const s = leadSourceStrings.imports;
const IGNORE = '__ignore__';

/** Whether the mapping can be started: phone or email mapped (the API checks the rest). */
export function mappingReady(mapping: CsvColumnMapping): boolean {
  return mapping.includes('phone') || mapping.includes('email');
}

function ImportRow({ item }: { item: CsvImport }) {
  const running = item.status === 'queued' || item.status === 'processing';
  return (
    <li className="grid gap-1 text-sm" data-testid="csv-import">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium break-all">{item.fileName}</span>
        <Badge variant={item.status === 'failed' ? 'outline' : 'secondary'}>
          {s.status[item.status]}
        </Badge>
        {running || item.status === 'completed' ? (
          <span className="text-xs text-muted-foreground">
            {s.progress(item.processedRows, item.totalRows)}
          </span>
        ) : null}
      </div>
      {running ? (
        <progress
          className="h-1.5 w-full max-w-sm"
          max={item.totalRows}
          value={item.processedRows}
          aria-label={s.progress(item.processedRows, item.totalRows)}
        />
      ) : null}
      {item.status === 'completed' || running ? (
        <p className="text-xs text-muted-foreground">
          {s.summary({
            created: item.createdCount,
            reenquiry: item.reenquiryCount,
            duplicate: item.duplicateCount,
            failed: item.failedCount,
          })}
        </p>
      ) : null}
      {item.status === 'failed' && item.error ? (
        <p className="text-xs text-destructive">{s.failedReasons[item.error] ?? item.error}</p>
      ) : null}
      {item.failedCount > 0 && !running ? (
        <a className="text-xs underline" href={`/api/v1/imports/${item.id}/errors.csv`} download>
          {s.errorReport}
        </a>
      ) : null}
    </li>
  );
}

/** CSV sources (M2-T5): import button + recent imports with live progress. */
export function CsvImports({ source }: { source: LeadSource }) {
  const imports = useCsvImports(source.id);
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-2">
      <div>
        <Button size="sm" onClick={() => setOpen(true)} disabled={!source.isActive}>
          {s.open}
        </Button>
      </div>
      <p className="text-sm font-medium">{s.recent}</p>
      {imports.isPending ? (
        <LoadingState rows={1} />
      ) : imports.isError ? (
        <ErrorState error={imports.error} onRetry={() => void imports.refetch()} />
      ) : imports.data.items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{s.none}</p>
      ) : (
        <ul className="grid gap-3">
          {imports.data.items.map((item) => (
            <ImportRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      <ImportDialog source={source} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function ImportDialog({
  source,
  open,
  onClose,
}: {
  source: LeadSource;
  open: boolean;
  onClose: () => void;
}) {
  const upload = useUploadCsv(source.id);
  const start = useStartCsvImport(source.id);
  const leadFields = useCustomFields('lead').data?.items ?? [];
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping>([]);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setMapping([]);
    setError(null);
    onClose();
  };
  const options = [
    { value: IGNORE, label: s.ignore },
    ...MAPPING_BUILTINS.map((b) => ({ value: b, label: s.targets[b] })),
    ...leadFields.map((f) => ({ value: `lead.${f.key}`, label: s.leadField(f.label) })),
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : reset())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{s.title(source.name)}</DialogTitle>
          <DialogDescription>{s.description}</DialogDescription>
        </DialogHeader>

        {!preview ? (
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!file) return;
              setError(null);
              upload
                .mutateAsync(file)
                .then((result) => {
                  setPreview(result);
                  setMapping(result.suggestedMapping);
                })
                .catch((e: unknown) => setError(errorMessage(e)));
            }}
          >
            <div className="grid gap-1">
              <Label htmlFor="csv-file">{s.file}</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <FormError message={error} />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {common.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!file || upload.isPending}>
                {upload.isPending ? s.uploading : s.upload}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-3">
            <div>
              <p className="font-medium">{s.mappingTitle}</p>
              <p className="text-xs text-muted-foreground">{s.mappingHint}</p>
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    {preview.import.headers.map((header, i) => (
                      <th key={i} className="min-w-40 border-b p-2 text-left align-top">
                        <SimpleSelect
                          label={header || `#${i + 1}`}
                          value={mapping[i] ?? IGNORE}
                          options={options}
                          onChange={(v) =>
                            setMapping((m) =>
                              m.map((t, j) =>
                                j === i
                                  ? v === IGNORE
                                    ? null
                                    : (v as CsvColumnMapping[number])
                                  : t,
                              ),
                            )
                          }
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((row, r) => (
                    <tr key={r} className="border-b last:border-0">
                      {preview.import.headers.map((_, c) => (
                        <td key={c} className="max-w-48 truncate p-2">
                          {row[c] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!mappingReady(mapping) ? (
              <p className="text-xs text-destructive">{s.needContact}</p>
            ) : null}
            <FormError message={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                {common.cancel}
              </Button>
              <Button
                disabled={!mappingReady(mapping) || start.isPending}
                onClick={() => {
                  setError(null);
                  start
                    .mutateAsync({ id: preview.import.id, mapping })
                    .then(() => {
                      toast.success(s.started);
                      reset();
                    })
                    .catch((e: unknown) => setError(errorMessage(e)));
                }}
              >
                {s.start(preview.import.totalRows)}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
