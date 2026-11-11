/* Adapter registry: platform_type -> implementation. Add a new adapter by writing one file
   with this signature and registering it here. */

import type { Adapter, PlatformType } from '../types.js';

import { fetchGreenhouseJobs } from './greenhouse.js';
import { fetchLeverJobs } from './lever.js';
import { fetchWorkdayJobs } from './workday.js';
import { fetchAmazonJobs } from './amazon.js';
import { fetchOracleCloudJobs } from './oracleCloud.js';
import { fetchJoinJobs } from './join.js';
import { fetchBambooHrJobs } from './bamboohr.js';
import { fetchComeetJobs } from './comeet.js';
import { fetchGoogleCareersJobs } from './googleCareers.js';
import { fetchWpJsonJobs } from './wpJson.js';
import { fetchHtmlListingJobs } from './htmlListing.js';
import { fetchSitemapJsonLdJobs } from './sitemapJsonLd.js';

export const ADAPTERS: Record<PlatformType, Adapter> = {
  greenhouse: fetchGreenhouseJobs,
  lever: fetchLeverJobs,
  workday: fetchWorkdayJobs,
  amazon_careers: fetchAmazonJobs,
  oracle_cloud: fetchOracleCloudJobs,
  join: fetchJoinJobs,
  bamboohr: fetchBambooHrJobs,
  comeet: fetchComeetJobs,
  google_careers: fetchGoogleCareersJobs,
  wp_json: fetchWpJsonJobs,
  html_listing: fetchHtmlListingJobs,
  sitemap_jsonld: fetchSitemapJsonLdJobs,
};

export const SUPPORTED_PLATFORM_TYPES = Object.keys(ADAPTERS) as PlatformType[];

export function getAdapter(platform: PlatformType): Adapter {
  const adapter = ADAPTERS[platform];
  if (!adapter) {
    throw new Error(
      `Unsupported platform_type "${platform}". Supported: ${SUPPORTED_PLATFORM_TYPES.join(', ')}`,
    );
  }
  return adapter;
}

export {
  fetchGreenhouseJobs,
  fetchLeverJobs,
  fetchWorkdayJobs,
  fetchAmazonJobs,
  fetchOracleCloudJobs,
  fetchJoinJobs,
  fetchBambooHrJobs,
  fetchComeetJobs,
  fetchGoogleCareersJobs,
  fetchWpJsonJobs,
  fetchHtmlListingJobs,
  fetchSitemapJsonLdJobs,
};