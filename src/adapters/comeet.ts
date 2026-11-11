/* Comeet board adapter. No public JSON API: the SSR board page embeds its full position list
   in a `COMPANY_POSITIONS_DATA` array, and each position carries its own detail fields.
   Board URL shape: https://www.comeet.com/jobs/<slug>/<board-uid>  (uid like 6A.002) */

import { classifyJob, countRejection } from '../classification/index.js';
import { anyIsraelFilter, locationFilterMatches } from '../normalization/location.js';
import { extractJsonArrayAfterMarker, stripHtml } from '../normalization/text.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchText, userAgentFor } from './http.js';

interface ComeetPosition {
  uid?: string;
  name?: string;
  experience_level?: string;
  url_comeet_hosted_page?: string;
  url_recruit_hosted_page?: string;
  location?: { country?: string; city?: string; name?: string };
  custom_fields?: { details?: { value?: string }[] };
}

/** Extract the board uid from a Comeet board URL (e.g. "6A.002"). */
export function deriveComeetBoardToken(careerUrl: string): string | null {
  const m = (careerUrl || '').match(/comeet\.com\/jobs\/[a-z0-9-]+\/([A-F0-9]{2}\.[A-F0-9]{3})/i);
  return m ? m[1].toUpperCase() : null;
}

export async function fetchComeetJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const boardToken = deriveComeetBoardToken(source.career_url);
  if (!boardToken) throw new Error('Could not derive a Comeet board uid from career_url');

  const isIsrael = anyIsraelFilter(ctx.locations);
  const html = await fetchText(source.career_url, ua, { timeout: 20000 });
  const positions =
    extractJsonArrayAfterMarker(html, 'COMPANY_POSITIONS_DATA = ') ||
    extractJsonArrayAfterMarker(html, 'COMPANY_POSITIONS_DATA=');
  if (!positions) {
    throw new Error('Could not extract the Comeet position list from the board page');
  }

  const rejected: Record<string, number> = {};
  const jobs: NormalizedJob[] = [];
  let inLocation = 0;

  for (const position of positions as ComeetPosition[]) {
    const title = position.name || '';
    const country = position.location?.country || '';
    const city = position.location?.city || '';
    const locationText = position.location?.name || city || '';

    if (
      ctx.locations.length > 0 &&
      !(country === 'IL' || locationFilterMatches(ctx.locations, `${city} ${locationText}`, isIsrael))
    ) {
      countRejection(rejected, 'not_in_location');
      continue;
    }
    inLocation += 1;

    const details = (position.custom_fields?.details || []).map((d) => d.value || '').join(' ');
    const contentText = stripHtml(details);
    const verdict = classifyJob(title, position.experience_level, contentText);
    if (!verdict.relevant || !verdict.job_type) {
      countRejection(rejected, verdict.reason || 'not_relevant_area');
      continue;
    }

    jobs.push({
      external_job_id: position.uid || '',
      requisition_id: null,
      title,
      location:
        `${city}${locationText && city && locationText !== city ? ` (${locationText})` : ''}` || '',
      original_url: position.url_comeet_hosted_page || position.url_recruit_hosted_page || '',
      posted_date: null,
      job_type: verdict.job_type,
      role_type: position.experience_level || null,
      content_text: contentText,
    });
  }

  return { total_fetched: positions.length, in_location: inLocation, jobs: jobs.slice(0, ctx.maxItems), rejected };
}