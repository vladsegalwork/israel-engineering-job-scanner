/* Source configuration loading and validation.
   The file is plain JSON: either a bare array of sources, or { sources: [...] }.
   Validation is strict and reports the exact field that is wrong, because a silently skipped
   source is the most common reason a scan "finds nothing". */

import { readFileSync } from 'node:fs';
import type { PlatformType, SourceConfig } from '../types.js';
import { SUPPORTED_PLATFORM_TYPES } from '../adapters/index.js';

export interface ScannerConfig {
  sources: SourceConfig[];
  /** Optional global cap applied by adapters that do not define their own. */
  max_items_per_source?: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function validateSource(raw: unknown, index: number): SourceConfig {
  const where = `sources[${index}]`;
  if (!raw || typeof raw !== 'object') throw new ConfigError(`${where} must be an object`);
  const s = raw as Record<string, unknown>;

  if (typeof s.name !== 'string' || !s.name.trim()) {
    throw new ConfigError(`${where}.name is required (non-empty string)`);
  }
  if (typeof s.career_url !== 'string' || !/^https?:\/\//i.test(s.career_url)) {
    throw new ConfigError(`${where}.career_url must be an absolute http(s) URL`);
  }
  if (typeof s.platform_type !== 'string') {
    throw new ConfigError(`${where}.platform_type is required`);
  }
  if (!SUPPORTED_PLATFORM_TYPES.includes(s.platform_type as PlatformType)) {
    throw new ConfigError(
      `${where}.platform_type "${s.platform_type}" is not supported. Supported: ${SUPPORTED_PLATFORM_TYPES.join(', ')}`,
    );
  }
  if (s.relevant_locations !== undefined && !Array.isArray(s.relevant_locations)) {
    throw new ConfigError(`${where}.relevant_locations must be an array of strings`);
  }

  return {
    name: s.name.trim(),
    career_url: s.career_url,
    platform_type: s.platform_type as PlatformType,
    enabled: s.enabled === undefined ? true : Boolean(s.enabled),
    relevant_locations: (s.relevant_locations as string[] | undefined)?.map((l) => String(l)),
    options: (s.options as SourceConfig['options']) || {},
  };
}

/** Validate an already-parsed configuration object. */
export function parseSources(raw: unknown): ScannerConfig {
  const container = Array.isArray(raw) ? { sources: raw } : (raw as Record<string, unknown>);
  if (!container || typeof container !== 'object' || !Array.isArray(container.sources)) {
    throw new ConfigError('Configuration must be an array of sources or an object with a "sources" array');
  }
  if (container.sources.length === 0) {
    throw new ConfigError('Configuration contains no sources');
  }

  const names = new Set<string>();
  const sources = container.sources.map((entry, index) => {
    const source = validateSource(entry, index);
    if (names.has(source.name)) {
      throw new ConfigError(`Duplicate source name "${source.name}" — names identify sources in output`);
    }
    names.add(source.name);
    return source;
  });

  return {
    sources,
    max_items_per_source:
      typeof container.max_items_per_source === 'number'
        ? container.max_items_per_source
        : undefined,
  };
}

/** Read and validate a JSON configuration file. */
export function loadSourcesFromFile(path: string): ScannerConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError(`Could not read configuration file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`Configuration file is not valid JSON: ${(error as Error).message}`);
  }
  return parseSources(parsed);
}