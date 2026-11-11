/* Generic posting lifecycle.
   Rule: a posting is never expired because of a single miss. The first miss keeps it active
   (sources are flaky, pagination shifts, a posting can drop out of a page of results), and the
   second consecutive miss expires it. A posting found again at any point is reactivated and its
   miss counter resets.
   Only run this after a SUCCESSFUL scan: a failed scan says nothing about the posting. */

import type { KnownJob, LifecyclePlan, NormalizedJob } from '../types.js';
import { normalizeUrl } from '../normalization/url.js';
import { jobFingerprint } from './fingerprint.js';
import { matchKeys } from './dedupe.js';

export const MISSING_SCANS_UNTIL_EXPIRED = 2;

export interface LifecycleOptions {
  /** Consecutive misses tolerated before expiring. Default MISSING_SCANS_UNTIL_EXPIRED. */
  missingUntilExpired?: number;
}

/**
 * Compare what this scan found against what is stored, and describe the transitions.
 * Pure function: it returns a plan, it never mutates or persists anything.
 */
export function planLifecycle(
  existing: KnownJob[],
  findings: NormalizedJob[],
  options: LifecycleOptions = {},
): LifecyclePlan {
  const threshold = Math.max(1, options.missingUntilExpired ?? MISSING_SCANS_UNTIL_EXPIRED);

  const seenKeys = new Set<string>();
  for (const job of findings) {
    for (const key of matchKeys(job)) seenKeys.add(key);
  }

  const plan: LifecyclePlan = { refreshed: [], reactivated: [], kept_missing: [], expired: [] };

  for (const job of existing) {
    const keys = matchKeys(job);
    const found = keys.some((k) => seenKeys.has(k));

    if (found) {
      if (job.status === 'expired') plan.reactivated.push(job);
      else plan.refreshed.push(job);
      continue;
    }

    if (job.status === 'expired') continue; // already expired, stays expired
    const misses = (job.consecutive_missing_scans || 0) + 1;
    if (misses >= threshold) plan.expired.push({ job, misses });
    else plan.kept_missing.push({ job, misses });
  }

  return plan;
}

/** Build the record fields for a brand-new posting. Storage-agnostic. */
export function newJobRecord(
  job: NormalizedJob,
  options: { id: string; source: string; company: string; now: string },
): KnownJob & { source: string; job_type: string } {
  return {
    id: options.id,
    source: options.source,
    external_job_id: job.external_job_id || null,
    company: job.company || options.company,
    title: job.title,
    location: job.location,
    original_url: job.original_url,
    status: 'active',
    first_seen_at: options.now,
    last_seen_at: options.now,
    last_verified_at: options.now,
    consecutive_missing_scans: 0,
    expired_reason: null,
    job_type: job.job_type,
  };
}

/** Fields to write back when a stored job is refreshed by a successful scan. */
export function refreshFields(now: string): Partial<KnownJob> {
  return {
    status: 'active',
    last_seen_at: now,
    last_verified_at: now,
    consecutive_missing_scans: 0,
    expired_reason: null,
  };
}

/** Fields to write back when a stored job is missing. */
export function missFields(misses: number, expire: boolean): Partial<KnownJob> {
  return expire
    ? { consecutive_missing_scans: misses, status: 'expired', expired_reason: 'no_longer_found_at_source' }
    : { consecutive_missing_scans: misses };
}

/** Convenience: the fingerprint of a stored job, for logging and debugging. */
export function storedJobFingerprint(job: KnownJob): string {
  return jobFingerprint(job.company, job.title, job.location);
}

export { normalizeUrl };