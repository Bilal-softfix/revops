import { describe, expect, it } from 'vitest';
import { embedSnippet, parseMapping, webhookUrl } from './form-settings';

describe('parseMapping', () => {
  it('reads "field = target" lines, ignoring blanks and spaces', () => {
    expect(
      parseMapping('your_name = name\n\n  whatsapp=phone \ndevice = lead.device_model'),
    ).toEqual({
      mapping: { your_name: 'name', whatsapp: 'phone', device: 'lead.device_model' },
      bad: [],
    });
  });

  it('reports lines it cannot read (1-based)', () => {
    expect(parseMapping('ok = name\nno equals\n= phone\na = b = c').bad).toEqual([2, 3, 4]);
  });
});

describe('embedSnippet', () => {
  it('loads the script through the app proxy with the public key', () => {
    const snippet = embedSnippet('https://app.revops.in', 'KEY123');
    expect(snippet).toContain(
      '<script src="https://app.revops.in/api/v1/public/embed.js" data-revops-key="KEY123" async></script>',
    );
    expect(snippet).toContain('<form data-revops-form>');
  });
});

describe('webhookUrl', () => {
  it('points at the public webhook route through the app proxy', () => {
    expect(webhookUrl('https://app.revops.in', 'K')).toBe(
      'https://app.revops.in/api/v1/public/webhooks/K',
    );
  });
});
