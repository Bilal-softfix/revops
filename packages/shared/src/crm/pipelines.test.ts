import { describe, expect, it } from 'vitest';
import {
  createPipelineRequestSchema,
  reorderStagesRequestSchema,
  updatePipelineRequestSchema,
  updateStageRequestSchema,
} from './pipelines.js';

describe('pipeline requests (M1-T3b)', () => {
  it('a new pipeline needs an open stage and unique stage names; stages are optional', () => {
    expect(createPipelineRequestSchema.safeParse({ name: 'Repairs' }).success).toBe(true);
    expect(
      createPipelineRequestSchema.safeParse({
        name: 'X',
        stages: [{ name: 'Won', category: 'won' }],
      }).success,
    ).toBe(false);
    expect(
      createPipelineRequestSchema.safeParse({
        name: 'X',
        stages: [
          { name: 'New', category: 'open' },
          { name: 'new', category: 'open' },
        ],
      }).success,
    ).toBe(false);
  });

  it('isDefault can only be switched on; unknown keys are rejected', () => {
    expect(updatePipelineRequestSchema.safeParse({ isDefault: true }).success).toBe(true);
    expect(updatePipelineRequestSchema.safeParse({ isDefault: false }).success).toBe(false);
    expect(updatePipelineRequestSchema.safeParse({ key: 'x' }).success).toBe(false);
    expect(updatePipelineRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updatePipelineRequestSchema.safeParse({ lostReasons: ['Too costly', 'too costly'] }).success,
    ).toBe(false);
  });

  it('stage updates and reorders are validated', () => {
    expect(updateStageRequestSchema.safeParse({ probability: 101 }).success).toBe(false);
    expect(updateStageRequestSchema.safeParse({ position: 2 }).success).toBe(false);
    const id = '11111111-1111-4111-8111-111111111111';
    expect(reorderStagesRequestSchema.safeParse({ stageIds: [id, id] }).success).toBe(false);
    expect(reorderStagesRequestSchema.safeParse({ stageIds: [] }).success).toBe(false);
  });
});
