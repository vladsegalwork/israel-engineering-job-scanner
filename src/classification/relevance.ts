/* English relevance + seniority classification for EE / CE student and junior roles.
   Pure functions — no I/O, no configuration, no vendor coupling. */

import type { JobType } from '../types.js';

export type RejectionReason =
  | 'senior_title'
  | 'experienced_role_type'
  | 'not_entry_level'
  | 'not_relevant_area';

export interface Verdict {
  relevant: boolean;
  reason?: RejectionReason;
  job_type?: JobType;
}

/** Broad Electrical / Computer Engineering relevance keywords (title or content). */
export const RELEVANT_KEYWORDS = [
  'electrical engineering', 'computer engineering', 'hardware', 'silicon', 'semiconductor',
  'vlsi', 'asic', 'soc', 'physical design', 'rtl', 'verification', 'validation',
  'analog', 'mixed signal', 'fpga', 'embedded', 'firmware', 'board design', 'hardware design',
  'signal processing', 'systems engineer', 'test engineer', 'product engineer', 'dft',
  'logic design', 'ic design', 'chip', 'circuit',
];

/** Explicit seniority words that disqualify a title outright.
    Word-boundary matched, so "hardware", "expertise" or "headset" are never caught by accident. */
export const SENIOR_TITLE_WORDS = [
  'senior', 'staff', 'principal', 'lead', 'architect', 'manager', 'director', 'head', 'expert', 'chief',
];

export const SENIOR_TITLE_RE =
  /\b(senior|staff|principal|lead|architect|manager|director|head|expert|chief|sr)s?\b/i;

/** Entry-level words in a title that qualify outright. */
export const ENTRY_TITLE_WORDS = [
  'student', 'intern', 'junior', 'graduate', 'new grad', 'entry level', 'entry-level', 'entry_level',
];

/** True when the title carries a strong seniority / exclusion term (Senior, Lead, Architect, ...). */
export function isSeniorTitle(title: string | null | undefined): boolean {
  return SENIOR_TITLE_RE.test(title || '');
}

/** True when the title is an explicit entry-level title (Student / Intern / Junior / Graduate / ...). */
export function isEntryTitle(title: string | null | undefined): boolean {
  const t = (title || '').toLowerCase();
  return ENTRY_TITLE_WORDS.some((w) => t.includes(w));
}

/** Explicitly non-EE/CE function words, rejected even in entry-level titles (e.g. "Junior Buyer").
    Large tenants mention chips/hardware incidentally in boilerplate, which would otherwise let
    commercial and administrative roles pass the content-based relevance check. */
export const NON_RELEVANT_TITLE_RE =
  /\b(buyers?|purchasing|procurement|recruiters?|accountants?|accounting|finance|secretar(y|ies)|receptionists?|hr|human resources|supply chain)\b/i;

/** Content signals that prove an entry-level role when the title is neutral.
    Two patterns are deliberately narrowed against wording accidents common in postings:
    "non-internship" ("5+ years of non-internship experience") is not an internship signal,
    and "mentor junior engineers" is not a junior role. */
export const ENTRY_CONTENT_PATTERNS: RegExp[] = [
  /\bentry[ -_]level\b/i,
  /\bstudent[s]?\b/i,
  /(?<!non-)\binternship\b/i,
  /\bgraduate\b/i,
  /\bjunior\b(?!\s+engineers?\b)/i,
  /\bco-?op\b/i,
  /recent graduate/i,
];

function matchesAny(text: string | null | undefined, words: string[]): boolean {
  const t = (text || '').toLowerCase();
  return words.some((w) => t.includes(w));
}

/**
 * Decide relevance + seniority for one posting.
 *
 * Rule: entry-level titles (Student / Intern / Junior / Graduate / ...) are never rejected,
 * even when they also carry a seniority term. Otherwise a seniority or exclusion term in the
 * title rejects the posting outright — broad EE/CE keywords in the content never override it.
 */
export function classifyJob(
  title: string | null | undefined,
  roleType?: string | null,
  contentText?: string | null,
): Verdict {
  const t = (title || '').toLowerCase();

  const titleEntry = matchesAny(t, ENTRY_TITLE_WORDS);
  if (!titleEntry) {
    if (isSeniorTitle(t)) return { relevant: false, reason: 'senior_title' };
    if (roleType && /experienced/i.test(roleType)) {
      return { relevant: false, reason: 'experienced_role_type' };
    }
  }
  if (NON_RELEVANT_TITLE_RE.test(t)) return { relevant: false, reason: 'not_relevant_area' };

  const contentEntry = ENTRY_CONTENT_PATTERNS.some((p) => p.test(contentText || ''));
  if (!titleEntry && !contentEntry) return { relevant: false, reason: 'not_entry_level' };

  const relevant = matchesAny(t, RELEVANT_KEYWORDS) || matchesAny(contentText, RELEVANT_KEYWORDS);
  if (!relevant) return { relevant: false, reason: 'not_relevant_area' };

  const isStudent =
    /student|intern/.test(t) || /\binternship\b/i.test(contentText || '');
  return { relevant: true, job_type: isStudent ? 'student' : 'junior' };
}

/** Increment a rejection counter in place. */
export function countRejection(rejected: Record<string, number>, reason: string): void {
  rejected[reason] = (rejected[reason] || 0) + 1;
}