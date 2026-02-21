/**
 * segment-stream configuration.
 * Paths are relative to process.cwd() unless overridden by env.
 */
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { PKG_ROOT } from './pkg-root.mjs';

const outputBase = process.env.SEGMENT_STREAM_OUTPUT || join(process.cwd(), '.segment-stream');
const segmentsDir = join(outputBase, 'segments');
const outputDir = join(outputBase, 'output');

if (!existsSync(outputBase)) mkdirSync(outputBase, { recursive: true });
if (!existsSync(segmentsDir)) mkdirSync(segmentsDir, { recursive: true });
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

export const CONFIG = {
  /** Package root directory */
  pkgRoot: PKG_ROOT,

  /** Default avatar image (left panel). Override with SEGMENT_STREAM_AVATAR. */
  avatarPath: process.env.SEGMENT_STREAM_AVATAR || join(PKG_ROOT, 'assets', 'avatar.png'),

  /** Work directory for temp files (assemble-segment). Use cwd to avoid polluting package. */
  workDir: process.env.SEGMENT_STREAM_WORK_DIR || join(process.cwd(), '.segment-stream', 'work'),

  /** Output base for segments, feed, recursive state */
  paths: {
    output: outputDir,
    segments: segmentsDir,
    feed: join(outputBase, 'feed.json'),
    state: join(outputBase, 'state.json'),
    recursiveState: join(outputBase, 'recursive', 'state.json'),
  },

  /** Token metadata (optional; extend or replace for your cohort) */
  tokens: {},

  thresholds: {
    priceChangeAlert: 10,
    volumeSpikeMultiple: 5,
    cooldownMs: 30 * 60 * 1000,
    dailySegmentCap: 50,
    batchWindowMs: 5 * 60 * 1000,
  },

  segments: {
    maxWords: {
      'price-alert': 120,
      'conviction-update': 150,
      'market-recap': 200,
      'breaking': 80,
    },
    targetDurationSec: {
      'price-alert': 40,
      'conviction-update': 50,
      'market-recap': 70,
      'breaking': 25,
    },
  },
};

export { PKG_ROOT };
