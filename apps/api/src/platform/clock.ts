/** Injectable time source so session/rate-limit logic can be tested with a fake clock. */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock extends Clock {
  constructor(private current = new Date('2026-01-01T00:00:00Z')) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
