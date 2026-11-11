'use client';

import './globals.css';

/** Last resort when the root layout itself fails (e.g. the API is down during the session check). */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-xl font-semibold">Something went wrong.</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          RevOps couldn’t load this page. Please try again.
        </p>
        <button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={retry}>
          Try again
        </button>
      </body>
    </html>
  );
}
