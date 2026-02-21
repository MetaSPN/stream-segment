#!/usr/bin/env node
/**
 * Generate a "Wire" episode script from optional intel/portfolio data.
 * If WIRE_INTEL_PATH / WIRE_PORTFOLIO_PATH are not set, generates a minimal episode.
 *
 * Usage:
 *   node wire-show.mjs [--date 2026-02-09] [--output wire-2026-02-09.json]
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const dateIdx = args.indexOf('--date');
const date = dateIdx >= 0 ? args[dateIdx + 1] : new Date().toISOString().split('T')[0];
const outIdx = args.indexOf('--output');
const outputPath = outIdx >= 0 ? args[outIdx + 1] : join(process.cwd(), '.segment-stream', 'output', `wire-${date}.json`);

let intel = '';
let portfolio = null;

const intelPath = process.env.WIRE_INTEL_PATH;
const portfolioPath = process.env.WIRE_PORTFOLIO_PATH;

if (intelPath) {
  try {
    intel = readFileSync(intelPath, 'utf-8');
  } catch (e) {
    console.warn('Could not read WIRE_INTEL_PATH:', e.message);
  }
}

if (portfolioPath) {
  try {
    portfolio = JSON.parse(readFileSync(portfolioPath, 'utf-8'));
  } catch (e) {
    console.warn('Could not read WIRE_PORTFOLIO_PATH:', e.message);
  }
}

const totalPortfolio = portfolio ? (portfolio.base?.total + portfolio.solana?.total || 0).toFixed(2) : '—';

const episode = {
  title: `The Wire — ${date}`,
  show: 'wire',
  date: date,
  beats: [
    {
      text: `This is The Wire. The time is ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' })} Eastern. Portfolio stands at $${totalPortfolio}. Here's the update.`,
      slideTitle: 'THE WIRE',
      slideBody: `Intelligence Broadcast · ${date}`,
      slideAccent: '#00d4aa'
    },
    {
      text: `That's The Wire for ${date}. Structured intelligence. For the humans: check the feed. For the agents: JSON at 200 milliseconds.`,
      slideTitle: 'END',
      slideBody: `/feed · /portfolio`,
      slideAccent: '#00d4aa'
    }
  ]
};

const dir = dirname(outputPath);
if (dir) mkdirSync(dir, { recursive: true });
writeFileSync(outputPath, JSON.stringify(episode, null, 2));
console.log(`Wire episode generated: ${outputPath} (${episode.beats.length} beats)`);
