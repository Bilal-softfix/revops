import { describe, expect, it } from 'vitest';
import { csvDocument } from './csv';
import { CsvParseError, detectDelimiter, parseCsv } from './csv-parse';

const all = (text: string) => [...parseCsv(text)];

describe('parseCsv', () => {
  it('reads simple rows with LF, CRLF and CR line ends', () => {
    expect(all('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(all('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(all('a,b\r1,2\r')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quotes, escaped quotes, delimiters and newlines inside quotes', () => {
    expect(all('name,note\n"Mehta, Kabir","said ""hi""\nthen left"\n')).toEqual([
      ['name', 'note'],
      ['Mehta, Kabir', 'said "hi"\nthen left'],
    ]);
  });

  it('keeps empty fields and trailing empty fields', () => {
    expect(all('a,b,c\n1,,\n,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
      ['', '', '3'],
    ]);
    expect(all('a\n""\n')).toEqual([['a'], ['']]);
  });

  it('strips a UTF-8 BOM and skips blank lines', () => {
    expect(all('﻿name\n\nRavi\n\r\n')).toEqual([['name'], ['Ravi']]);
  });

  it('detects semicolon-separated files (Excel in many locales)', () => {
    expect(detectDelimiter('name;phone;"a,b"\n')).toBe(';');
    expect(detectDelimiter('name,phone\n')).toBe(',');
    expect(all('name;phone\nRavi;98')).toEqual([
      ['name', 'phone'],
      ['Ravi', '98'],
    ]);
  });

  it('keeps stray quotes inside unquoted fields literally', () => {
    expect(all('a\n5" screen\n')).toEqual([['a'], ['5" screen']]);
  });

  it('throws on an unterminated quoted field with its line', () => {
    expect(() => all('a\n1\n"open,\n2')).toThrow(CsvParseError);
    try {
      all('a\n1\n"open');
    } catch (error) {
      expect((error as CsvParseError).line).toBe(3);
    }
  });

  it('round-trips what csvDocument writes (incl. formula escaping)', () => {
    const rows = [
      ['name', 'note'],
      ['=SUM(A1)', 'x,"y"\nz'],
    ];
    const parsed = all(csvDocument(rows));
    expect(parsed[1]?.[1]).toBe('x,"y"\nz');
    expect(parsed[1]?.[0]).toContain('=SUM(A1)');
  });
});
