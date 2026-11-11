export * from './relevance.js';
export * from './hebrew.js';

import { classifyJob, type Verdict } from './relevance.js';
import { classifyHebrewJob } from './hebrew.js';

export type Locale = 'en' | 'he';

/** Pick the classifier for a source's language. Defaults to English. */
export function classifierFor(locale: Locale = 'en') {
  return locale === 'he' ? classifyHebrewJob : classifyJob;
}

export type { Verdict };