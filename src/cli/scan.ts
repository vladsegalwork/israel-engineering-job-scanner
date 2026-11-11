#!/usr/bin/env node
/* Example CLI: read a source configuration, scan the enabled sources, print a summary and
   emit the normalized, classified jobs. Self-contained: no account, no database, no network
   service other than the public career sites themselves.

   Usage:
     npm run scan -- --config config/sources.example.json
     npm run scan -- --config my-sources.json --only NVIDIA,Mobileye --out jobs.json
     npm run scan -- --config my-sources.json --json > jobs.json
     npm run scan -- --config my-sources.json --state scanner-state.json   # keep dedup history

   Flags:
     --config <path>   source configuration file (default: config/sources.example.json)
     --out <path>      write matching jobs to this file (default: jobs.json)
     --json            print matching jobs to stdout instead of writing a file
     --only <names>    comma-separated source names to run (default: all enabled)
     --state <path>    persist scanner state between runs (enables cross-run dedup/lifecycle)
     --limit <n>       cap postings per source
     --quiet           print only the job output, no summary
*/

import { writeFileSync } from 'node:fs';
import { loadSourcesFromFile, ConfigError } from '../config/sources.js';
import { scanSource } from '../engine.js';
import { JsonFileJobStore, MemoryJobStore, type JobStore } from '../persistence/store.js';
import { healthLevel } from '../health.js';
import type { ScanResult, SourceConfig } from '../types.js';

interface CliArgs {
  config: string;
  out: string;
  json: boolean;
  only: string[];
  state: string | null;
  limit: number | null;
  quiet: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    config: 'config/sources.example.json',
    out: 'jobs.json',
    json: false,
    only: [],
    state: null,
    limit: null,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--config':
        args.config = String(argv[++i] ?? '');
        break;
      case '--out':
        args.out = String(argv[++i] ?? '');
        break;
      case '--json':
        args.json = true;
        break;
      case '--only':
        args.only = String(argv[++i] ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case '--state':
        args.state = String(argv[++i] ?? '');
        break;
      case '--limit':
        args.limit = Number(argv[++i]);
        break;
      case '--quiet':
        args.quiet = true;
        break;
      case '--help':
      case '-h':
        console.log(
          'Usage: npm run scan -- --config <file> [--out <file> | --json] [--only NAME,...] [--state <file>] [--limit N] [--quiet]',
        );
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          console.error(`Unknown flag: ${arg}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value.padEnd(width);
}

/** Human-readable summary, one row per source. */
function printSummary(results: ScanResult[]): void {
  const header = [
    pad('SOURCE', 22),
    pad('PLATFORM', 16),
    pad('FETCHED', 9),
    pad('IN-LOC', 8),
    pad('MATCHED', 9),
    pad('NEW', 5),
    pad('DUP', 5),
    pad('EXPIRED', 9),
    'STATUS',
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const r of results) {
    const status = r.ok ? `ok (${healthLevel(r.health)})` : `failed: ${r.error ?? 'unknown error'}`;
    console.log(
      [
        pad(r.source, 22),
        pad(r.platform_type, 16),
        pad(String(r.stats.total_fetched), 9),
        pad(String(r.stats.in_location), 8),
        pad(String(r.stats.relevant), 9),
        pad(String(r.stats.new_jobs), 5),
        pad(String(r.stats.duplicates), 5),
        pad(String(r.lifecycle.expired.length), 9),
        status,
      ].join(' '),
    );
  }

  const totals = results.reduce(
    (acc, r) => ({
      fetched: acc.fetched + r.stats.total_fetched,
      matched: acc.matched + r.stats.relevant,
      fresh: acc.fresh + r.stats.new_jobs,
    }),
    { fetched: 0, matched: 0, fresh: 0 },
  );
  console.log('-'.repeat(header.length));
  console.log(
    `${results.length} source(s) · ${totals.fetched} postings fetched · ${totals.matched} matched · ${totals.fresh} new`,
  );

  const rejections: Record<string, number> = {};
  for (const r of results) {
    for (const [reason, count] of Object.entries(r.rejected)) {
      rejections[reason] = (rejections[reason] || 0) + count;
    }
  }
  const entries = Object.entries(rejections).sort((a, b) => b[1] - a[1]);
  if (entries.length > 0) {
    console.log(`rejections: ${entries.map(([reason, count]) => `${reason}=${count}`).join(', ')}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let config;
  try {
    config = loadSourcesFromFile(args.config);
  } catch (error) {
    console.error(error instanceof ConfigError ? `Configuration error: ${error.message}` : String(error));
    process.exit(2);
    return;
  }

  let sources: SourceConfig[] = config.sources.filter((s) => s.enabled !== false);
  if (args.only.length > 0) {
    const wanted = new Set(args.only.map((n) => n.toLowerCase()));
    const unknown = args.only.filter((name) => !config.sources.some((s) => s.name.toLowerCase() === name.toLowerCase()));
    if (unknown.length > 0) {
      console.error(`Unknown source name(s): ${unknown.join(', ')}`);
      process.exit(2);
      return;
    }
    sources = config.sources.filter((s) => wanted.has(s.name.toLowerCase()));
  }
  if (sources.length === 0) {
    console.error('No enabled sources to scan.');
    process.exit(2);
    return;
  }

  if (args.limit && Number.isFinite(args.limit)) {
    sources = sources.map((s) => ({ ...s, options: { ...(s.options || {}), max_items: args.limit as number } }));
  }

  const store: JobStore = args.state ? new JsonFileJobStore(args.state) : new MemoryJobStore();

  const results: ScanResult[] = [];
  for (const source of sources) {
    const previous = await store.listBySource(source.name);
    const result = await scanSource(source, previous, { maxItems: config.max_items_per_source });
    results.push(result);
    await store.addJobs(source.name, result.jobs);
    await store.applyLifecycle(result.lifecycle);
  }
  if (store instanceof JsonFileJobStore) store.save();

  const output = results.flatMap((result) =>
    result.jobs.map((job) => ({
      source: result.source,
      company: job.company || result.source,
      title: job.title,
      job_type: job.job_type,
      location: job.location,
      url: job.original_url,
      posted_date: job.posted_date ?? null,
      external_job_id: job.external_job_id || null,
      requisition_id: job.requisition_id ?? null,
    })),
  );

  if (args.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (!args.quiet) {
      console.error(`\n${output.length} matching posting(s) written to stdout.`);
    }
  } else {
    writeFileSync(args.out, JSON.stringify(output, null, 2), 'utf8');
    if (!args.quiet) {
      printSummary(results);
      console.log(`\nWrote ${output.length} matching posting(s) to ${args.out}`);
    }
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length === results.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});