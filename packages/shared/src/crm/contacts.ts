import { z } from 'zod';
import { emailSchema, nameSchema } from '../auth/schemas.js';
import { phoneSchema } from './phone.js';

// Contacts API contracts (/v1/contacts). Phones are stored and deduplicated as E.164.

const consentEntrySchema = z.object({
  granted: z.boolean(),
  at: z.iso.datetime(),
  /** Where it was given: "walk-in form", "web form", "call recording notice"… */
  source: z.string().trim().min(1).max(100),
});
/** Per-channel consent with timestamp + source (docs/03-india-compliance.md). */
export const consentSchema = z
  .object({
    whatsapp: consentEntrySchema,
    sms: consentEntrySchema,
    call: consentEntrySchema,
    recording: consentEntrySchema,
  })
  .partial();
export type Consent = z.infer<typeof consentSchema>;

const citySchema = z.string().trim().min(1).max(100);

const contactFields = {
  name: nameSchema,
  phone: phoneSchema,
  altPhones: z.array(phoneSchema).max(5),
  email: emailSchema,
  city: citySchema,
  consent: consentSchema,
};

export const createContactRequestSchema = z.object({
  name: contactFields.name,
  phone: contactFields.phone,
  altPhones: contactFields.altPhones.optional(),
  email: contactFields.email.optional(),
  city: contactFields.city.optional(),
  consent: contactFields.consent.optional(),
});
export type CreateContactRequest = z.infer<typeof createContactRequestSchema>;

/** PATCH: any subset; email/city/phone-less fields can be cleared with null. */
export const updateContactRequestSchema = z
  .object({
    name: contactFields.name,
    phone: contactFields.phone,
    altPhones: contactFields.altPhones,
    email: contactFields.email.nullable(),
    city: contactFields.city.nullable(),
    consent: contactFields.consent,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'nothing to update' });
export type UpdateContactRequest = z.infer<typeof updateContactRequestSchema>;

export const contactSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phoneE164: z.string().nullable(),
  altPhones: z.array(z.string()),
  email: z.string().nullable(),
  city: z.string().nullable(),
  consent: consentSchema,
  customFields: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Contact = z.infer<typeof contactSchema>;

export const contactPageSchema = z.object({
  items: z.array(contactSchema),
  nextCursor: z.string().nullable(),
});
export type ContactPage = z.infer<typeof contactPageSchema>;

export const contactQuerySchema = z.object({
  /** Name, phone (any format; matched on digits) or email fragment. */
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
});
export type ContactQuery = z.infer<typeof contactQuerySchema>;

/**
 * 409 `contact_exists` extension. `contact` is present only when the caller may see the existing
 * contact; otherwise the caller learns just that it exists and who is working it.
 */
export const contactConflictSchema = z.object({
  field: z.enum(['phone', 'email']),
  ownerName: z.string().nullable(),
  contact: z.object({ id: z.uuid(), name: z.string() }).optional(),
});
export type ContactConflict = z.infer<typeof contactConflictSchema>;

export const CRM_ERROR_CODES = ['contact_exists', 'not_found', 'forbidden'] as const;
