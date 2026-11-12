import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` diffs src/schema against migrations/ — it needs no database connection.
// Migrations are applied by `pnpm db:migrate` (src/bin/migrate.ts) as the owner role.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
