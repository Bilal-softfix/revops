// CSV writing (M1-T6): RFC 4180 quoting plus spreadsheet formula-injection escaping (OWASP
// "CSV Injection"). Pure functions — no I/O — so every export goes through the same rules.

/** Characters that make Excel / Sheets / LibreOffice treat a cell as a formula. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** UTF-8 byte-order mark: Excel needs it to read UTF-8 (Devanagari names, ₹) correctly. */
export const CSV_BOM = String.fromCharCode(0xfeff);
export const CSV_LINE_END = '\r\n';

export type CsvCell = string | number | bigint | boolean | null | undefined;

/**
 * One cell. A value whose first character is a formula trigger, or whose first non-space
 * character is `=` (some apps trim leading spaces), gets a leading `'` so it stays text. Then
 * RFC 4180: quoted when it holds `,` `"` CR or LF, with `"` doubled.
 */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  const first = text.charAt(0);
  if (FORMULA_TRIGGERS.has(first) || /^\s+[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: readonly CsvCell[]): string {
  return cells.map(csvCell).join(',') + CSV_LINE_END;
}

/** A whole document: BOM, then one CRLF-terminated line per row. */
export function csvDocument(rows: Iterable<readonly CsvCell[]>): string {
  let out = CSV_BOM;
  for (const row of rows) out += csvRow(row);
  return out;
}
