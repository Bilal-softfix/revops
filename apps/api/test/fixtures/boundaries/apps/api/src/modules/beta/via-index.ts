// Allowed: another module through its public index.
import { AlphaService } from '../alpha';

export const viaIndex = new AlphaService().ping();
