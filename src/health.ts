/* Per-source health state. Reusable on its own: persist the returned object wherever you like
   (a table, a JSON file, a metrics backend) and show the level in your own UI. */

import type { SourceHealthState } from './types.js';

/** Consecutive failures after which a source is reported as unhealthy (never auto-disabled). */
export const FAILURES_UNTIL_UNHEALTHY = 3;

export const INITIAL_HEALTH: SourceHealthState = {
  last_scan_at: null,
  last_scan_status: 'never',
  consecutive_scan_failures: 0,
  last_scan_error: null,
  last_successful_scan_at: null,
};

export function recordScanSuccess(
  previous: SourceHealthState | undefined,
  at: string,
): SourceHealthState {
  return {
    last_scan_at: at,
    last_scan_status: 'success',
    consecutive_scan_failures: 0,
    last_scan_error: null,
    last_successful_scan_at: at,
  };
}

export function recordScanFailure(
  previous: SourceHealthState | undefined,
  at: string,
  error: unknown,
): SourceHealthState {
  const base = previous || INITIAL_HEALTH;
  return {
    last_scan_at: at,
    last_scan_status: 'failed',
    consecutive_scan_failures: (base.consecutive_scan_failures || 0) + 1,
    last_scan_error: String(error ?? 'unknown error').slice(0, 500),
    last_successful_scan_at: base.last_successful_scan_at ?? null,
  };
}

export type HealthLevel = 'unknown' | 'healthy' | 'degraded' | 'failing';

/** Coarse health level for dashboards and alerts. */
export function healthLevel(state: SourceHealthState | undefined): HealthLevel {
  if (!state || state.last_scan_status === 'never') return 'unknown';
  if (state.last_scan_status === 'success') return 'healthy';
  return state.consecutive_scan_failures >= FAILURES_UNTIL_UNHEALTHY ? 'failing' : 'degraded';
}