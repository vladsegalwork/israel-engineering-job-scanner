/** Canonical URL for dedup: lowercase host + path, no query, no hash, no trailing slash. */
export function normalizeUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return url.toLowerCase().trim();
  }
}