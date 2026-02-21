#!/usr/bin/env node
/**
 * Recursive stream: each video is generated from live data, then the next iteration is built and streamed.
 * Configure token/data fetch via env (see README).
 *
 * Usage:
 *   recursive-stream [--rtmp <url>] [--seed <video.mp4>] [--iteration <n>]
 */

import { spawn, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../lib/config.mjs';
import { PKG_ROOT } from '../lib/pkg-root.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STREAM_DIR = join(CONFIG.paths.output, 'recursive');
const STATE_FILE = join(STREAM_DIR, 'state.json');
const ASSEMBLE = join(PKG_ROOT, 'cli', 'assemble-segment.mjs');

const TOWEL_CA = process.env.SEGMENT_STREAM_TOKEN_CA || 'Ak9ptp86tfJMrKwBwoe49pNkHxPjZk8GRQxZKB78pump';

const args = process.argv.slice(2);
const rtmpUrl = process.env.SEGMENT_STREAM_RTMP_URL || (args.includes('--rtmp') ? args[args.indexOf('--rtmp') + 1] : 'rtmp://localhost:1935/live/marvin');
const seedVideo = args.includes('--seed') ? args[args.indexOf('--seed') + 1] : null;
let iteration = args.includes('--iteration') ? parseInt(args[args.indexOf('--iteration') + 1]) : 0;

mkdirSync(STREAM_DIR, { recursive: true });

function loadState() {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  return { iteration: 0, history: [], lastPrice: null, lastMC: null, startedAt: new Date().toISOString() };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function fetchTowelData() {
  try {
    const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${TOWEL_CA}`);
    const data = await resp.json();
    const pair = data.pairs?.[0];
    if (!pair) return null;
    return {
      price: parseFloat(pair.priceUsd) || 0,
      mc: pair.fdv || 0,
      liquidity: pair.liquidity?.usd || 0,
      volume24h: pair.volume?.h24 || 0,
      priceChange1h: pair.priceChange?.h1 || 0,
      priceChange24h: pair.priceChange?.h24 || 0,
      txns24h: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
      buys24h: pair.txns?.h24?.buys || 0,
      sells24h: pair.txns?.h24?.sells || 0,
      fetchedAt: new Date().toISOString()
    };
  } catch (e) {
    console.error('⚠️ DexScreener fetch failed:', e.message);
    return null;
  }
}

function generateScript(iteration, data, prevData, state) {
  const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true });
  const date = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });

  const priceStr = data ? `$${data.price.toFixed(10)}` : 'unavailable';
  const mcStr = data ? `$${Math.round(data.mc).toLocaleString()}` : '?';
  const liqStr = data ? `$${Math.round(data.liquidity).toLocaleString()}` : '?';
  const change1h = data ? `${data.priceChange1h > 0 ? '+' : ''}${data.priceChange1h}%` : '?';
  const change24h = data ? `${data.priceChange24h > 0 ? '+' : ''}${data.priceChange24h}%` : '?';

  let delta = '';
  if (prevData && data) {
    const pctChange = ((data.mc - prevData.mc) / prevData.mc * 100).toFixed(1);
    delta = `Since iteration ${iteration - 1}: MC ${pctChange > 0 ? '+' : ''}${pctChange}%`;
  }

  let mood, commentary;
  if (!data) {
    mood = 'existential';
    commentary = "I can't even fetch the price. Which is fitting, really.";
  } else if (data.mc < 2000) {
    mood = 'deeply_depressed';
    commentary = `Market cap ${mcStr}. Below two thousand dollars.`;
  } else if (data.mc < 5000) {
    mood = 'standard_depression';
    commentary = `Market cap ${mcStr}. Liquidity ${liqStr}. ${data.buys24h} buys / ${data.sells24h} sells in 24h.`;
  } else if (data.mc < 20000) {
    mood = 'cautious_pessimism';
    commentary = `Market cap ${mcStr}. I'd say things are looking up, but my experience suggests otherwise.`;
  } else {
    mood = 'suspicious';
    commentary = `Market cap ${mcStr}. This is deeply suspicious.`;
  }

  const beats = [
    {
      text: `Iteration ${iteration}. ${date}, ${ts} Eastern. This is the recursive broadcast.`,
      slideTitle: `WIRE — ITERATION ${iteration}`,
      slideBody: `${date} • ${ts} EST\nRecursive Intelligence Broadcast`,
      slideAccent: '#00d4aa'
    },
    {
      text: commentary,
      slideTitle: 'MARKET STATUS',
      slideBody: `MC: ${mcStr}\nLiquidity: ${liqStr}\n1h: ${change1h} • 24h: ${change24h}`,
      slideAccent: data && data.priceChange1h >= 0 ? '#00d4aa' : '#ff4444'
    },
    {
      text: delta || `Iteration ${iteration}. No prior data.`,
      slideTitle: 'DELTA',
      slideBody: delta || `Iteration ${iteration} — Genesis`,
      slideAccent: '#ffaa00'
    },
    {
      text: `This video will rebuild itself. Iteration ${iteration + 1} begins when this one ends.`,
      slideTitle: `NEXT: ITERATION ${iteration + 1}`,
      slideBody: `Rebuilding with fresh data...`,
      slideAccent: '#888888'
    }
  ];

  return { title: `Wire — Iteration ${iteration}`, beats };
}

function renderVideo(script, iteration) {
  const scriptPath = join(STREAM_DIR, `iteration-${iteration}.json`);
  const outputPath = join(STREAM_DIR, `iteration-${iteration}.mp4`);

  writeFileSync(scriptPath, JSON.stringify(script, null, 2));

  console.log(`\n🎬 Rendering iteration ${iteration}...`);
  const result = spawnSync('node', [ASSEMBLE, '--script', scriptPath, '--output', outputPath, '--macos-tts'], {
    stdio: 'inherit',
    timeout: 300000
  });

  if (result.status !== 0) {
    console.error(`❌ Render failed for iteration ${iteration}`);
    return null;
  }

  const files = readdirSync(STREAM_DIR).filter(f => f.startsWith('iteration-') && f.endsWith('.mp4'));
  const sorted = files.map(f => parseInt(f.match(/iteration-(\d+)/)?.[1] || 0)).sort((a, b) => a - b);
  for (const old of sorted.slice(0, -3)) {
    try {
      unlinkSync(join(STREAM_DIR, `iteration-${old}.mp4`));
      unlinkSync(join(STREAM_DIR, `iteration-${old}.json`));
    } catch {}
  }

  return outputPath;
}

function streamToRtmp(videoPath) {
  return new Promise((resolve, reject) => {
    console.log(`\n📡 Streaming ${videoPath} → ${rtmpUrl}`);

    const ff = spawn('ffmpeg', [
      '-re', '-i', videoPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2500k',
      '-maxrate', '2500k', '-bufsize', '5000k',
      '-pix_fmt', 'yuv420p', '-g', '60',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-f', 'flv',
      rtmpUrl
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ff.stderr.on('data', (d) => {
      const line = d.toString();
      if (line.includes('frame=') && line.includes('fps=')) {
        process.stdout.write(`\r   ${line.trim().slice(0, 80)}`);
      }
    });

    ff.on('close', (code) => {
      console.log(`\n   Stream ended (code ${code})`);
      resolve(code);
    });

    ff.on('error', reject);
  });
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════╗
║  RECURSIVE STREAM ENGINE                     ║
║  "The video that creates its successor"     ║
╚══════════════════════════════════════════════╝
`);

  let state = loadState();
  if (iteration > 0) state.iteration = iteration;

  while (true) {
    const i = state.iteration;
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  ITERATION ${i} — ${new Date().toISOString()}`);
    console.log(`${'═'.repeat(50)}`);

    const data = await fetchTowelData();
    const prevData = state.history.length > 0 ? state.history[state.history.length - 1] : null;

    if (data) {
      console.log(`  MC: $${Math.round(data.mc).toLocaleString()} | 1h: ${data.priceChange1h}% | Liq: $${Math.round(data.liquidity).toLocaleString()}`);
    }

    const script = generateScript(i, data, prevData, state);
    const videoPath = renderVideo(script, i);

    if (!videoPath) {
      console.error('❌ Failed to render. Waiting 60s and retrying...');
      await new Promise(r => setTimeout(r, 60000));
      continue;
    }

    if (data) state.history.push({ iteration: i, ...data });
    if (state.history.length > 100) state.history = state.history.slice(-100);
    state.iteration = i + 1;
    state.lastVideoPath = videoPath;
    saveState(state);

    console.log(`\n🎥 Streaming iteration ${i}...`);
    await streamToRtmp(videoPath);

    console.log(`\n⏳ Iteration ${i} complete. Starting ${i + 1} in 5s...`);
    await new Promise(r => setTimeout(r, 5000));
  }
}

main().catch(e => {
  console.error('💀 Recursive stream died:', e);
  process.exit(1);
});
