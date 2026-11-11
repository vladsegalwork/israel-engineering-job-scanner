/* Location filtering and normalization.
   Israeli postings reach career sites in wildly different shapes: "Tel Aviv, Israel",
   "ISR - Tel Aviv", "Yokneam", "Petah Tikva, Merkaz, IL", or a country facet code.
   These helpers cover all of them without company-specific rules. */

/** Generic Israeli city dictionary. ATS tenants frequently store only the city name,
    with no country code and no country facet, so a term like "israel" can never match. */
export const ISRAEL_CITY_HINTS: string[] = [
  'tel aviv', 'tel-aviv', 'jerusalem', 'haifa', 'beer sheva', "be'er sheva", 'beer-sheva',
  'raanana', 'herzliya', 'herzelia', 'petah tikva', 'netanya', 'rehovot', 'yokneam',
  'hod hasharon', 'kfar saba', 'rishon lezion', 'modiin', 'bet shemesh', 'beit shemesh',
  'caesarea', 'or yehuda', 'or akiva', 'nazareth', 'akko', 'tiberias', 'givatayim',
  'bnei brak', 'holon', 'bat yam', 'ashkelon', 'ashdod', 'kiryat gat', 'kiryat malachi',
  'migdal haemek', 'ramat gan', 'ramat hasharon', 'ramla', 'lod', 'kiryat bialik',
  'kiryat atta', 'kiryat motzkin', 'kiryat yam', 'tirat carmel', 'hadera', 'pardes hanna',
  'yavne', 'nesher', 'elkana', 'yehud',
];

/** True when a filter term targets Israel ("Israel", "ISR", "ISR-"). */
export function isIsraelFilterTerm(term: string): boolean {
  const f = (term || '').toLowerCase().trim();
  return f.includes('israel') || f === 'isr' || f === 'isr-';
}

/** True when any filter term targets Israel. */
export function anyIsraelFilter(locations: string[] | null | undefined): boolean {
  return (locations || []).some(isIsraelFilterTerm);
}

/** Match a location text against the filter terms.
    Three ways to match: direct term, ISO country-code prefix ("ISR-Tel Aviv" vs "isr"),
    or an Israeli city name. */
export function locationFilterMatches(
  filters: string[],
  text: string | null | undefined,
  isIsrael: boolean,
): boolean {
  const t = (text || '').toLowerCase();
  if (!t) return false;
  for (const f of filters) {
    if (t.includes(f)) return true;
    const code = t.replace(/-.*$/, '').trim();
    if (/^[a-z]{2,3}$/.test(code) && f.startsWith(code)) return true;
  }
  return isIsrael && ISRAEL_CITY_HINTS.some((c) => t.includes(c));
}

/** Lowercase and drop straight/typographic apostrophes so "Ra'anana" matches "raanana". */
export function normalizeApostrophes(text: string | null | undefined): string {
  return (text || '').toLowerCase().replace(/['\u2019\u2018`]/g, '');
}

/** Apostrophe-insensitive location check, for HTML pages that render typographic quotes. */
export function locationMatchesLoose(
  filters: string[],
  text: string | null | undefined,
  isIsrael: boolean,
): boolean {
  const normalized = normalizeApostrophes(text);
  if (!normalized) return false;
  for (const f of filters) {
    if (normalized.includes(normalizeApostrophes(f))) return true;
  }
  return isIsrael && ISRAEL_CITY_HINTS.some((c) => normalized.includes(normalizeApostrophes(c)));
}

/** Best-effort city extraction from free text: the first Israeli city hint wins. */
export function findIsraelCity(text: string | null | undefined): string | null {
  const normalized = normalizeApostrophes(text);
  if (!normalized) return null;
  for (const city of ISRAEL_CITY_HINTS) {
    if (normalized.includes(normalizeApostrophes(city))) return city;
  }
  return null;
}

/** Trim a location for display ("Tel Aviv, Israel" -> "Tel Aviv"). */
export function displayLocation(location: string | null | undefined): string {
  const raw = (location || '').trim();
  if (!raw) return '';
  return raw
    .replace(/,\s*(israel|il)\s*$/i, '')
    .replace(/^isr\s*-\s*/i, '')
    .trim();
}