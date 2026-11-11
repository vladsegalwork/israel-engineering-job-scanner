/* Deduplication of freshly scanned postings against records you already store.
   Three identities are tried in order of reliability:
     1. the source's own posting id (external_job_id),
     2. the canonical URL (host + path, query stripped),
     3. the company|title|location fingerprint.
   A posting is a duplicate if any of the three already exists. */

import type { DuplicateHit, KnownJob, NormalizedJob } from '../types.js';
import { normalizeUrl } from '../normalization/url.js';
import { jobFingerprint } from './fingerprint.js';

export interface DedupeOutcome {
  fresh: NormalizedJob[];
  duplicates: DuplicateHit[];
}

/**
 * @param candidates postings that already passed classification
 * @param existing   records already stored for this source (or for every source, for
 *                   cross-source discovery; see the README section on aggregators)
 * @param company    company name to use for the fingerprint of candidates without one
 */
export function dedupeAgainstExisting(
  candidates: NormalizedJob[],
  existing: KnownJob[],
  company: string,
): DedupeOutcome {
  const knownIds = new Set<string>();
  const knownUrls = new Set<string>();
  const knownFingerprints = new Set<string>();

  for (const job of existing) {
    if (job.external_job_id) knownIds.add(String(job.external_job_id));
    const url = normalizeUrl(job.original_url);
    if (url) knownUrls.add(url);
    knownFingerprints.add(jobFingerprint(job.company, job.title, job.location));
  }

  const fresh: NormalizedJob[] = [];
  const duplicates: DuplicateHit[] = [];

  for (const job of candidates) {
    const url = normalizeUrl(job.original_url);
    const fingerprint = jobFingerprint(job.company || company, job.title, job.location);

    let reason: DuplicateHit['reason'] | null = null;
    if (job.external_job_id && knownIds.has(String(job.external_job_id))) reason = 'external_id';
    else if (url && knownUrls.has(url)) reason = 'url';
    else if (knownFingerprints.has(fingerprint)) reason = 'fingerprint';

    if (reason) {
      duplicates.push({ job, reason });
      continue;
    }

    fresh.push(job);
    // Register immediately so two identical postings inside one scan collapse to one.
    if (job.external_job_id) knownIds.add(String(job.external_job_id));
    if (url) knownUrls.add(url);
    knownFingerprints.add(fingerprint);
  }

  return { fresh, duplicates };
}

/** Same decision, expressed as a set of comparison keys — handy for storage layers that
    cannot run the matcher in memory. */
export function matchKeys(job: {
  external_job_id?: string | null;
  original_url?: string | null;
  company?: string | null;
  title?: string | null;
  location?: string | null;
}): string[] {
  const keys: string[] = [];
  if (job.external_job_id) keys.push(`id:${job.external_job_id}`);
  const url = normalizeUrl(job.original_url);
  if (url) keys.push(`url:${url}`);
  keys.push(`fp:${jobFingerprint(job.company, job.title, job.location)}`);
  return keys;
}