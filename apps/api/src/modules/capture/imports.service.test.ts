import { describe, expect, it } from 'vitest';
import { DomainError } from '../../platform/errors/domain-error';
import { attachment } from './imports.controller';
import { cleanFileName, decodeCsv, readCsvFile, rowKey } from './imports.service';

describe('decodeCsv', () => {
  it('reads UTF-8 (Hindi included) and falls back to Windows-1252', () => {
    expect(decodeCsv(Buffer.from('name\nराहुल', 'utf8'))).toBe('name\nराहुल');
    // "Café" as saved by older Excel: 0xE9 is not valid UTF-8 on its own.
    expect(decodeCsv(Buffer.from([0x43, 0x61, 0x66, 0xe9]))).toBe('Café');
  });
});

describe('rowKey', () => {
  it('is stable per source + cells, ignores surrounding spaces, differs across sources', () => {
    const a = rowKey('s1', ['Ravi', '98']);
    expect(rowKey('s1', [' Ravi ', '98'])).toBe(a);
    expect(rowKey('s2', ['Ravi', '98'])).not.toBe(a);
    expect(rowKey('s1', ['Ravi', '99'])).not.toBe(a);
    // The separator can't be forged by cell contents.
    expect(rowKey('s1', ['a', 'b'])).not.toBe(rowKey('s1', ['a,b']));
    expect(a).toMatch(/^csv:s1:[0-9a-f]{64}$/);
  });
});

describe('cleanFileName', () => {
  it.each([
    [undefined, 'import.csv'],
    ['', 'import.csv'],
    ['C:\\Users\\me\\leads.csv', 'leads.csv'],
    ['../../etc/passwd', 'passwd'],
    [encodeURIComponent('मार्च.csv'), 'मार्च.csv'],
    ['bad%E0%A4', 'bad%E0%A4'],
    ['a\u0000b\r\n.csv', 'ab.csv'],
    ['x'.repeat(300), 'x'.repeat(200)],
  ])('%j → %j', (raw, expected) => {
    expect(cleanFileName(raw)).toBe(expected);
  });
});

describe('readCsvFile', () => {
  const read = (text: string) => readCsvFile(Buffer.from(text, 'utf8'));
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return (error as DomainError).code;
    }
    return 'ok';
  };

  it('splits header and rows, trims header names', () => {
    expect(read(' Name , Phone \nA,1\n')).toEqual({
      headers: ['Name', 'Phone'],
      rows: [['A', '1']],
    });
  });

  it('rejects files without a header, without rows, or with too many columns', () => {
    expect(code(() => read(''))).toBe('csv_unreadable');
    expect(code(() => read(',,\n1,2,3'))).toBe('csv_unreadable');
    expect(code(() => read('phone\n'))).toBe('csv_unreadable');
    expect(code(() => read(`${Array.from({ length: 101 }, (_, i) => `c${i}`).join(',')}\n1`))).toBe(
      'csv_unreadable',
    );
    expect(code(() => read('a\n"open'))).toBe('csv_unreadable');
  });

  it('stops at 50k data rows', () => {
    const ok = ['p', ...Array.from({ length: 50_000 }, () => '1')].join('\n');
    expect(read(ok).rows).toHaveLength(50_000);
    expect(code(() => read(`${ok}\n1`))).toBe('csv_too_large');
    expect(DomainError).toBeDefined();
  });
});

describe('attachment', () => {
  it('gives an ASCII fallback and the exact UTF-8 name', () => {
    expect(attachment('मार्च "x".csv')).toBe(
      `attachment; filename="_____ _x_.csv"; filename*=UTF-8''${encodeURIComponent('मार्च "x".csv')}`,
    );
  });
});
