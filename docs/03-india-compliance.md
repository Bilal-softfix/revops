# 03 — India Compliance Notes (engineering view, NOT legal advice)

Get a lawyer to validate before the first pilot. These notes define what the product must make *possible*.

## DPDP Act 2023 (+ Rules)
- We are a **data processor** for tenants (data fiduciaries) regarding their leads' data; a fiduciary for our own users' data.
- Build: consent records per contact with purpose + timestamp + source; data export per contact; deletion/erasure per contact (cascade to transcripts, recordings, messages); per-tenant retention settings (recordings, transcripts) with a scheduled purge job; breach-ready audit logs; data processing agreement template for customers.
- Store data in India (ap-south-1). Document sub-processors (telephony, STT/TTS/LLM vendors) and where they process data — prefer vendors with India region or clear terms.

## Telecom (TRAI)
- Inbound calls on tenant numbers: fine. **Outbound promotional calls/SMS** fall under TRAI commercial communication rules (DLT registration, consent, designated number series). MVP: outbound only as callbacks to leads who enquired; keep a per-contact DND/opt-out flag and respect it. Do not build bulk outbound dialer in MVP.
- SMS requires DLT entity, header and template registration; template IDs stored in `message_templates`.

## Call recording
- Play a recording/AI disclosure announcement at call start ("This call may be recorded and handled by an AI assistant"). Configurable text per tenant, cannot be disabled when recording is on.
- AI agent must not claim to be human if asked.

## WhatsApp
- Business-initiated messages only via approved templates and only to opted-in contacts; 24-hour customer service window for free-form replies. Store opt-in evidence in `contacts.consent`.

## Payments/billing (post-MVP)
- INR pricing, GST invoices (GSTIN capture), payment gateway (e.g. Razorpay) — later milestone.
