import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { common } from '@/lib/strings/common';

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">{common.notFoundTitle}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{common.notFoundBody}</p>
      <Button asChild variant="outline">
        <Link href="/dashboard">{common.goHome}</Link>
      </Button>
    </main>
  );
}
