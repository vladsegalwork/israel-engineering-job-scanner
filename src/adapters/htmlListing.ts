/* Generic HTML listing adapter.
   Covers career pages that render a server-side list of postings, where each card carries a
   title, a link and (usually) a location, and the description lives on the detail page.
   Everything is configured — no company-specific code.

   Required options.listing_pattern: a regex (global matching is applied by the adapter) with
   named groups `url` and `title`, plus optional `location`, run against the listing page HTML.
   Optional options.detail_pattern: a regex whose first capture group is the description block.
   Optional options.max_details: how many detail pages to read (default 40).

   Example (illustrative shape, not tied to any specific site):
     "listing_pattern": "<h3 class=\"title\">(?<title>[^<]{2,160})</h3>[\\s\\S]{0,200}?href=\"(?<url>[^\"]+)\""
*/

import { classifyJob, countRejection } from '../classification/index.js';
import { anyIsraelFilter, findIsraelCity, locationMatchesLoose } from '../normalization/location.js';
import { stripHtml } from '../normalization/text.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchText, fetchTextOrNull, inBatches, userAgentFor } from './http.js';

export async function fetchHtmlListingJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const pattern = String(source.options?.listing_pattern ?? '');
  if (!pattern) {
    throw new Error('html_listing requires options.listing_pattern (named groups: url, title)');
  }
  const detailPattern = source.options?.detail_pattern
    ? String(source.options.detail_pattern)
    : null;
  const maxDetails = Number(source.options?.max_details ?? 40);
  const isIsrael = anyIsraelFilter(ctx.locations);

  const listingUrl = source.career_url;
  const html = await fetchText(listingUrl, ua, { timeout: 20000 });

  const matcher = new RegExp(pattern, pattern.includes('(?<') ? 'g' : 'gi');
  const items: { url: string; title: string; location: string }[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(matcher)) {
    const groups = (match.groups || {}) as Record<string, string | undefined>;
    const url = groups.url;
    const title = (groups.title || '').trim();
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    items.push({ url, title, location: (groups.location || '').trim() });
  }
  if (items.length === 0) {
    throw new Error('html_listing pattern matched no postings on the listing page');
  }

  const rejected: Record<string, number> = {};
  const candidates = items.filter((item) => {
    if (ctx.locations.length === 0) return true;
    const haystack = `${item.location} ${item.title}`;
    if (locationMatchesLoose(ctx.locations, haystack, isIsrael)) return true;
    countRejection(rejected, 'not_in_location');
    return false;
  });

  const detailBodies = await inBatches(
    candidates.slice(0, maxDetails),
    6,
    (item) => fetchTextOrNull(item.url, ua),
  );

  const jobs: NormalizedJob[] = [];
  if (detailPattern) {
    const detailRe = new RegExp(detailPattern, 'i');
    candidates.forEach((item, index) => {
      const result = detailBodies[index];
      const page = result.status === 'fulfilled' ? result.value : null;
      const block = page ? (page.match(detailRe) || [])[1] || page : '';
      const contentText = stripHtml(block);
      const verdict = classifyJob(item.title, null, contentText);
      if (!verdict.relevant || !verdict.job_type) {
        countRejection(rejected, verdict.reason || 'not_relevant_area');
        return;
      }
      jobs.push({
        external_job_id: (item.url.match(/([A-Za-z0-9.]+)\/?$/) || [])[1] || item.url,
        requisition_id: null,
        title: item.title,
        location: item.location || findIsraelCity(`${item.title} ${contentText}`) || '',
        original_url: item.url,
        posted_date: null,
        job_type: verdict.job_type,
        role_type: null,
        content_text: contentText,
      });
    });
  } else {
    for (const item of candidates) {
      const contentText = '';
      const verdict = classifyJob(item.title, null, contentText);
      if (!verdict.relevant || !verdict.job_type) {
        countRejection(rejected, verdict.reason || 'not_relevant_area');
        continue;
      }
      jobs.push({
        external_job_id: (item.url.match(/([A-Za-z0-9.]+)\/?$/) || [])[1] || item.url,
        requisition_id: null,
        title: item.title,
        location: item.location,
        original_url: item.url,
        posted_date: null,
        job_type: verdict.job_type,
        role_type: null,
        content_text: contentText,
      });
    }
  }

  return {
    total_fetched: items.length,
    in_location: candidates.length,
    jobs: jobs.slice(0, ctx.maxItems),
    rejected,
  };
}