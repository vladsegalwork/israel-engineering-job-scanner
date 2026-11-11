/* WordPress positions adapter. Many company career pages are a WordPress custom post type
   exposed by the public REST API:  /wp-json/wp/v2/<cpt>?per_page=100
   The list gives title + link; the detail page gives description and location.
   Options: cpt_candidates (default: position, positions, jobs, job, vacancy), max_details. */

import { classifyJob, countRejection } from '../classification/index.js';
import { anyIsraelFilter, findIsraelCity, locationFilterMatches } from '../normalization/location.js';
import { stripHtml } from '../normalization/text.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchTextOrNull, inBatches, userAgentFor } from './http.js';

const DEFAULT_CPT_CANDIDATES = ['position', 'positions', 'jobs', 'job', 'vacancy'];

interface WpPost {
  id: number;
  date?: string;
  link: string;
  title?: { rendered?: string };
}

export async function fetchWpJsonJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const maxDetails = Number(source.options?.max_details ?? 60);
  const cptCandidates =
    (source.options?.cpt_candidates as string[] | undefined) || DEFAULT_CPT_CANDIDATES;
  const isIsrael = anyIsraelFilter(ctx.locations);

  let origin: string;
  try {
    origin = new URL(source.career_url).origin;
  } catch {
    throw new Error(`Invalid career_url: ${source.career_url}`);
  }

  let list: WpPost[] | null = null;
  for (const cpt of cptCandidates) {
    const body = await fetchTextOrNull(`${origin}/wp-json/wp/v2/${cpt}?per_page=100`, ua);
    if (body === null) continue;
    try {
      const parsed = JSON.parse(body);
      if (
        Array.isArray(parsed) &&
        parsed.every((p: WpPost) => p && p.title && p.link !== undefined)
      ) {
        list = parsed;
        break;
      }
    } catch {
      /* try the next candidate */
    }
  }
  if (!list) throw new Error('No WordPress positions post type found under /wp-json/wp/v2');

  const detailMap: Record<number, { location: string | null; content: string } | undefined> = {};
  const details = await inBatches(list.slice(0, maxDetails), 6, async (post: WpPost) => {
    const page = await fetchTextOrNull(post.link, ua);
    if (!page) return null;
    const location =
      (page.match(/<div class="location">[\s\S]{0,200}?<span>\s*([^<]+?)\s*<\/span>/) || [])[1] ||
      null;
    const block =
      (page.match(/<div class="job-info-wrapper"[\s\S]*?(?=<\/section>|<footer|<\/main>)/) || [])[0] ||
      page;
    return { location, content: stripHtml(block) };
  });
  details.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value) {
      detailMap[list![index].id] = result.value;
    }
  });

  const rejected: Record<string, number> = {};
  const jobs: NormalizedJob[] = [];
  let inLocation = 0;

  for (const post of list) {
    const title = stripHtml(post.title?.rendered || '');
    const detail = detailMap[post.id];
    const location = detail?.location || findIsraelCity(title) || '';
    if (
      ctx.locations.length > 0 &&
      !locationFilterMatches(ctx.locations, location || 'Israel', isIsrael)
    ) {
      countRejection(rejected, 'not_in_location');
      continue;
    }
    inLocation += 1;

    const contentText = detail?.content || '';
    const verdict = classifyJob(title, null, contentText);
    if (!verdict.relevant || !verdict.job_type) {
      countRejection(rejected, verdict.reason || 'not_relevant_area');
      continue;
    }

    jobs.push({
      external_job_id: String(post.id),
      requisition_id: null,
      title,
      location: location || 'Israel',
      original_url: post.link,
      posted_date: post.date ? post.date.slice(0, 10) : null,
      job_type: verdict.job_type,
      role_type: null,
      content_text: contentText,
    });
  }

  return { total_fetched: list.length, in_location: inLocation, jobs: jobs.slice(0, ctx.maxItems), rejected };
}