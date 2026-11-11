/* Generic sitemap + JSON-LD adapter.
   Covers career sites that publish a sitemap of job pages and embed schema.org JobPosting
   JSON-LD in each page. No company-specific code: the sitemap URL and the job URL shape are
   configuration.

   Options:
     sitemap_url       required  e.g. "https://careers.example.com/sitemap.xml"
     job_url_pattern   optional  regex with one capture group matching a job URL
                                 (default: any <loc> containing "/job/")
     location_pattern  optional  regex with one capture group matching the city slug inside
                                 a job URL (default: first path segment after "/job/")
     max_details       optional  how many job pages to read (default 60)
*/

import { classifyJob, countRejection, isEntryTitle, isSeniorTitle } from '../classification/index.js';
import { anyIsraelFilter, findIsraelCity, locationMatchesLoose } from '../normalization/location.js';
import { stripHtml } from '../normalization/text.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchText, inBatches, userAgentFor } from './http.js';

interface JobPostingLd {
  '@type'?: string;
  title?: string;
  description?: string;
  datePosted?: string;
  hiringOrganization?: { name?: string };
}

export async function fetchSitemapJsonLdJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const sitemapUrl = String(source.options?.sitemap_url ?? '');
  if (!sitemapUrl) throw new Error('sitemap_jsonld requires options.sitemap_url');

  const jobUrlPattern = source.options?.job_url_pattern
    ? new RegExp(String(source.options.job_url_pattern), 'gi')
    : /<loc>(https?:\/\/[^<]*\/job\/[^<]+)<\/loc>/gi;
  const cityPattern = source.options?.location_pattern
    ? new RegExp(String(source.options.location_pattern), 'i')
    : /\/job\/([a-z0-9-]+)\//i;
  const maxDetails = Number(source.options?.max_details ?? 60);
  const isIsrael = anyIsraelFilter(ctx.locations);

  const sitemap = await fetchText(sitemapUrl, ua, { timeout: 20000 });
  const jobUrls = [...new Set([...sitemap.matchAll(jobUrlPattern)].map((m) => m[1]))];

  // Group by city slug so the location filter can run before any detail fetch.
  const byCity = new Map<string, string[]>();
  for (const url of jobUrls) {
    const city = (url.match(cityPattern) || [])[1];
    if (!city) continue;
    if (!byCity.has(city)) byCity.set(city, []);
    (byCity.get(city) as string[]).push(url);
  }

  const rejected: Record<string, number> = {};
  const targets: string[] = [];
  for (const city of byCity.keys()) {
    const cityText = city.replace(/-/g, ' ');
    if (ctx.locations.length > 0 && !locationMatchesLoose(ctx.locations, cityText, isIsrael)) {
      countRejection(rejected, 'not_in_location');
      continue;
    }
    for (const url of byCity.get(city) as string[]) {
      if (targets.length >= maxDetails) break;
      // Sitemap-stage seniority reject: many titles are Sr/Staff/Principal.
      const slug = (url.match(/\/job\/[a-z0-9-]+\/([a-z0-9-]+)\//i) || [])[1] || '';
      const titleFromSlug = slug.replace(/-\d+$/, '').replace(/-/g, ' ');
      if (!isEntryTitle(titleFromSlug) && isSeniorTitle(titleFromSlug)) {
        countRejection(rejected, 'senior_title');
        continue;
      }
      targets.push(url);
    }
  }

  const pages = await inBatches(targets, 6, async (url) => {
    const html = await fetchText(url, ua);
    const raw = (html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/) || [])[1];
    if (!raw) return null;
    try {
      return { url, ld: JSON.parse(raw) as JobPostingLd };
    } catch {
      return null;
    }
  });

  const jobs: NormalizedJob[] = [];
  let inLocation = 0;

  for (const result of pages) {
    if (result.status !== 'fulfilled' || !result.value?.ld) continue;
    const { url, ld } = result.value;
    if (ld['@type'] !== 'JobPosting') continue;
    inLocation += 1;

    const title = ld.title || '';
    const contentText = stripHtml(ld.description || '');
    const city = (url.match(cityPattern) || [])[1] || '';
    const externalId = (url.match(/\/(\d+)\/?$/) || [])[1] || '';
    const requisition = (url.match(/\/([a-z0-9-]*?)-(\d{5,})\/(\d+)\/?$/i) || [])[2] || null;

    const verdict = classifyJob(title, null, contentText);
    if (!verdict.relevant || !verdict.job_type) {
      countRejection(rejected, verdict.reason || 'not_relevant_area');
      continue;
    }

    jobs.push({
      external_job_id: externalId,
      requisition_id: requisition,
      title,
      location:
        city.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ||
        findIsraelCity(url) ||
        '',
      original_url: url,
      posted_date: ld.datePosted ? ld.datePosted.slice(0, 10) : null,
      job_type: verdict.job_type,
      role_type: null,
      content_text: contentText,
    });
  }

  return { total_fetched: jobUrls.length, in_location: inLocation, jobs: jobs.slice(0, ctx.maxItems), rejected };
}