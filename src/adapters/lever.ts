/* Lever public postings API adapter.
   Endpoint: <origin>/v0/postings/<token>?mode=json — public, no key.
   EU-hosted boards (jobs.eu.lever.co) serve the same v0 API from their own origin.
   The response already carries the full description, so no detail fetches are needed. */

import { classifyJob, countRejection } from '../classification/index.js';
import { locationFilterMatches } from '../normalization/location.js';
import { stripHtml } from '../normalization/text.js';
import type { AdapterContext, AdapterResult, NormalizedJob, SourceConfig } from '../types.js';
import { fetchJson, userAgentFor } from './http.js';

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  createdAt?: number;
  description?: string;
  descriptionPlain?: string;
  categories?: { location?: string; team?: string; commitment?: string };
}

/** Extract the board token from a Lever URL (jobs.lever.co/<token>, jobs.eu.lever.co/<token>). */
export function deriveLeverBoardToken(careerUrl: string): string | null {
  const m = (careerUrl || '').match(/lever\.co\/([a-z0-9_-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

/** Public postings endpoint for a board, honouring the EU origin when the board lives there. */
export function leverPostingsUrl(careerUrl: string, boardToken: string): string {
  try {
    const u = new URL(careerUrl);
    const host = u.hostname.replace(/^jobs\./, '');
    if (/^(eu\.)?lever\.co$/.test(host)) {
      return `${u.origin}/v0/postings/${boardToken}?mode=json`;
    }
  } catch {
    /* fall through to the canonical API host */
  }
  return `https://api.lever.co/v0/postings/${boardToken}?mode=json`;
}

/** Normalize one Lever posting into the scanner's common job shape. */
export function normalizeLeverPosting(posting: LeverPosting): {
  external_job_id: string;
  requisition_id: null;
  title: string;
  location: string;
  original_url: string;
  posted_date: string | null;
  roleType: null;
  contentText: string;
} {
  const contentText = (posting.descriptionPlain || stripHtml(posting.description) || '').trim();
  return {
    external_job_id: String(posting.id || ''),
    requisition_id: null,
    title: posting.text || '',
    location: posting.categories?.location || '',
    original_url: posting.hostedUrl || '',
    posted_date: posting.createdAt ? new Date(posting.createdAt).toISOString().slice(0, 10) : null,
    roleType: null,
    contentText,
  };
}

/** Fetch and classify every relevant posting on one Lever board. */
export async function fetchLeverJobs(
  source: SourceConfig,
  ctx: AdapterContext,
): Promise<AdapterResult> {
  const ua = userAgentFor(source);
  const boardToken = deriveLeverBoardToken(source.career_url);
  if (!boardToken) throw new Error('Could not derive a Lever board token from career_url');

  const postings = await fetchJson<LeverPosting[]>(
    leverPostingsUrl(source.career_url, boardToken),
    ua,
  );
  const raw = Array.isArray(postings) ? postings.map(normalizeLeverPosting) : [];

  const rejected: Record<string, number> = {};
  const jobs: NormalizedJob[] = [];
  let inLocation = 0;

  for (const job of raw) {
    if (ctx.locations.length > 0 && !locationFilterMatches(ctx.locations, job.location, ctx.isIsrael)) {
      continue;
    }
    inLocation += 1;
    const verdict = classifyJob(job.title, job.roleType, job.contentText);
    if (!verdict.relevant || !verdict.job_type) {
      countRejection(rejected, verdict.reason || 'not_relevant_area');
      continue;
    }
    jobs.push({ ...job, job_type: verdict.job_type });
  }

  return { total_fetched: raw.length, in_location: inLocation, jobs: jobs.slice(0, ctx.maxItems), rejected };
}