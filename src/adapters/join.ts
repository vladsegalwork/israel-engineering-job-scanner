/* JOIN (join.com) adapter. No keyless list API: the public company page embeds its full job
   list in Next.js `__NEXT_DATA__`, and each job page embeds the full description.
   The company slug is derived from career_url (https://join.com/companies/<slug>). */

import { classifyJob, countRejection } from '../classification/index.js';
import { anyIsraelFilter, locationFilterMatches } from '../normalization/location.js';
import { findDescriptionField, parseNextData, stripHtml } from '../normalization/text.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchText, inBatches, userAgentFor } from './http.js';

export function deriveJoinCompanySlug(careerUrl: string): string | null {
  const m = (careerUrl || '').match(/join\.com\/companies\/([^/?#]+)/i);
  return m ? m[1] : null;
}

interface JoinListItem {
  id?: number | string;
  idParam?: string;
  title?: string;
  createdAt?: string;
  city?: { cityName?: string; countryName?: string };
  country?: { iso3166?: string };
}

export async function fetchJoinJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const slug = deriveJoinCompanySlug(source.career_url);
  if (!slug) throw new Error('Could not derive a JOIN company slug from career_url');

  const maxDetails = Number(source.options?.max_details ?? 200);
  const isIsrael = anyIsraelFilter(ctx.locations);

  const html = await fetchText(`https://join.com/companies/${slug}`, ua, { timeout: 20000 });
  const listData = parseNextData(html);
  const items: JoinListItem[] = listData?.props?.pageProps?.initialState?.jobs?.items || [];

  // Location filter at the list stage: city and country are both provided.
  const inLocation: JoinListItem[] = [];
  for (const item of items) {
    const locationText = [item.city?.cityName, item.city?.countryName, item.country?.iso3166]
      .filter(Boolean)
      .join(', ');
    if (ctx.locations.length > 0 && !locationFilterMatches(ctx.locations, locationText, isIsrael)) {
      continue;
    }
    inLocation.push(item);
  }

  // Detail pages carry the description needed for content-based classification.
  const details = await inBatches(inLocation.slice(0, maxDetails), 6, (item) =>
    fetchText(`https://join.com/jobs/${item.idParam || item.id}`, ua).then(
      (page) => parseNextData(page)?.props?.pageProps,
    ),
  );

  const rejected: Record<string, number> = {};
  const jobs: NormalizedJob[] = [];

  details.forEach((result, index) => {
    if (result.status !== 'fulfilled' || !result.value) return;
    const item = inLocation[index];
    const contentText = stripHtml(findDescriptionField(result.value) || '');
    const verdict = classifyJob(item.title || '', null, contentText);
    if (!verdict.relevant || !verdict.job_type) {
      countRejection(rejected, verdict.reason || 'not_relevant_area');
      return;
    }
    const createdAt = typeof item.createdAt === 'string' ? item.createdAt : null;
    jobs.push({
      external_job_id: item.id != null ? String(item.id) : '',
      requisition_id: null,
      title: item.title || '',
      location: [item.city?.cityName, item.city?.countryName].filter(Boolean).join(', '),
      original_url: `https://join.com/jobs/${item.idParam || item.id}`,
      posted_date: createdAt && /^\d{4}-\d{2}-\d{2}/.test(createdAt) ? createdAt.slice(0, 10) : null,
      job_type: verdict.job_type,
      role_type: null,
      content_text: contentText,
    });
  });

  return { total_fetched: items.length, in_location: inLocation.length, jobs: jobs.slice(0, ctx.maxItems), rejected };
}