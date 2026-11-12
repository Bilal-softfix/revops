import { Injectable } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { JobHandler } from './job';

/** Every JobHandler provider in the app, by queue name (found via Nest's DiscoveryService). */
@Injectable()
export class JobHandlers {
  private cache: Map<string, JobHandler> | undefined;

  constructor(private readonly discovery: DiscoveryService) {}

  all(): JobHandler[] {
    return [...this.byName().values()];
  }

  get(name: string): JobHandler {
    const handler = this.byName().get(name);
    if (!handler) throw new Error(`no handler registered for job "${name}"`);
    return handler;
  }

  private byName(): Map<string, JobHandler> {
    if (this.cache) return this.cache;
    const map = new Map<string, JobHandler>();
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      if (!(instance instanceof JobHandler)) continue;
      const existing = map.get(instance.job.name);
      if (existing && existing !== instance) {
        throw new Error(`two handlers for job "${instance.job.name}"`);
      }
      map.set(instance.job.name, instance);
    }
    this.cache = map;
    return map;
  }
}
