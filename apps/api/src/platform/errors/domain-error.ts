/**
 * Typed domain error → RFC 7807 problem+json (see problem-details.filter.ts). `code` is the stable,
 * machine-readable member clients switch on; `title` is a short human summary.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly title: string,
    readonly options: {
      detail?: string;
      /** Extra problem members, e.g. `errors` for validation. Never put input values here. */
      extensions?: Record<string, unknown>;
      headers?: Record<string, string>;
    } = {},
  ) {
    super(title);
    this.name = 'DomainError';
  }
}
