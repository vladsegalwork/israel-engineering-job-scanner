/* Text helpers shared by the HTML-reading adapters. Pure functions only. */

/** Strip HTML tags and decode the common entities into plain text. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Decode a JSON-escaped string lifted out of raw script text. */
export function decodeJsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

/** Parse a Next.js `__NEXT_DATA__` payload embedded in server-rendered HTML. */
export function parseNextData(html: string): any | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** Recursively find the first meaningful description string inside parsed page data. */
export function findDescriptionField(obj: any, depth = 0): string | null {
  if (depth > 6 || !obj || typeof obj !== 'object') return null;
  if (typeof obj.description === 'string' && obj.description.length > 50) return obj.description;
  for (const key of Object.keys(obj)) {
    const found = findDescriptionField(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Extract a top-level JSON array that follows a marker inside an HTML page.
 * Balanced-bracket scanning keeps nested arrays and strings safe.
 */
export function extractJsonArrayAfterMarker(html: string, marker: string): any[] | null {
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const arrStart = html.indexOf('[', start + marker.length);
  if (arrStart === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = arrStart; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(arrStart, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}