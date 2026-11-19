import { Inject, Injectable } from '@nestjs/common';
import { type Kek, decryptSecret, encryptSecret, parseKek } from '@revops/shared/crypto';
import type { ApiEnv } from '@revops/shared/env';
import { API_ENV } from '../../config/env';
import { DomainError } from '../errors/domain-error';

/**
 * Secrets at rest (webhook secrets now, provider tokens later): envelope encryption with the
 * DATA_ENCRYPTION_KEY KEK (@revops/shared/crypto). Without a key (allowed outside production)
 * every call fails with 503 `encryption_unavailable`, so nothing is ever stored in plaintext.
 */
@Injectable()
export class SecretBox {
  private readonly kek: Kek | undefined;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.kek = env.DATA_ENCRYPTION_KEY ? parseKek(env.DATA_ENCRYPTION_KEY) : undefined;
  }

  private key(): Kek {
    if (!this.kek) {
      throw new DomainError(
        'encryption_unavailable',
        503,
        'Secret storage is not configured (DATA_ENCRYPTION_KEY)',
      );
    }
    return this.kek;
  }

  encrypt(plaintext: string, context: string): string {
    return encryptSecret(plaintext, this.key(), context);
  }

  decrypt(stored: string, context: string): string {
    return decryptSecret(stored, this.key(), context);
  }
}
