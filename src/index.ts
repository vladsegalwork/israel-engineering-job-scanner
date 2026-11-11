/* Public surface of the package.
   Everything here is storage-agnostic: adapters, classification rules, normalization helpers,
   dedup + lifecycle planning, the scan engine, and one optional in-memory/JSON store. */

// Types
export * from './types.js';

// Engine
export { scanSource, scanSources, type ScanOptions } from './engine.js';

// Adapters
export {
  ADAPTERS,
  SUPPORTED_PLATFORM_TYPES,
  getAdapter,
  fetchGreenhouseJobs,
  fetchLeverJobs,
  fetchWorkdayJobs,
  fetchAmazonJobs,
  fetchOracleCloudJobs,
  fetchJoinJobs,
  fetchBambooHrJobs,
  fetchComeetJobs,
  fetchGoogleCareersJobs,
  fetchWpJsonJobs,
  fetchHtmlListingJobs,
  fetchSitemapJsonLdJobs,
} from './adapters/index.js';

// Adapter building blocks (reusable by custom adapters)
export { fetchText, fetchJson, fetchTextOrNull, fetchJsonOrNull, inBatches, userAgentFor, DEFAULT_USER_AGENT } from './adapters/http.js';
export { deriveGreenhouseBoardToken } from './adapters/greenhouse.js';
export { deriveLeverBoardToken, leverPostingsUrl, normalizeLeverPosting } from './adapters/lever.js';
export { deriveWorkdayConfig, workdayJobsUrl, workdayDetailUrl, extractWorkdayReqId } from './adapters/workday.js';
export { deriveOracleCloudConfig } from './adapters/oracleCloud.js';
export { deriveJoinCompanySlug } from './adapters/join.js';
export { deriveBambooHrSubdomain } from './adapters/bamboohr.js';
export { deriveComeetBoardToken } from './adapters/comeet.js';

// Classification
export {
  classifyJob,
  classifyHebrewJob,
  classifierFor,
  isSeniorTitle,
  isEntryTitle,
  RELEVANT_KEYWORDS,
  SENIOR_TITLE_WORDS,
  ENTRY_TITLE_WORDS,
  NON_RELEVANT_TITLE_RE,
  ENTRY_CONTENT_PATTERNS,
  type Verdict,
  type RejectionReason,
  type Locale,
} from './classification/index.js';

// Normalization
export {
  stripHtml,
  decodeJsonString,
  parseNextData,
  findDescriptionField,
  extractJsonArrayAfterMarker,
} from './normalization/text.js';
export {
  ISRAEL_CITY_HINTS,
  isIsraelFilterTerm,
  anyIsraelFilter,
  locationFilterMatches,
  locationMatchesLoose,
  normalizeApostrophes,
  findIsraelCity,
  displayLocation,
} from './normalization/location.js';
export { normalizeUrl } from './normalization/url.js';

// Dedup + lifecycle
export { jobFingerprint, normalizeCompanyName, companyFromSourceName } from './dedup/fingerprint.js';
export { dedupeAgainstExisting, matchKeys, type DedupeOutcome } from './dedup/dedupe.js';
export {
  planLifecycle,
  newJobRecord,
  refreshFields,
  missFields,
  MISSING_SCANS_UNTIL_EXPIRED,
  type LifecycleOptions,
} from './dedup/lifecycle.js';

// Source health
export {
  FAILURES_UNTIL_UNHEALTHY,
  INITIAL_HEALTH,
  recordScanSuccess,
  recordScanFailure,
  healthLevel,
  type HealthLevel,
} from './health.js';

// Configuration
export {
  loadSourcesFromFile,
  parseSources,
  ConfigError,
  type ScannerConfig,
} from './config/sources.js';

// Optional persistence
export { MemoryJobStore, JsonFileJobStore, type JobStore } from './persistence/store.js';