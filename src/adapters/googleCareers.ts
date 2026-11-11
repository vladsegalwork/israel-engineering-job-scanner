/* Google Careers adapter. No public API: the server-rendered results page embeds each job in
   AF_initDataCallback blobs. The adapter walks the results page with the site's own level and
   degree filters, then keeps postings whose location data carries the target country code.
   Options: max_pages (default 3), target_level (default "EARLY"), degree (default "BACHELOR"),
   country_code (default "IL"). */

import { classifyJob, countRejection } from '../classification/index.js';
import { decodeJsonString } from '../normalization/text.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchText, userAgentFor } from './http.js';

const RESULTS_URL = 'https://www.google.com/about/careers/applications/jobs/results';

export async function fetchGoogleCareersJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const maxPages = Number(source.options?.max_pages ?? 3);
  const targetLevel = String(source.options?.target_level ?? 'EARLY');
  const degree = String(source.options?.degree ?? 'BACHELOR');
  const countryCode = String(source.options?.country_code ?? 'IL');
  const locationTerm = ctx.locations[0] || 'Israel';

  const rejected: Record<string, number> = {};
  const jobs: NormalizedJob[] = [];
  let totalFetched = 0;
  let inLocation = 0;

  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchText(
      `${RESULTS_URL}?location=${encodeURIComponent(locationTerm)}` +
        `&target_level=${encodeURIComponent(targetLevel)}&degree=${encodeURIComponent(degree)}&page=${page}`,
      ua,
      { timeout: 20000 },
    );

    const blob = [...html.matchAll(/AF_initDataCallback\(([\s\S]*?)\);/g)]
      .map((m) => m[1])
      .find((b) => b.length > 10000);
    if (!blob) break;

    const starts: { index: number; id: string; titleRaw: string; urlRaw: string }[] = [];
    for (const m of blob.matchAll(/\["(\d{15,})","((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)"/g)) {
      starts.push({ index: m.index as number, id: m[1], titleRaw: m[2], urlRaw: m[3] });
    }
    if (starts.length === 0) break;

    for (let i = 0; i < starts.length; i++) {
      const record = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1].index : blob.length;
      const slice = blob.slice(record.index, end);
      totalFetched += 1;

      // Country filter: the record's locations array carries the ISO country code.
      if (ctx.locations.length > 0 && !slice.includes(`"${countryCode}"`)) {
        countRejection(rejected, 'not_in_location');
        continue;
      }
      inLocation += 1;

      const cityMatch = slice.match(/"([^"]+, Israel)"/);
      const location = cityMatch ? cityMatch[1] : 'Israel';
      const title = decodeJsonString(record.titleRaw);
      const url = decodeJsonString(record.urlRaw);
      const contentText = slice
        .replace(/\\u003c/gi, '<')
        .replace(/\\u003e/gi, '>')
        .replace(/\\u0026/gi, '&')
        .replace(/\\n|\\t/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');

      const verdict = classifyJob(title, null, contentText);
      if (!verdict.relevant || !verdict.job_type) {
        countRejection(rejected, verdict.reason || 'not_relevant_area');
        continue;
      }

      jobs.push({
        external_job_id: record.id,
        requisition_id: null,
        title,
        location,
        original_url: url,
        posted_date: null,
        job_type: verdict.job_type,
        role_type: null,
        content_text: contentText,
      });
    }
  }

  return { total_fetched: totalFetched, in_location: inLocation, jobs: jobs.slice(0, ctx.maxItems), rejected };
}