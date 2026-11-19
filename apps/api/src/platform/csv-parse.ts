/**
 * RFC 4180 CSV reader for imports (M2-T5), no dependency. Accepts `,` or `;` (detected from the
 * header line), CRLF / LF / CR line ends, quoted fields with `""` escapes and embedded newlines,
 * and a leading UTF-8 BOM. Blank lines are skipped. Lenient on stray quotes inside unquoted
 * fields (kept literally), which is what spreadsheet exports produce in practice.
 */
export interface CsvParseOptions {
  delimiter?: ',' | ';';
}

export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
  }
}

/** `,` unless the header line has more `;` than `,` outside quotes (Excel in many locales). */
export function detectDelimiter(text: string): ',' | ';' {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch === ',') commas += 1;
    else if (!quoted && ch === ';') semicolons += 1;
  }
  return semicolons > commas ? ';' : ',';
}

/** Yields one string[] per record. Throws CsvParseError on an unterminated quoted field. */
export function* parseCsv(input: string, options: CsvParseOptions = {}): Generator<string[]> {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = options.delimiter ?? detectDelimiter(text);
  let field = '';
  let record: string[] = [];
  let quoted = false;
  let fieldStarted = false;
  /** Anything read since the last record end: a lone `""` is a record, an empty line is not. */
  let touched = false;
  let line = 1;
  let quoteLine = 1;
  const endRecord = function* () {
    record.push(field);
    field = '';
    fieldStarted = false;
    if (touched) yield record;
    touched = false;
    record = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }
    if (ch !== '\r' && ch !== '\n') touched = true;
    if (ch === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
      quoteLine = line;
    } else if (ch === delimiter) {
      record.push(field);
      field = '';
      fieldStarted = false;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      line += 1;
      yield* endRecord();
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (quoted) throw new CsvParseError('unterminated quoted field', quoteLine);
  if (touched) yield* endRecord();
}
