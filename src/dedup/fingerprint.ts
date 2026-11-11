/* Job fingerprinting: the fallback identity used when a source publishes no stable id or URL.
   Company | title | location, normalized. Deliberately conservative: same company + same title
   + same location is treated as the same posting. */

/** Fallback fingerprint: company + title + location, normalized. */
export function jobFingerprint(
  company: string | null | undefined,
  title: string | null | undefined,
  location: string | null | undefined,
): string {
  const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(company)}|${norm(title)}|${norm(location)}`;
}

/** Company-name normalization for cross-source dedup: lowercase, drop parenthetical qualifiers,
    punctuation and extra whitespace. */
export function normalizeCompanyName(company: string | null | undefined): string {
  return (company || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/["'.,\-\u2013]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Derive a company name from a source label ("Acme Careers" -> "Acme", "Acme Israel" -> "Acme"). */
export function companyFromSourceName(sourceName: string): string {
  return (sourceName || '').replace(/\s*(Careers|Israel)?\s*$/i, '').trim();
}