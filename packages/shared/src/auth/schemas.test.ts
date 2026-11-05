import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  loginRequestSchema,
  resetPasswordRequestSchema,
  signupRequestSchema,
} from './schemas.js';

const valid = {
  name: ' Asha ',
  email: '  Asha@Example.COM ',
  password: 'correct horse battery',
  tenantName: 'Asha Realty',
};

describe('signupRequestSchema', () => {
  it('trims names and normalises the email to lower case', () => {
    expect(signupRequestSchema.parse(valid)).toEqual({
      ...valid,
      name: 'Asha',
      email: 'asha@example.com',
    });
  });

  it.each([
    ['short password', { password: 'short' }],
    ['huge password', { password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) }],
    ['bad email', { email: 'not-an-email' }],
    ['blank tenant name', { tenantName: '   ' }],
  ])('rejects %s', (_label, patch) => {
    expect(signupRequestSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  it('accepts any non-empty password (a short one is just wrong, not invalid)', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
  });
});

describe('resetPasswordRequestSchema', () => {
  it('accepts a 43-char base64url token only', () => {
    const token = 'A'.repeat(43);
    expect(resetPasswordRequestSchema.safeParse({ token, password: valid.password }).success).toBe(
      true,
    );
    expect(
      resetPasswordRequestSchema.safeParse({ token: `${token}=`, password: valid.password })
        .success,
    ).toBe(false);
  });
});
