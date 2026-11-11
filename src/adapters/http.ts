/* Thin fetch helpers shared by every adapter: timeouts, headers, JSON parsing. */

import type { SourceConfig } from '../types.js';

/** Default browser-like User-Agent. Override per source with `options.user_agent`.
    If you run this at scale, prefer an identifiable UA that names your crawler. */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export function userAgentFor(source: SourceConfig): string {
  const ua = source.options?.user_agent;
  return typeof ua === 'string' && ua.trim() ? ua.trim() : DEFAULT_USER_AGENT;
}

export interface RequestOptions {
  method?: string;
  body?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

function buildInit(ua: string, options: RequestOptions): RequestInit {
  return {
    method: options.method || 'GET',
    body: options.body,
    headers: { 'User-Agent': ua, ...(options.headers || {}) },
    signal: AbortSignal.timeout(options.timeout ?? 15000),
  };
}

/** Fetch a page and return its body, throwing on any non-2xx status. */
export async function fetchText(
  url: string,
  userAgent: string,
  options: RequestOptions = {},
): Promise<string> {
  const res = await fetch(url, buildInit(userAgent, options));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Fetch and parse JSON, throwing on any non-2xx status. */
export async function fetchJson<T = any>(
  url: string,
  userAgent: string,
  options: RequestOptions = {},
): Promise<T> {
  const res = await fetch(url, buildInit(userAgent, options));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

/** Same as fetchText, but returns null instead of throwing (used for optional / speculative URLs). */
export async function fetchTextOrNull(
  url: string,
  userAgent: string,
  options: RequestOptions = {},
): Promise<string | null> {
  try {
    return await fetchText(url, userAgent, options);
  } catch {
    return null;
  }
}

/** Same as fetchJson, but returns null instead of throwing. */
export async function fetchJsonOrNull<T = any>(
  url: string,
  userAgent: string,
  options: RequestOptions = {},
): Promise<T | null> {
  try {
    return await fetchJson<T>(url, userAgent, options);
  } catch {
    return null;
  }
}

/** Run `worker` over items in small batches so a slow endpoint is not hammered. */
export async function inBatches<T, R>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    results.push(...(await Promise.allSettled(batch.map(worker))));
  }
  return results;
}