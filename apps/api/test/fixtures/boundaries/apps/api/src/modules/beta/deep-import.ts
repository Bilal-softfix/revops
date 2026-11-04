// Violation: reaches into another module's internals.
import { AlphaService } from '../alpha/alpha.service';

export const deep = new AlphaService().ping();
