import { describe, expect, it } from 'vitest';
import {
  INDUSTRY_TEMPLATES,
  INDUSTRY_TEMPLATE_KEYS,
  industryTemplate,
  industryTemplateSchema,
} from './index.js';

describe('industry templates (M1-T3a)', () => {
  it('all six exist and parse (validated at import)', () => {
    expect(INDUSTRY_TEMPLATE_KEYS).toEqual([
      'software-agency',
      'repair-shop',
      'real-estate',
      'education',
      'clinic',
      'generic',
    ]);
    for (const key of INDUSTRY_TEMPLATE_KEYS) expect(INDUSTRY_TEMPLATES[key].key).toBe(key);
  });

  it.each(INDUSTRY_TEMPLATE_KEYS)(
    '%s: exactly one default pipeline, each with open + won + lost',
    (key) => {
      const template = INDUSTRY_TEMPLATES[key];
      expect(template.pipelines.filter((p) => p.isDefault)).toHaveLength(1);
      for (const pipeline of template.pipelines) {
        const categories = new Set(pipeline.stages.map((s) => s.category));
        expect([...categories].sort()).toEqual(['lost', 'open', 'won']);
        expect(pipeline.lostReasons.length).toBeGreaterThan(0);
      }
    },
  );

  it('software-agency: project inquiries pipeline + project fields', () => {
    const t = INDUSTRY_TEMPLATES['software-agency'];
    expect(t.pipelines.map((p) => p.stages.map((s) => s.key))).toEqual([
      ['new_inquiry', 'discovery_call', 'proposal_sent', 'negotiation', 'won', 'lost'],
    ]);
    expect(t.customFields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['project_type', 'budget_range', 'desired_start', 'tech_stack']),
    );
  });

  it('repair-shop: Inquiries (default) + Repair jobs pipelines, device fields, walk-in source', () => {
    const t = INDUSTRY_TEMPLATES['repair-shop'];
    expect(t.pipelines.map((p) => [p.key, p.isDefault])).toEqual([
      ['inquiries', true],
      ['repair_jobs', false],
    ]);
    expect(t.pipelines[1]?.stages.map((s) => s.key)).toEqual([
      'received',
      'diagnosing',
      'awaiting_approval',
      'repairing',
      'ready_for_pickup',
      'delivered',
      'cancelled',
    ]);
    expect(t.customFields.map((f) => f.key)).toEqual(
      expect.arrayContaining(['device_brand', 'device_model', 'imei_serial', 'issue']),
    );
    expect(t.leadSources.find((s) => s.type === 'walk_in')).toBeDefined();
  });

  it('unknown or missing keys fall back to generic', () => {
    expect(industryTemplate(null).key).toBe('generic');
    expect(industryTemplate('spaceships').key).toBe('generic');
    expect(industryTemplate('clinic').key).toBe('clinic');
  });

  it('the schema rejects broken templates', () => {
    const base = structuredClone(INDUSTRY_TEMPLATES.generic);
    const bad = (mutate: (t: typeof base) => void) => {
      const t = structuredClone(base);
      mutate(t);
      return industryTemplateSchema.safeParse(t).success;
    };
    expect(bad(() => undefined)).toBe(true);
    expect(bad((t) => (t.pipelines[0]!.isDefault = false))).toBe(false); // no default
    expect(bad((t) => t.pipelines[0]!.stages.forEach((s) => (s.category = 'won')))).toBe(false); // no open
    expect(bad((t) => (t.pipelines[0]!.stages[1]!.key = 'new'))).toBe(false); // duplicate stage key
    expect(
      bad((t) =>
        t.customFields.push({
          entity: 'lead',
          key: 'x',
          label: 'X',
          type: 'select',
          required: false,
        }),
      ),
    ).toBe(false); // select without options
    expect(bad((t) => (t.pipelines[0]!.stages[0]!.key = 'Bad Key'))).toBe(false);
  });
});
