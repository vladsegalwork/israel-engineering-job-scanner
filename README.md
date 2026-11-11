# Israel Engineering Job Scanner

A small, dependency-free TypeScript scanner for **public company career sites**, focused on
**Electrical / Computer Engineering student and junior roles in Israel**.

It reads the same public job feeds a browser reads (Workday, Greenhouse, Lever, Comeet, Oracle
Cloud, JOIN, BambooHR, Amazon, Google Careers, plus generic WordPress / HTML / sitemap sites),
keeps only postings that are genuinely entry-level, and returns one flat, normalized list.

No API keys. No accounts. No headless browser. No database. No personal data.

```bash
npm install
npm run scan:json            # prints matching jobs as JSON
npm run scan                 # writes jobs.json + a per-source summary table
```

```
SOURCE                 PLATFORM         FETCHED   IN-LOC   MATCHED   NEW   DUP   EXPIRED   STATUS
-------------------------------------------------------------------------------------------------
NVIDIA                 workday          140       26       0         0     0     0         ok (healthy)
Mobileye               lever            180       155      1         1     0     0         ok (healthy)
Astera Labs            greenhouse       180       39       1         1     0     0         ok (healthy)
-------------------------------------------------------------------------------------------------
3 source(s) · 500 postings fetched · 2 matched · 2 new
rejections: senior_title=218, not_entry_level=109, experienced_role_type=3, not_relevant_area=2
```

## Why this exists

Student and junior hardware roles are scattered across a dozen applicant-tracking systems, each
with its own URL shape, pagination and JSON dialect. Job boards aggregate them badly (stale
listings, no seniority filter, no way to tell a student position from a 6-year role), and the big
networks block automated access outright.

This project does the boring part: talk to each company's own public listing endpoint, normalize
the response, and throw away everything that a student or a fresh graduate would not be eligible
for. What you do with the list (a website, a weekly digest, a spreadsheet) is up to you.

**Deliberately out of scope:** LinkedIn, Indeed, Glassdoor and similar networks (they block
automated access and prohibit it in their terms), logged-in-only portals, and any form of
candidate data. This tool only ever reads job advertisements.

## Requirements

- Node.js 20 or newer
- Outbound HTTPS access to the companies you configure

## Quick start

```bash
npm install

# scan the bundled example configuration
npm run scan:example

# or run the CLI directly
npx tsx src/cli/scan.ts --config config/sources.example.json --json
```

Compile once and run the built output if you prefer plain `node`:

```bash
npm run build
node dist/cli/scan.js --config config/sources.example.json --out jobs.json
```

### CLI flags

| Flag | Meaning |
| --- | --- |
| `--config <path>` | Source configuration file (default `config/sources.example.json`) |
| `--out <path>` | Write matching jobs to this file (default `jobs.json`) |
| `--json` | Print matching jobs to stdout instead of writing a file |
| `--only <names>` | Comma-separated source names to run, e.g. `--only Mobileye,"Astera Labs"` |
| `--state <path>` | Persist scanner state between runs, which enables cross-run deduplication and lifecycle tracking |
| `--limit <n>` | Cap postings kept per source |
| `--quiet` | Suppress the summary, print only job output |

Exit codes: `0` at least one source succeeded, `1` every attempted source failed, `2` configuration
or usage error.

### Output

```json
[
  {
    "source": "Astera Labs",
    "company": "Astera Labs",
    "title": "Physical Design Student",
    "job_type": "student",
    "location": "Tel Aviv-Yafo, Tel Aviv District, Israel",
    "url": "https://job-boards.greenhouse.io/asteralabs/jobs/4623110006",
    "posted_date": null,
    "external_job_id": "4623110006",
    "requisition_id": null
  }
]
```

`job_type` is either `student` or `junior`. `url` always points at the company's own posting, so a
reader can apply at the source. `posted_date` is `null` when the source does not publish one.

## Configuration

```json
{
  "max_items_per_source": 500,
  "sources": [
    {
      "name": "NVIDIA",
      "career_url": "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
      "platform_type": "workday",
      "enabled": true,
      "relevant_locations": ["Israel"],
      "options": { "max_list": 600, "max_details": 120 }
    }
  ]
}
```

Top level:

- `max_items_per_source` (default `500`): cap on postings kept per source, unless the source sets
  its own `options.max_items`.
- `sources`: the list of company career pages.

Per source:

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Display name, also used as the company name when a listing does not name one |
| `career_url` | yes | The public careers page. The board identifier / tenant is derived from it |
| `platform_type` | yes | Which reader to use. Must be one of the supported types below |
| `enabled` | no (default `true`) | Whether a run includes this source |
| `relevant_locations` | no | Location filter terms. When omitted, the run's `defaultLocations` is used |
| `options` | no | Adapter settings, see below |

### Supported `platform_type` values

| Type | `career_url` example | Notes |
| --- | --- | --- |
| `workday` | `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite` | Reads the search API, uses country facets when the tenant exposes them, then verifies locations on the detail page. Set `max_list` (records pulled) and `max_details` (detail-page fetches) to bound runtime |
| `greenhouse` | `https://job-boards.greenhouse.io/<board>` | Public board API, one extra request per posting for content |
| `lever` | `https://jobs.eu.lever.co/<board>` | Single postings request, content included |
| `comeet` | `https://www.comeet.com/jobs/<board>/<uid>` | Public board API |
| `oracle_cloud` | `https://<tenant>.oraclecloud.com/hcmUI/CandidateExperience/en/sites/<site>` | Reads the recruiting API behind the tenant |
| `join` | `https://join.com/companies/<slug>` | Public company API |
| `bamboohr` | `https://<subdomain>.bamboohr.com/careers` | Subdomain derived from the URL |
| `amazon_careers` | `https://www.amazon.jobs/en/` | Reads the public search endpoint |
| `google_careers` | `https://www.google.com/about/careers/applications/jobs/results` | Walks result pages. Set `max_pages` |
| `wp_json` | `https://<company>.co.il/careers` | WordPress REST API, probes common job post types |
| `html_listing` | any server-rendered careers page | Needs `listing_pattern` (regex with named groups `url`, `title`, optional `location`) and optionally `detail_pattern`, where capture group 1 is the description block |
| `sitemap_jsonld` | any careers site with a sitemap | Needs `sitemap_url` and `job_url_pattern`; reads `JobPosting` JSON-LD from each posting page |

Options understood by adapters: `max_items`, `max_details`, `max_list`, `max_pages`,
`user_agent`, `listing_pattern`, `detail_pattern`, `sitemap_url`, `job_url_pattern`,
`cpt_candidates`, `locale`.

Some career sites are deliberately **not** supported because they cannot be read without an
account or because they block automated requests (for example Eightfold tenants behind a WAF,
SuccessFactors portals behind a login, and Eightfold-based Qualcomm pages). A source that starts
returning an error stays in the configuration but is reported as failed, so one broken site never
stops a run.

## How a posting is accepted

Two gates, both in code, both explainable from the rejection counters in the output:

1. **Location.** The posting's location text must match one of the source's `relevant_locations`
   terms. Matching is case-insensitive, apostrophe-insensitive and word-boundary aware, so
   `Tel Aviv` does not match `Tel Avivim` and curly apostrophes in Hebrew text are tolerated. For
   Israel filters, a built-in dictionary of Israeli cities and regions is used to recognise Hebrew
   and English spellings, and to normalize the display value.
2. **Entry level.** The posting must read as a student position or a first-job position:
   - Titles containing seniority markers (senior, staff, principal, lead, manager, director,
     architect and their Hebrew equivalents) are rejected: `senior_title`.
   - A title that names the role area but has no entry signal is rejected only after reading the
     description and finding no student / graduate / no-experience signal: `not_entry_level`.
   - Postings that explicitly ask for several years of experience are rejected:
     `experienced_role_type`.
   - Postings outside the electrical / computer engineering area are rejected:
     `not_relevant_area`.

`job_type` is `student` when the posting says student, internship or the Hebrew equivalents, and
`junior` otherwise.

Classification is heuristic by design. It favours precision over recall: a borderline posting is
more likely to be dropped than to be listed. Tune `scripts`/lists in `src/classification/` if your
market needs different vocabulary.

## Deduplication and lifecycle

Give the CLI `--state <file>` (or supply your own `JobStore` from the library) and the scanner keeps
a record per posting:

- Identity is a source-scoped fingerprint built from the external id, or from the normalized URL,
  or from company + title + location when neither exists (`src/dedup/fingerprint.ts`).
- A posting already in the store is reported as a duplicate and its `last_seen_at` is refreshed
  instead of creating a second record.
- A posting missing from a **successful** scan gets `consecutive_missing_scans + 1`. Two
  consecutive misses mark it `expired` with `expired_reason: no_longer_found_at_source`. A source
  that fails to scan never expires anything, so a network hiccup cannot wipe your list.
- Reappearing postings are reactivated.

```bash
node dist/cli/scan.js --only Mobileye --state scanner-state.json --out jobs.json   # first run: 1 new
node dist/cli/scan.js --only Mobileye --state scanner-state.json --out jobs.json   # second run: 0 new, 1 duplicate
```

The state file is plain JSON written next to your working directory and ignored by git.

## Using it as a library

The engine is storage-agnostic: you give it the records you already have, it tells you what to
write. With the bundled JSON store that looks like this:

```ts
import {
  scanSource,
  scanSources,
  JsonFileJobStore,
  loadSourcesFromFile,
} from 'israel-engineering-job-scanner';

const config = loadSourcesFromFile('config/sources.example.json');
const store = new JsonFileJobStore('scanner-state.json');

for (const source of config.sources.filter((s) => s.enabled !== false)) {
  const previous = await store.listBySource(source.name);

  const result = await scanSource(source, previous, {
    defaultLocations: ['Israel'],            // used when a source declares none
    maxItems: config.max_items_per_source,   // cap on postings kept per source
  });

  await store.addJobs(source.name, result.jobs);
  await store.applyLifecycle(result.lifecycle);

  console.log(source.name, result.ok, result.stats.relevant, result.error ?? '');
}

store.save();
```

`scanSources(sources, previousJobsBySource, options)` is the same loop in one call: it returns a
`ScanResult[]` and never throws, so one failing site cannot stop the batch.

A single source returns a `ScanResult`:

```ts
{
  source: string;
  platform_type: PlatformType;
  ok: boolean;
  error?: string;
  scanned_at: string;          // ISO timestamp
  stats: { total_fetched, in_location, relevant, duplicates, new_jobs };
  rejected: Record<string, number>;
  jobs: NormalizedJob[];        // new postings only
  duplicates: NormalizedJob[];  // already known, refreshed instead of re-created
  lifecycle: { refreshed: string[]; reactivated: string[]; kept_missing: string[]; expired: string[] };
  health: SourceHealthState;    // ok / failing counters, for status reporting
}
```

The engine performs **no persistence**. `MemoryJobStore` and `JsonFileJobStore` are included so you
can start without a database, and `JobStore` is a three-method interface
(`listBySource`, `addJobs`, `applyLifecycle`) you can implement over Postgres, SQLite, a queue, or
nothing at all.

### Writing your own adapter

An adapter is a function from a source plus a context to a normalized result. Everything else
(location matching, classification, dedup, lifecycle, health) is shared.

```ts
import type { Adapter, SourceConfig, AdapterContext, NormalizedJob } from 'israel-engineering-job-scanner';
import { classifyJob, findIsraelCity } from 'israel-engineering-job-scanner';

export const myAdapter: Adapter = async (source, ctx) => {
  const response = await fetch(`${source.career_url}/jobs.json`);
  const items = (await response.json()) as Array<{
    id: string;
    title: string;
    city: string;
    url: string;
    description?: string;
  }>;

  const jobs: NormalizedJob[] = [];
  const rejected: Record<string, number> = {};
  let inLocation = 0;

  for (const item of items) {
    const location = findIsraelCity(item.city) ?? item.city;
    if (!ctx.locations.some((term) => location.toLowerCase().includes(term))) continue;
    inLocation += 1;

    const verdict = classifyJob(item.title, null, item.description);
    if (!verdict.relevant) {
      rejected[verdict.reason] = (rejected[verdict.reason] ?? 0) + 1;
      continue;
    }

    jobs.push({
      external_job_id: item.id,
      title: item.title,
      location,
      original_url: item.url,
      job_type: verdict.job_type,
    });
  }

  return { total_fetched: items.length, in_location: inLocation, jobs: jobs.slice(0, ctx.maxItems), rejected };
};
```

Register it next to the built-in adapters and add its name to `PlatformType`, then use that name in
your configuration.

### Source health

Each source carries `consecutive_failures`, `last_error` and `last_success_at`. `recordScanSuccess`
and `recordScanFailure` in `src/health.ts` update them, and `healthLevel` turns them into
`healthy` / `degraded` / `unhealthy` for a status page. A source is never auto-disabled: if a site
changes shape you get a visible failure, not a silent gap.

## Practical notes

- **Be a good client.** Requests are plain `fetch` calls with a descriptive User-Agent, small
  concurrency batches and no retries beyond what an adapter needs. Do not point this at a site at a
  frequency a person would not tolerate, and do not remove the User-Agent.
- **Read the rules of the site you scan.** Public career endpoints are meant to be read, but terms
  and `robots` directives still apply. Running this against a site whose terms forbid it is your
  responsibility, not the library's.
- **Postings belong to the companies.** Results are links and titles, not content you can
  republish as your own. Keep attribution and send candidates to the original posting.
- **No personal data.** The scanner reads advertisements only: no candidates, no CVs, no accounts,
  no cookies, no tracking, no fingerprinting of visitors.
- **Workday is the slow one.** A tenant with no country facet needs several searches. Bound it with
  `max_details` and `max_pages` rather than letting a run grow unbounded.
- **Classification drifts.** Companies rename levels and write titles in ways no regex predicts.
  Read the rejection counters after changing configuration.

## Project layout

```
config/sources.example.json   example sources
src/types.ts                  shared types, no dependencies
src/engine.ts                 scan one source or many, no persistence
src/adapters/                 one file per platform, plus shared HTTP helpers
src/classification/           relevance, seniority and entry-level rules (English + Hebrew)
src/normalization/            text, HTML, location and URL normalization
src/dedup/                    fingerprint, dedupe, lifecycle planning
src/health.ts                 per-source health counters
src/persistence/store.ts      optional in-memory and JSON stores
src/config/sources.ts         configuration loading and validation
src/cli/scan.ts               the example command line tool
```

## Verified against real sources

The adapters in this repository were exercised against live public career sites during
development, including Workday (NVIDIA), Lever (Mobileye) and Greenhouse (Astera Labs). Results
depend on what those companies publish on the day you run it, and on their infrastructure staying
the same shape.

Before release, the package was reviewed for anything that should not leave a private environment.
`SECURITY_AUDIT.md` records that review: no credentials, no authentication, no personal data, no
tracking, and a list of every hardcoded host.

## License

MIT. See `LICENSE`.