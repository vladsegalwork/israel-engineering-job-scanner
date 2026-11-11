/* Scan engine: one entry point that runs an adapter, dedupes its findings against what you
   already store, and plans the lifecycle transitions. It performs NO persistence — you decide
   where records live (see src/persistence/store.ts for ready-made in-memory/JSON stores). */

import { getAdapter } from './adapters/index.js';
import { dedupeAgainstExisting } from './dedup/dedupe.js';
import { planLifecycle, type LifecycleOptions } from './dedup/lifecycle.js';
import { companyFromSourceName } from './dedup/fingerprint.js';
import { recordScanFailure, recordScanSuccess } from './health.js';
import { anyIsraelFilter } from './normalization/location.js';
import type {
  AdapterContext,
  KnownJob,
  ScanResult,
  SourceConfig,
  SourceHealthState,
} from './types.js';

export interface ScanOptions extends LifecycleOptions {
  /** Health state from the previous run; returned updated in the result. */
  previousHealth?: SourceHealthState;
  /** Default location filter when a source declares none. */
  defaultLocations?: string[];
  /** Default cap on postings kept per source, when the source declares none of its own. */
  maxItems?: number;
}

function emptyResult(
  source: SourceConfig,
  scannedAt: string,
  error: string,
  health: SourceHealthState,
): ScanResult {
  return {
    source: source.name,
    platform_type: source.platform_type,
    ok: false,
    error,
    scanned_at: scannedAt,
    stats: { total_fetched: 0, in_location: 0, relevant: 0, duplicates: 0, new_jobs: 0 },
    rejected: {},
    jobs: [],
    duplicates: [],
    lifecycle: { refreshed: [], reactivated: [], kept_missing: [], expired: [] },
    health,
  };
}

/**
 * Scan one source end to end.
 *
 * Expected failures (bad URL, HTTP error, unparsable page) are returned as `ok: false` with an
 * error string and failed health state — they never throw, so one bad source cannot stop a run.
 */
export async function scanSource(
  source: SourceConfig,
  previousJobs: KnownJob[] = [],
  options: ScanOptions = {},
): Promise<ScanResult> {
  const now = new Date().toISOString();
  const locations = (source.relevant_locations?.length
    ? source.relevant_locations
    : options.defaultLocations ?? ['Israel']
  ).map((l) => l.toLowerCase());

  const ctx: AdapterContext = {
    locations,
    isIsrael: anyIsraelFilter(locations),
    maxItems: Number(source.options?.max_items ?? options.maxItems ?? 500),
  };

  let adapter;
  try {
    adapter = getAdapter(source.platform_type);
  } catch (error) {
    return emptyResult(
      source,
      now,
      String((error as Error).message || error),
      recordScanFailure(options.previousHealth, now, error),
    );
  }

  try {
    const result = await adapter(source, ctx);
    const company = companyFromSourceName(source.name);
    const { fresh, duplicates } = dedupeAgainstExisting(result.jobs, previousJobs, company);
    const lifecycle = planLifecycle(previousJobs, result.jobs, {
      missingUntilExpired: options.missingUntilExpired,
    });

    return {
      source: source.name,
      platform_type: source.platform_type,
      ok: true,
      scanned_at: now,
      stats: {
        total_fetched: result.total_fetched,
        in_location: result.in_location,
        relevant: result.jobs.length,
        duplicates: duplicates.length,
        new_jobs: fresh.length,
      },
      rejected: result.rejected,
      jobs: fresh,
      duplicates,
      lifecycle,
      health: recordScanSuccess(options.previousHealth, now),
    };
  } catch (error) {
    return emptyResult(
      source,
      now,
      String((error as Error).message || error),
      recordScanFailure(options.previousHealth, now, error),
    );
  }
}

/** Run several sources sequentially. Failures are captured per source, never thrown. */
export async function scanSources(
  sources: SourceConfig[],
  previousJobsBySource: Record<string, KnownJob[]> = {},
  options: ScanOptions = {},
): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (const source of sources) {
    results.push(await scanSource(source, previousJobsBySource[source.name] || [], options));
  }
  return results;
}