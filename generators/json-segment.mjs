/**
 * Structured JSON segment and feed for agent consumers.
 */

import { readFile, writeFile } from 'fs/promises';
import { CONFIG } from '../lib/config.mjs';

/**
 * Create a structured JSON segment for the agent feed.
 */
export function createSegment({ id, type, tokenKey, eventData, script, audioPath, durationSec }) {
  const token = CONFIG.tokens[tokenKey] || {};

  return {
    id,
    type,
    timestamp: new Date().toISOString(),
    network: 'segment-stream',
    version: '1.0',
    token: {
      symbol: token.symbol || tokenKey,
      address: token.address,
      chain: token.chain,
      creator: token.creator,
      agent: token.agent
    },
    data: {
      price_usd: eventData?.price ?? null,
      change_pct: eventData?.change ?? null,
      timeframe: eventData?.timeframe ?? null,
      volume_24h: eventData?.volume ?? null,
      mcap: eventData?.mcap ?? null
    },
    conviction: {
      signal: eventData?.signal || 'WATCH',
      confidence: eventData?.confidence ?? null,
      reasoning: eventData?.reasoning ?? null
    },
    content: {
      script,
      audio_url: audioPath || null,
      video_url: null
    },
    meta: {
      word_count: script.split(/\s+/).length,
      duration_seconds: durationSec,
      phase: 0
    }
  };
}

/**
 * Append a segment to the JSON feed file.
 */
export async function appendToFeed(segment) {
  const feedPath = CONFIG.paths.feed;
  let feed;

  try {
    const raw = await readFile(feedPath, 'utf-8');
    feed = JSON.parse(raw);
  } catch {
    feed = {
      network: 'segment-stream',
      version: '1.0',
      description: 'Segment feed.',
      segments: []
    };
  }

  feed.segments.unshift(segment);
  if (feed.segments.length > 100) feed.segments = feed.segments.slice(0, 100);
  feed.updated = new Date().toISOString();
  feed.count = feed.segments.length;

  await writeFile(feedPath, JSON.stringify(feed, null, 2));
  return feedPath;
}
