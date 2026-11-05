import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** argon2id (the @node-rs/argon2 default) with library-default cost parameters. */
@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false; // malformed hash
    }
  }

  /**
   * Burns the same time as a real verify, for logins with an unknown email or no password, so
   * response timing doesn't reveal which accounts exist.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= hash('dummy password for timing equalisation');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
