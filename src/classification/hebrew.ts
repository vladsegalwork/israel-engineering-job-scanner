/* Optional Hebrew locale pack.
   For Hebrew-language career sites the English regexes above cannot see anything, so this
   adds the equivalent seniority / entry-level / relevance rules in Hebrew. Hebrew has no
   uppercase and no `\b` word boundaries for Hebrew letters, so terms are matched between
   non-Hebrew characters instead. */

import type { JobType } from '../types.js';
import {
  ENTRY_CONTENT_PATTERNS,
  NON_RELEVANT_TITLE_RE,
  RELEVANT_KEYWORDS,
  isEntryTitle,
  isSeniorTitle,
  type Verdict,
} from './relevance.js';

const hebTerm = (words: string[]): RegExp =>
  new RegExp(`(?:^|[^\\u05d0-\\u05ea])(?:${words.join('|')})(?:[^\\u05d0-\\u05ea]|$)`);

/** Student / intern / junior / beginner markers. */
export const HEBREW_ENTRY_RE = hebTerm([
  'סטודנט', 'סטודנטית', 'סטודנטים', 'סטודנטיות',
  'מתמחה', 'מתמחית', 'מתמחים', 'מתמחות',
  "ג'וניור", 'גרוניור', 'מתחיל', 'מתחילה',
  'ללא ניסיון', 'ללא נסיון',
]);

/** Seniority / management markers. */
export const HEBREW_SENIOR_RE = hebTerm([
  'ראש תחום', 'ראש צוות', 'ראש מחלקה', 'ראש פרויקט', 'ראש המחלקה',
  'מנהל', 'מנהלת', 'ראשי', 'ראשית', 'בכיר', 'בכירה', 'מוביל', 'מובילה',
  'אדריכל', 'אדריכלית', 'מומחה', 'מומחית', 'סמנכ"ל', 'ותיק', 'ותיקה',
]);

/** Electrical / computer engineering relevance. */
export const HEBREW_RELEVANT_RE = hebTerm([
  'חומרה', 'חשמל', 'אלקטרונ', 'מעגל', 'מעגלים', 'מעגל מודפס', 'עיבוד אותות',
  'תקשורת', 'מכ"מ', 'משובצ', 'תדר', 'בקרה', 'מכטרונ',
  'DSP', 'RTL', 'VLSI', 'PCB', 'FPGA', 'PLC', 'SCADA',
]);

/** Non-engineering functions that appear alongside hardware wording. */
export const HEBREW_NON_RELEVANT_RE = hebTerm([
  'רכש', 'מזכירות', 'כספים', 'משאבי אנוש', 'מכירות', 'שיווק', 'גיוס',
]);

/** Licensed electrician trades: site wiring work, not chip / board engineering. */
const HEBREW_ELECTRICIAN_RE = /חשמלא[יי]/;

/**
 * Hebrew-first classifier: the English rules stay as a fallback, so bilingual titles
 * ("FPGA Engineer - סטודנט") classify correctly.
 */
export function classifyHebrewJob(
  title: string | null | undefined,
  contentText?: string | null,
): Verdict {
  const t = title || '';
  const content = contentText || '';

  const isElectrician = HEBREW_ELECTRICIAN_RE.test(t) && !/הנדסאי/.test(t);
  if (isElectrician) return { relevant: false, reason: 'not_relevant_area' };

  const titleEntry = HEBREW_ENTRY_RE.test(t) || isEntryTitle(t);
  if (!titleEntry && (HEBREW_SENIOR_RE.test(t) || isSeniorTitle(t))) {
    return { relevant: false, reason: 'senior_title' };
  }

  if (NON_RELEVANT_TITLE_RE.test(t) || HEBREW_NON_RELEVANT_RE.test(t)) {
    return { relevant: false, reason: 'not_relevant_area' };
  }

  const contentEntry =
    titleEntry ||
    ENTRY_CONTENT_PATTERNS.some((p) => p.test(content)) ||
    HEBREW_ENTRY_RE.test(content);
  if (!contentEntry) return { relevant: false, reason: 'not_entry_level' };

  const relevant =
    RELEVANT_KEYWORDS.some((w) => `${t} ${content}`.toLowerCase().includes(w)) ||
    HEBREW_RELEVANT_RE.test(t) ||
    HEBREW_RELEVANT_RE.test(content);
  if (!relevant) return { relevant: false, reason: 'not_relevant_area' };

  const isStudent = HEBREW_ENTRY_RE.test(t) || /student|intern/i.test(t) || /\binternship\b/i.test(content);
  const job_type: JobType = isStudent ? 'student' : 'junior';
  return { relevant: true, job_type };
}