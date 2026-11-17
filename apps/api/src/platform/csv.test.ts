import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, csvDocument, csvRow } from './csv';

describe('csvCell', () => {
  it.each(['=', '+', '-', '@'])('escapes a cell starting with %s', (c) => {
    expect(csvCell(`${c}SUM(A1:A9)`)).toBe(`'${c}SUM(A1:A9)`);
  });

  it('escapes a leading TAB and a leading CR (CR also forces quoting)', () => {
    expect(csvCell('\t=1+1')).toBe("'\t=1+1");
    expect(csvCell('\r=1+1')).toBe('"\'\r=1+1"');
  });

  it('escapes leading whitespace before a formula', () => {
    expect(csvCell('  =HYPERLINK("http://x")')).toBe('"\'  =HYPERLINK(""http://x"")"');
    expect(csvCell(' @cmd')).toBe("' @cmd");
  });

  it('escapes E.164 phone numbers (accepted: they start with +)', () => {
    expect(csvCell('+919876543210')).toBe("'+919876543210");
  });

  it('leaves ordinary text, numbers and inner trigger characters alone', () => {
    expect(csvCell('Asha Realty')).toBe('Asha Realty');
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('1234.56')).toBe('1234.56');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(10n)).toBe('10');
  });

  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
    expect(csvCell('line 1\r\nline 2')).toBe('"line 1\r\nline 2"');
  });

  it('escapes and quotes together', () => {
    expect(csvCell('=cmd|" /C calc"!A0')).toBe('"\'=cmd|"" /C calc""!A0"');
  });

  it('passes Unicode / Devanagari through untouched', () => {
    expect(csvCell('आशा शर्मा')).toBe('आशा शर्मा');
    expect(csvCell('₹ 1,200')).toBe('"₹ 1,200"');
  });

  it('writes empty, null and undefined as an empty cell', () => {
    expect(csvCell('')).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('csvRow / csvDocument', () => {
  it('joins with commas and ends rows with CRLF', () => {
    expect(csvRow(['a', null, '=x'])).toBe("a,,'=x\r\n");
  });

  it('starts with a UTF-8 BOM; header-only documents work', () => {
    expect(csvDocument([['Name', 'Phone']])).toBe(`${CSV_BOM}Name,Phone\r\n`);
    expect(csvDocument([])).toBe(CSV_BOM);
  });
});
