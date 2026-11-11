/* Minimal persistence layer so the engine can be tried without any database.
   A "store" only has to satisfy three operations; implement the same interface on top of your
   own database (SQL, Mongo, a key-value cache, ...) to use the engine in production. */

import { readFileSync, writeFileSync } from 'node:fs';
import type { KnownJob, LifecyclePlan, NormalizedJob } from '../types.js';
import { companyFromSourceName } from '../dedup/fingerprint.js';
import { missFields, newJobRecord, refreshFields } from '../dedup/lifecycle.js';

export interface JobStore {
  listBySource(source: string): Promise<KnownJob[]>;
  addJobs(source: string, jobs: NormalizedJob[]): Promise<KnownJob[]>;
  applyLifecycle(plan: LifecyclePlan): Promise<void>;
}

/** In-memory store. Enough for a single run, tests, and examples. */
export class MemoryJobStore implements JobStore {
  protected jobs: KnownJob[] = [];
  private counter = 0;

  async listBySource(source: string): Promise<KnownJob[]> {
    return this.jobs.filter((j) => (j as KnownJob & { source?: string }).source === source);
  }

  async addJobs(source: string, jobs: NormalizedJob[]): Promise<KnownJob[]> {
    const now = new Date().toISOString();
    const created = jobs.map((job) =>
      newJobRecord(job, {
        id: `job-${++this.counter}`,
        source,
        company: companyFromSourceName(source),
        now,
      }),
    );
    this.jobs.push(...created);
    return created;
  }

  async applyLifecycle(plan: LifecyclePlan): Promise<void> {
    const now = new Date().toISOString();
    const byId = new Map(this.jobs.map((j) => [j.id, j]));

    for (const job of [...plan.refreshed, ...plan.reactivated]) {
      const stored = byId.get(job.id);
      if (stored) Object.assign(stored, refreshFields(now));
    }
    for (const { job, misses } of plan.kept_missing) {
      const stored = byId.get(job.id);
      if (stored) Object.assign(stored, missFields(misses, false));
    }
    for (const { job, misses } of plan.expired) {
      const stored = byId.get(job.id);
      if (stored) Object.assign(stored, missFields(misses, true));
    }
  }

  /** Everything currently stored (for inspection / dump). */
  all(): KnownJob[] {
    return this.jobs;
  }
}

/**
 * JSON-file store: same behaviour as the memory store, persisted between runs so that
 * deduplication and lifecycle transitions can be observed across scans.
 */
export class JsonFileJobStore implements JobStore {
  private inner = new MemoryJobStore();

  constructor(private readonly path: string) {
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.jobs)) {
        (this.inner as unknown as { jobs: KnownJob[] }).jobs = parsed.jobs;
        (this.inner as unknown as { counter: number }).counter = Number(parsed.counter || parsed.jobs.length);
      }
    } catch {
      /* first run: start empty */
    }
  }

  listBySource(source: string): Promise<KnownJob[]> {
    return this.inner.listBySource(source);
  }

  addJobs(source: string, jobs: NormalizedJob[]): Promise<KnownJob[]> {
    return this.inner.addJobs(source, jobs);
  }

  applyLifecycle(plan: LifecyclePlan): Promise<void> {
    return this.inner.applyLifecycle(plan);
  }

  /** Persist the current state to disk. */
  save(): void {
    writeFileSync(
      this.path,
      JSON.stringify({ jobs: this.inner.all() }, null, 2),
      'utf8',
    );
  }

  all(): KnownJob[] {
    return this.inner.all();
  }
}