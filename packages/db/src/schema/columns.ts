import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Case-insensitive text (extension created by `db:bootstrap`). */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const id = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
