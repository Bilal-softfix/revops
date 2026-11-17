'use client';

import { type LeadFilters, leadFiltersToParams } from '@revops/shared';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/messages';
import { ApiError, NetworkError, toApiError } from '@/lib/api/problem';
import { useSession } from '@/lib/session';
import { leadExportStrings as s } from '@/lib/strings/lead-export';

/** `filename="…"` from a Content-Disposition header. */
function filenameOf(disposition: string | null): string {
  return /filename="([^"]+)"/.exec(disposition ?? '')?.[1] ?? s.fallbackFilename;
}

function tooLargeMessage(error: ApiError): string {
  const { limit, count } = error.problem as { limit?: unknown; count?: unknown };
  return typeof limit === 'number' && typeof count === 'number'
    ? s.tooLarge(limit, count)
    : s.tooLargeFallback;
}

/**
 * Downloads the leads matching `filters` as CSV (GET /api/v1/exports/leads.csv through the
 * same-origin proxy, session cookie). Fetch → blob so a 422 `export_too_large` becomes a toast
 * instead of a downloaded error page. Rendered only for members with `lead.export`.
 */
export function ExportLeadsButton({ filters }: { filters: LeadFilters }) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  if (!can('lead.export')) return null;

  async function download() {
    setBusy(true);
    try {
      let res: Response;
      try {
        res = await fetch(`/api/v1/exports/leads.csv?${leadFiltersToParams(filters).toString()}`, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'text/csv' },
        });
      } catch {
        throw new NetworkError();
      }
      if (!res.ok) throw await toApiError(res);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filenameOf(res.headers.get('content-disposition'));
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(s.started);
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.code === 'export_too_large'
          ? tooLargeMessage(error)
          : errorMessage(error),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" onClick={() => void download()} disabled={busy}>
      <Download aria-hidden />
      {busy ? s.exporting : s.button}
    </Button>
  );
}
