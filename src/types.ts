/** Shared types for the scanner. No runtime dependencies, no vendor coupling. */

/** Platforms with a verified keyless (no API key) reader implemented in src/adapters. */
export type PlatformType =
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'amazon_careers'
  | 'oracle_cloud'
  | 'join'
  | 'bamboohr'
  | 'comeet'
  | 'google_careers'
  | 'wp_json'
  | 'html_listing'
  | 'sitemap_jsonld';

export type JobType = 'student' | 'junior';

/** Optional per-source settings. Adapter-specific keys are documented in each adapter file. */
export interface SourceOptions {
  /** Hard cap on postings pulled per source. */
  max_items?: number;
  /** Cap on detail-page fetches (title-neutral postings only). */
  max_details?: number;
  /** Cap on list-stage records (Workday search pages). */
  max_list?: number;
  /** Cap on result pages walked. */
  max_pages?: number;
  /** Override the User-Agent header for this source. */
  user_agent?: string;
  /** html_listing adapter: regex with named groups `url` and `title` (+ optional `location`). */
  listing_pattern?: string;
  /** html_listing adapter: regex whose first capture group is the description block. */
  detail_pattern?: string;
  /** sitemap_jsonld adapter: sitemap URL to read. */
  sitemap_url?: string;
  /** sitemap_jsonld adapter: regex with one capture group matching a job URL. */
  job_url_pattern?: string;
  /** wp_json adapter: custom post type slugs to probe, in order. */
  cpt_candidates?: string[];
  /** Locale hint for classification: 'en' (default) or 'he'. */
  locale?: 'en' | 'he';
  [key: string]: unknown;
}

/** One company career source. Mirrors a plain configuration file entry. */
export interface SourceConfig {
  name: string;
  career_url: string;
  platform_type: PlatformType;
  enabled?: boolean;
  relevant_locations?: string[];
  options?: SourceOptions;
}

/** The single normalized shape every adapter returns. */
export interface NormalizedJob {
  external_job_id: string;
  requisition_id?: string | null;
  title: string;
  company?: string;
  location: string;
  original_url: string;
  posted_date?: string | null;
  job_type: JobType;
  role_type?: string | null;
  content_text?: string;
}

/** What an adapter returns: counters + the postings that survived classification. */
export interface AdapterResult {
  total_fetched: number;
  /** Postings that passed the location filter. */
  in_location: number;
  jobs: NormalizedJob[];
  /** Rejection counters by reason, e.g. { senior_title: 12 }. */
  rejected: Record<string, number>;
}

export interface AdapterContext {
  /** Location filter terms, lowercased by the caller. */
  locations: string[];
  /** True when the filter targets Israel (enables the Israeli city dictionary). */
  isIsrael: boolean;
  /** Cap for postings fetched per source. */
  maxItems: number;
}

export type Adapter = (source: SourceConfig, ctx: AdapterContext) => Promise<AdapterResult>;

/** A job record as previously seen by the scanner (any storage backend). */
export interface KnownJob {
  id: string;
  external_job_id?: string | null;
  company?: string;
  title: string;
  location?: string;
  original_url?: string;
  status?: 'active' | 'expired';
  first_seen_at?: string;
  last_seen_at?: string;
  last_verified_at?: string | null;
  consecutive_missing_scans?: number;
  expired_reason?: string | null;
}

/** Reusable per-source health state (persist it wherever you like). */
export interface SourceHealthState {
  last_scan_at: string | null;
  last_scan_status: 'success' | 'failed' | 'never';
  consecutive_scan_failures: number;
  last_scan_error: string | null;
  last_successful_scan_at: string | null;
}

export interface DuplicateHit {
  job: NormalizedJob;
  reason: 'external_id' | 'url' | 'fingerprint';
}

export interface LifecyclePlan {
  /** Postings found again: timestamps refreshed, miss counter reset. */
  refreshed: KnownJob[];
  /** Previously expired postings found again: reactivated. */
  reactivated: KnownJob[];
  /** Active postings missing from this scan, still inside the grace window. */
  kept_missing: { job: KnownJob; misses: number }[];
  /** Active postings missing for the second consecutive scan. */
  expired: { job: KnownJob; misses: number }[];
}

export interface ScanStats {
  total_fetched: number;
  in_location: number;
  relevant: number;
  duplicates: number;
  new_jobs: number;
}

export interface ScanResult {
  source: string;
  platform_type: PlatformType;
  ok: boolean;
  error?: string;
  scanned_at: string;
  stats: ScanStats;
  rejected: Record<string, number>;
  jobs: NormalizedJob[];
  duplicates: DuplicateHit[];
  lifecycle: LifecyclePlan;
  health: SourceHealthState;
}