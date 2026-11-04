// Violation: picks a provider implementation directly instead of the provider's index.
import { FakeEmailProvider } from '../../providers/email/fake-email.provider';

export const provider = new FakeEmailProvider();
