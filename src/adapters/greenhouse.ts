/* Greenhouse public board API adapter.
   Endpoints: boards-api.greenhouse.io/v1/boards/<token>/jobs[/<id>] — public, no key.
   The list carries title/location/url; content is fetched per posting only for titles that
   the seniority rules cannot decide on their own. */

import { classifyJob, countRejection, isEntryTitle, isSeniorTitle } from '../classification/index.js';
import { locationFilterMatches } from '../normalization/location.js';
import { stripHtml } from '../normalization/text.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchJson, inBatches, userAgentFor } from './http.js';

const GH_API = 'https://boards-api.greenhouse.io/v1/boards';

interface GreenhouseMetadata {
  name?: string;
  value_type?: string;
  value?: string | null;
}

interface GreenhouseListJob {
  id: number | string;
  title?: string;
  requisition_id?: string | null;
  absolute_url?: string;
  first_published?: string | null;
  location?: { name?: string };
  metadata?: GreenhouseMetadata[];
}

/** Extract the board token from a Greenhouse URL (boards.greenhouse.io/<token>, job-boards.greenhouse.io/<token>). */
export function deriveGreenhouseBoardToken(careerUrl: string): string | null {
  const m = (careerUrl || '').match(/greenhouse\.io\/([a-z0-9_-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Fetch and classify every relevant posting on one Greenhouse board. */
export async function fetchGreenhouseJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const boardToken = deriveGreenhouseBoardToken(source.career_url);
  if (!boardToken) throw new Error('Could not derive a Greenhouse board token from career_url');

  const list = await fetchJson<{ jobs?: GreenhouseListJob[] }>(`${GH_API}/${boardToken}/jobs`, ua);
  const raw = list.jobs || [];

  const inLocation: {
    external_job_id: string;
    requisition_id: string | null;
    title: string;
    location: string;
    original_url: string;
    posted_date: string | null;
    roleType: string | null;
    contentText: string | null;
  }[] = [];
  const needContentIds: string[] = [];

  for (const job of raw) {
    const locationText = job.location?.name || '';
    if (ctx.locations.length > 0 && !locationFilterMatches(ctx.locations, locationText, ctx.isIsrael)) {
      continue;
    }
    const roleTypeMeta = (job.metadata || []).find(
      (m) => m.name === 'Role Type' && m.value_type === 'single_select',
    );
    const entry = {
      external_job_id: String(job.id),
      requisition_id: job.requisition_id ? String(job.requisition_id) : null,
      title: job.title || '',
      location: locationText,
      original_url: job.absolute_url || '',
      posted_date: job.first_published ? job.first_published.slice(0, 10) : null,
      roleType: roleTypeMeta?.value ?? null,
      contentText: null as string | null,
    };
    inLocation.push(entry);
    if (!isSeniorTitle(entry.title) && !isEntryTitle(entry.title) && !entry.roleType) {
      needContentIds.push(entry.external_job_id);
    }
  }

  // Posting content, only for titles the seniority rules cannot classify alone.
  const contentById: Record<string, string> = {};
  const results = await inBatches(needContentIds, 6, (id) =>
    fetchJson<{ content?: string }>(`${GH_API}/${boardToken}/jobs/${id}`, ua),
  );
  results.forEach((r, index) => {
    if (r.status === 'fulfilled' && r.value) {
      contentById[needContentIds[index]] = stripHtml(r.value.content || '');
    }
  });

  const rejected: Record<string, number> = {};
  const jobs: NormalizedJob[] = [];
  for (const job of inLocation) {
    const isEntry = isEntryTitle(job.title);
    if (!isEntry && isSeniorTitle(job.title)) {
      countRejection(rejected, 'senior_title');
      continue;
    }
    if (!isEntry && job.roleType && /experienced/i.test(job.roleType)) {
      countRejection(rejected, 'experienced_role_type');
      continue;
    }
    const contentText = job.contentText || contentById[job.external_job_id] || '';
    const verdict = classifyJob(job.title, job.roleType, contentText);
    if (!verdict.relevant || !verdict.job_type) {
      countRejection(rejected, verdict.reason || 'not_relevant_area');
      continue;
    }
    jobs.push({
      external_job_id: job.external_job_id,
      requisition_id: job.requisition_id,
      title: job.title,
      location: job.location,
      original_url: job.original_url,
      posted_date: job.posted_date,
      job_type: verdict.job_type,
      role_type: job.roleType,
      content_text: contentText,
    });
  }

  return {
    total_fetched: raw.length,
    in_location: inLocation.length,
    jobs: jobs.slice(0, ctx.maxItems),
    rejected,
  };
}