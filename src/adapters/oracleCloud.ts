/* Oracle Cloud Recruiting (RSC) adapter. Public keyless REST endpoint behind the Candidate
   Experience career sites:
     /hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber=<site>
   The list response already carries short descriptions and a dedicated country code, so no
   per-posting detail fetches are needed. */

import { classifyJob, countRejection } from '../classification/index.js';
import { anyIsraelFilter, locationFilterMatches } from '../normalization/location.js';
import { stripHtml } from '../normalization/text.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchJson, userAgentFor } from './http.js';

export interface OracleCloudConfig {
  base: string;
  site: string;
}

/** Derive { base, site } from a Candidate Experience careers URL.
    e.g. https://<tenant>.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/jobs */
export function deriveOracleCloudConfig(careerUrl: string): OracleCloudConfig | null {
  const m = (careerUrl || '').match(
    /https:\/\/([a-z0-9.-]+)\/hcmUI\/CandidateExperience\/(?:[a-z-]+\/)?sites\/([A-Za-z0-9_]+)/i,
  );
  if (!m) return null;
  return { base: `https://${m[1]}`, site: m[2] };
}

interface OracleRequisition {
  Id?: number | string;
  Title?: string;
  PrimaryLocation?: string;
  PrimaryLocationCountry?: string;
  PostedDate?: string;
  ShortDescriptionStr?: string;
  ExternalQualificationsStr?: string;
  ExternalResponsibilitiesStr?: string;
}

export async function fetchOracleCloudJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const config = deriveOracleCloudConfig(source.career_url);
  if (!config) throw new Error('Could not derive an Oracle Cloud site from career_url');

  const maxJobs = Number(source.options?.max_items ?? 2000);
  const isIsrael = anyIsraelFilter(ctx.locations);

  const requisitions: OracleRequisition[] = [];
  let offset = 0;
  let guard = 0;
  while (guard++ < 15) {
    const url =
      `${config.base}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
      `?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${config.site},limit=200,offset=${offset}`;
    const data = await fetchJson<{ items?: { requisitionList?: OracleRequisition[] }[] }>(url, ua);
    const page = data.items?.[0]?.requisitionList || [];
    requisitions.push(...page);
    offset += page.length;
    if (page.length < 200 || requisitions.length >= maxJobs) break;
  }

  const rejected: Record<string, number> = {};
  const jobs: NormalizedJob[] = [];
  let inLocation = 0;

  for (const req of requisitions) {
    // Israel is matched by the dedicated country code or by the location text
    // (bare city names fall through to the shared Israel city dictionary).
    const country = (req.PrimaryLocationCountry || '').toUpperCase();
    const inFilter =
      ctx.locations.length === 0
        ? true
        : (isIsrael && country === 'IL') ||
          locationFilterMatches(ctx.locations, req.PrimaryLocation, isIsrael);
    if (ctx.locations.length > 0 && !inFilter) {
      countRejection(rejected, 'not_in_location');
      continue;
    }
    if (isIsrael || country === 'IL') inLocation += 1;

    const title = req.Title || '';
    const contentText = stripHtml(
      [req.ShortDescriptionStr, req.ExternalQualificationsStr, req.ExternalResponsibilitiesStr]
        .filter(Boolean)
        .join('\n'),
    );
    const verdict = classifyJob(title, null, contentText);
    if (!verdict.relevant || !verdict.job_type) {
      countRejection(rejected, verdict.reason || 'not_relevant_area');
      continue;
    }

    jobs.push({
      external_job_id: req.Id != null ? String(req.Id) : '',
      requisition_id: null,
      title,
      location: req.PrimaryLocation || '',
      original_url: `${config.base}/hcmUI/CandidateExperience/en/sites/${config.site}/job/${req.Id}`,
      posted_date: req.PostedDate || null,
      job_type: verdict.job_type,
      role_type: null,
      content_text: contentText,
    });
  }

  return { total_fetched: requisitions.length, in_location: inLocation, jobs: jobs.slice(0, ctx.maxItems), rejected };
}