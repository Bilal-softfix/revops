import { z } from 'zod';

/** Server-only settings of the web app (never exposed to the browser: no NEXT_PUBLIC_ prefix). */
const webEnvSchema = z.object({
  /** Where the Next server reaches the API (the browser never calls it directly). */
  API_INTERNAL_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:4000'),
});

export function webEnv(): z.infer<typeof webEnvSchema> {
  return webEnvSchema.parse({ API_INTERNAL_URL: process.env.API_INTERNAL_URL || undefined });
}
