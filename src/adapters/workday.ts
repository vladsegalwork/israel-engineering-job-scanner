/* Workday adapter. One adapter serves every Workday tenant: the tenant and site are derived
   from career_url, so no per-company code is needed.
   Endpoints: <base>/wday/cxs/<tenant>/<site>/jobs (POST search) and .../<externalPath> (detail).
   Both are public endpoints used by the tenant's own career site. */

import { classifyJob, countRejection, isEntryTitle, isSeniorTitle } from '../classification/index.js';
import { ISRAEL_CITY_HINTS, locationFilterMatches, anyIsraelFilter } from '../normalization/location.js';
import { stripHtml } from '../normalization/text.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchJson, inBatches, userAgentFor } from './http.js';

export interface WorkdayConfig {
  tenant: string;
  site: string;
  base: string;
}

/** Parse a Workday careers URL into { tenant, site, base }.
    e.g. https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite */
export function deriveWorkdayConfig(careerUrl: string): WorkdayConfig | null {
  const m = (careerUrl || '').match(/https:\/\/([a-z0-9_-]+)\.wd\d+\.[a-z0-9.-]+\/([a-z0-9_-]+)/i);
  if (!m) return null;
  return { tenant: m[1].toLowerCase(), site: m[2], base: new URL(careerUrl).origin };
}

export function workdayJobsUrl(config: WorkdayConfig): string {
  return `${config.base}/wday/cxs/${config.tenant}/${config.site}/jobs`;
}

export function workdayDetailUrl(config: WorkdayConfig, externalPath: string): string {
  return `${config.base}/wday/cxs/${config.tenant}/${config.site}${externalPath}`;
}

/** Official requisition id from the posting path tail (e.g. ..._JR0284988, ..._R2611165). */
export function extractWorkdayReqId(externalPath: string): string | null {
  const m = (externalPath || '').match(/_([A-Z]{1,3}\d+)\/?$/i);
  return m ? m[1] : null;
}

function searchBody(offset: number, searchText: string, appliedFacets: Record<string, string[]> = {}) {
  return { appliedFacets, limit: 20, offset, searchText: searchText || '' };
}

interface WorkdayListPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
}

interface WorkdayDetail {
  jobPostingInfo?: {
    title?: string;
    jobReqId?: string;
    location?: string;
    additionalLocations?: string[];
    externalUrl?: string;
    jobDescription?: string;
  };
}

/**
 * Full Workday pipeline:
 *   location-scoped search -> list-stage seniority reject ->
 *   per-posting detail fetch (location verification + content) -> shared classification.
 *
 * Location handling has three layers because tenants expose location data inconsistently:
 *   a. facet-filtered searches (the tenant's own location facets),
 *   b. text search per filter term,
 *   c. bare-city fallback when the tenant exposes no matching facet
 *      (some tenants list only "Yokneam" with no country data anywhere).
 */
export async function fetchWorkdayJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const config = deriveWorkdayConfig(source.career_url);
  if (!config) throw new Error('Could not derive Workday tenant/site from career_url');

  const maxList = Number(source.options?.max_list ?? 2000);
  const maxDetails = Number(source.options?.max_details ?? 500);
  const isIsrael = ctx.isIsrael || anyIsraelFilter(ctx.locations);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };

  const listMap = new Map<string, WorkdayListPosting>();

  const runSearch = async (
    bodyFor: (offset: number) => Record<string, unknown>,
  ): Promise<void> => {
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    let guard = 0;
    while (guard++ < 200) {
      const data = await fetchJson<{ total?: number; jobPostings?: WorkdayListPosting[] }>(
        workdayJobsUrl(config),
        ua,
        { method: 'POST', headers, body: JSON.stringify(bodyFor(offset)) },
      );
      const postings = data.jobPostings || [];
      if (typeof data.total === 'number') total = data.total;
      for (const p of postings) {
        if (p.externalPath) listMap.set(p.externalPath, p);
      }
      offset += 20;
      if (postings.length < 20 || offset >= Math.min(total, maxList) || listMap.size >= maxList) break;
    }
  };

  // (a) Resolve the tenant's own location facets. Best effort: text search is the fallback.
  const facetPairs: { key: string; id: string }[] = [];
  if (ctx.locations.length > 0) {
    try {
      const data = await fetchJson<{ facets?: any[] }>(workdayJobsUrl(config), ua, {
        method: 'POST',
        headers,
        body: JSON.stringify(searchBody(0, '')),
      });
      const groups = Array.isArray(data.facets) ? data.facets : [];
      for (const group of groups) {
        if (group.facetParameter !== 'locationMainGroup') continue;
        for (const sub of group.values || []) {
          for (const value of sub.values || []) {
            if (locationFilterMatches(ctx.locations, value.descriptor, isIsrael)) {
              facetPairs.push({ key: sub.facetParameter, id: value.id });
            }
          }
        }
      }
    } catch {
      facetPairs.length = 0;
    }
  }

  // (b) Text search per filter term, or one unfiltered pass.
  if (ctx.locations.length > 0) {
    for (const term of ctx.locations) {
      await runSearch((offset) => searchBody(offset, term));
    }
  } else {
    await runSearch((offset) => searchBody(offset, ''));
  }

  // (a again) Facet-filtered searches.
  for (const pair of facetPairs) {
    await runSearch((offset) => searchBody(offset, '', { [pair.key]: [pair.id] }));
  }

  // (c) Bare-city fallback.
  if (ctx.locations.length > 0 && facetPairs.length === 0 && isIsrael) {
    for (const city of ISRAEL_CITY_HINTS) {
      await runSearch((offset) => searchBody(offset, city));
    }
  }

  // 2. List-stage rejection: seniority is fully decidable from the title alone, so those
  //    postings never trigger a detail fetch. Entry-level titles are never rejected here.
  const rejected: Record<string, number> = {};
  const candidates: WorkdayListPosting[] = [];
  for (const posting of listMap.values()) {
    if (!isEntryTitle(posting.title) && isSeniorTitle(posting.title)) {
      countRejection(rejected, 'senior_title');
      continue;
    }
    candidates.push(posting);
  }

  // 3. Detail fetch: the list stage has no location truth ("2 Locations") and no content.
  const details = await inBatches(
    candidates.slice(0, maxDetails),
    6,
    (posting) => fetchJson<WorkdayDetail>(workdayDetailUrl(config, posting.externalPath as string), ua),
  );

  const jobs: NormalizedJob[] = [];
  let inLocation = 0;

  details.forEach((result, index) => {
    if (result.status !== 'fulfilled' || !result.value?.jobPostingInfo) return;
    const info = result.value.jobPostingInfo;
    const listPosting = candidates[index];

    // Location verification against the real posting locations. The list text is included
    // because some tenants shorten the detail location (e.g. "ISR-...").
    const locations = [info.location, ...(info.additionalLocations || []), listPosting.locationsText];
    if (
      ctx.locations.length > 0 &&
      !locations.some((l) => locationFilterMatches(ctx.locations, l, isIsrael))
    ) {
      countRejection(rejected, 'not_in_location');
      return;
    }
    inLocation += 1;

    const title = info.title || listPosting.title || '';
    const contentText = stripHtml(info.jobDescription);
    const verdict = classifyJob(title, null, contentText);
    if (!verdict.relevant || !verdict.job_type) {
      countRejection(rejected, verdict.reason || 'not_relevant_area');
      return;
    }

    jobs.push({
      external_job_id:
        info.jobReqId || extractWorkdayReqId(listPosting.externalPath as string) || '',
      requisition_id: null,
      title,
      location: info.location || listPosting.locationsText || '',
      original_url: info.externalUrl || `${config.base}/${config.site}${listPosting.externalPath}`,
      posted_date: null, // Workday exposes only relative text ("Posted 3 Days Ago")
      job_type: verdict.job_type,
      role_type: null,
      content_text: contentText,
    });
  });

  return { total_fetched: listMap.size, in_location: inLocation, jobs: jobs.slice(0, ctx.maxItems), rejected };
}