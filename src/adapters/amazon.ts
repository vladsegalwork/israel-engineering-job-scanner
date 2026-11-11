/* Amazon Jobs adapter (amazon.jobs also serves subsidiaries such as Annapurna Labs).
   Public keyless endpoint: https://www.amazon.jobs/en/search.json
   The list response already carries the full description, so no detail fetches are needed.
   The search endpoint accepts a country code, not a city, so the Israel filter is pushed
   into the API itself. */

import { classifyJob, countRejection, isEntryTitle } from '../classification/index.js';
import { anyIsraelFilter } from '../normalization/location.js';
import { stripHtml } from '../normalization/text.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchJson, userAgentFor } from './http.js';

interface AmazonJob {
  id?: string;
  id_icims?: string;
  title?: string;
  job_path?: string;
  city?: string;
  normalized_location?: string;
  country_code?: string;
  posted_date?: string;
  is_manager?: boolean;
  is_intern?: boolean;
  description?: string;
  basic_qualifications?: string;
  preferred_qualifications?: string;
}

export async function fetchAmazonJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const maxJobs = Number(source.options?.max_items ?? 3000);
  const isIsrael = anyIsraelFilter(ctx.locations);

  const raw: AmazonJob[] = [];
  let offset = 0;
  let guard = 0;

  while (guard++ < 30) {
    const params = new URLSearchParams({ result_limit: '100', offset: String(offset) });
    if (isIsrael) {
      params.append('country', 'ISR');
      params.append('normalized_country_code[]', 'ISR');
    }
    const data = await fetchJson<{ jobs?: AmazonJob[]; hits?: number; error?: string }>(
      `https://www.amazon.jobs/en/search.json?${params.toString()}`,
      ua,
    );
    if (data.error) throw new Error(`Amazon search error: ${data.error}`);
    const page = data.jobs || [];
    raw.push(...page);
    offset += page.length;
    if (page.length < 100 || offset >= Math.min(data.hits || 0, maxJobs) || raw.length >= maxJobs) break;
  }

  const rejected: Record<string, number> = {};
  const jobs: NormalizedJob[] = [];
  let inLocation = 0;

  for (const job of raw) {
    // When the search is country-scoped every result is an Israeli posting.
    if (isIsrael || (job.country_code || '').toUpperCase() === 'ISR') inLocation += 1;

    const title = job.title || '';
    // is_manager is authoritative metadata for the same seniority rule the classifier applies
    // to titles; entry-level titles are never rejected on this flag alone.
    if (job.is_manager === true && !isEntryTitle(title)) {
      countRejection(rejected, 'senior_title');
      continue;
    }

    const contentText = stripHtml(
      [job.description, job.basic_qualifications, job.preferred_qualifications]
        .filter(Boolean)
        .join('\n'),
    );
    const verdict = classifyJob(title, null, contentText);
    if (!verdict.relevant || !verdict.job_type) {
      countRejection(rejected, verdict.reason || 'not_relevant_area');
      continue;
    }

    let postedDate: string | null = null;
    if (job.posted_date) {
      const parsed = new Date(job.posted_date); // e.g. "October 21, 2026"
      if (!Number.isNaN(parsed.getTime())) postedDate = parsed.toISOString().slice(0, 10);
    }

    jobs.push({
      external_job_id: job.id_icims ? String(job.id_icims) : job.id ? String(job.id) : '',
      requisition_id: null,
      title,
      location: job.normalized_location || job.city || '',
      original_url: `https://www.amazon.jobs${job.job_path || ''}`,
      posted_date: postedDate,
      job_type: job.is_intern === true ? 'student' : verdict.job_type,
      role_type: null,
      content_text: contentText,
    });
  }

  return { total_fetched: raw.length, in_location: inLocation, jobs: jobs.slice(0, ctx.maxItems), rejected };
}