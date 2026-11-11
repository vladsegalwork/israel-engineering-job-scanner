/* BambooHR job-board adapter. Public keyless JSON list endpoint:
     https://<tenant>.bamboohr.com/careers/list
   Descriptions render client-side on the detail page and are not extractable keylessly, so
   classification runs on the title plus department / employment-type metadata
   (relevance only — never an entry-level bypass). */

import { classifyJob, countRejection } from '../classification/index.js';
import { anyIsraelFilter, locationFilterMatches } from '../normalization/location.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchJson, userAgentFor } from './http.js';

export function deriveBambooHrSubdomain(careerUrl: string): string | null {
  const m = (careerUrl || '').match(/https:\/\/([a-z0-9-]+)\.bamboohr\.com/i);
  return m ? m[1] : null;
}

interface BambooJob {
  id?: number | string;
  jobOpeningName?: string;
  departmentLabel?: string;
  employmentStatusLabel?: string;
  location?: { city?: string; state?: string };
}

export async function fetchBambooHrJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const subdomain = deriveBambooHrSubdomain(source.career_url);
  if (!subdomain) throw new Error('Could not derive a BambooHR subdomain from career_url');

  const isIsrael = anyIsraelFilter(ctx.locations);
  const data = await fetchJson<{ result?: BambooJob[] }>(
    `https://${subdomain}.bamboohr.com/careers/list`,
    ua,
  );
  const list = data.result || [];

  const rejected: Record<string, number> = {};
  const jobs: NormalizedJob[] = [];
  let inLocation = 0;

  for (const item of list) {
    const locationText = [item.location?.city, item.location?.state].filter(Boolean).join(', ');
    // Location text is a bare city/state ("Yehud, Merkaz") — matched via the city dictionary.
    if (ctx.locations.length > 0 && !locationFilterMatches(ctx.locations, locationText, isIsrael)) {
      countRejection(rejected, 'not_in_location');
      continue;
    }
    inLocation += 1;

    const title = item.jobOpeningName || '';
    const contentText = [item.departmentLabel, item.employmentStatusLabel].filter(Boolean).join('. ');
    const verdict = classifyJob(title, null, contentText);
    if (!verdict.relevant || !verdict.job_type) {
      countRejection(rejected, verdict.reason || 'not_relevant_area');
      continue;
    }

    jobs.push({
      external_job_id: item.id != null ? String(item.id) : '',
      requisition_id: null,
      title,
      location: locationText,
      original_url: `https://${subdomain}.bamboohr.com/careers/${item.id}`,
      posted_date: null, // not exposed by the public list endpoint
      job_type: verdict.job_type,
      role_type: null,
      content_text: contentText,
    });
  }

  return { total_fetched: list.length, in_location: inLocation, jobs: jobs.slice(0, ctx.maxItems), rejected };
}