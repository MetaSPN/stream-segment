#!/usr/bin/env node
/**
 * Persistent playlist player: reads playlist.json, plays clips to RTMP with transitions.
 *
 * Usage:
 *   stream-engine [--queue ./queue] [--rtmp rtmp://localhost:1935/live/marvin]
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../lib/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const queueDir = args.includes('--queue') ? args[args.indexOf('--queue') + 1] : join(process.cwd(), '.segment-stream', 'queue');
const rtmpUrl = process.env.SEGMENT_STREAM_RTMP_URL || (args.includes('--rtmp') ? args[args.indexOf('--rtmp') + 1] : 'rtmp://localhost:1935/live/marvin');

const PLAYLIST = join(queueDir, 'playlist.json');
const STATE_FILE = join(queueDir, 'engine-state.json');

let engineState = {
  running: true,
  currentClipId: null,
  currentIndex: 0,
  loopCount: 0,
  startedAt: new Date().toISOString(),
  clipsPlayed: 0,
  errors: 0
};

function loadState() {
  if (existsSync(STATE_FILE)) {
    try { engineState = { ...engineState, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }; } catch {}
  }
}

function saveState() {
  if (!existsSync(dirname(STATE_FILE))) mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(engineState, null, 2));
}

function loadPlaylist() {
  if (!existsSync(PLAYLIST)) {
    console.error('❌ No playlist.json found at', PLAYLIST);
    return null;
  }
  try {
    return JSON.parse(readFileSync(PLAYLIST, 'utf8'));
  } catch (e) {
    console.error('⚠️ Failed to parse playlist:', e.message);
    return null;
  }
}

function getOrderedClips(playlist) {
  if (!playlist?.clips?.length) return [];
  const clips = [...playlist.clips];
  const pinned = clips.filter(c => c.priority === 'pinned').sort((a, b) => (a.position || 0) - (b.position || 0));
  const breaking = clips.filter(c => c.priority === 'breaking').sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
  const normal = clips.filter(c => c.priority === 'normal').sort((a, b) => new Date(a.addedAt) - new Date(b.addedAt));
  const filler = clips.filter(c => c.priority === 'filler');
  return [...pinned, ...breaking, ...normal, ...filler];
}

function playClip(clipPath) {
  return new Promise((resolve) => {
    if (!existsSync(clipPath)) {
      console.error(`⚠️ Clip not found: ${clipPath}`);
      resolve(1);
      return;
    }
    const ff = spawn('ffmpeg', [
      '-re', '-i', clipPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
      '-pix_fmt', 'yuv420p', '-g', '60',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-f', 'flv', rtmpUrl
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ff.stderr.on('data', (d) => {
      const line = d.toString();
      if (line.includes('frame=')) process.stdout.write(`\r   ${line.trim().slice(0, 100)}`);
    });
    ff.on('close', (code) => {
      console.log(`\n   Clip ended (code ${code})`);
      resolve(code);
    });
    ff.on('error', (err) => {
      console.error('   ffmpeg error:', err.message);
      resolve(1);
    });
  });
}

function playTransition() {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', [
      '-f', 'lavfi', '-i', 'color=c=#0d1117:s=1920x1080:d=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
      '-f', 'flv', rtmpUrl
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    ff.on('close', () => resolve());
    ff.on('error', () => resolve());
  });
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════╗
║  STREAM ENGINE                                  ║
║  Queue: ${queueDir.slice(-42).padEnd(42)}║
║  RTMP:  ${rtmpUrl.slice(-42).padEnd(42)}║
╚══════════════════════════════════════════════════╝
`);

  loadState();

  while (engineState.running) {
    const playlist = loadPlaylist();
    if (!playlist) {
      console.log('⏳ No playlist. Waiting 10s...');
      await new Promise(r => setTimeout(r, 10000));
      continue;
    }
    const ordered = getOrderedClips(playlist);
    if (ordered.length === 0) {
      console.log('⏳ Empty playlist. Waiting 10s...');
      await new Promise(r => setTimeout(r, 10000));
      continue;
    }

    for (let i = 0; i < ordered.length; i++) {
      const freshPlaylist = loadPlaylist();
      const freshOrdered = getOrderedClips(freshPlaylist || playlist);
      const breaking = freshOrdered.filter(c => c.priority === 'breaking' && !c._played);
      let clip;
      if (breaking.length > 0 && i > 0) {
        clip = breaking[0];
        clip._played = true;
        console.log(`\n🚨 BREAKING: ${clip.title}`);
      } else {
        clip = ordered[i];
      }

      const clipPath = join(queueDir, clip.path);
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`▶ [${i + 1}/${ordered.length}] ${clip.title || clip.id}`);
      console.log(`  Priority: ${clip.priority} | Path: ${clip.path}`);
      console.log(`${'─'.repeat(50)}`);

      engineState.currentClipId = clip.id;
      engineState.currentIndex = i;
      saveState();

      const code = await playClip(clipPath);
      if (code !== 0) engineState.errors++;
      engineState.clipsPlayed++;
      await playTransition();
    }

    engineState.loopCount++;
    console.log(`\n🔄 Loop ${engineState.loopCount} complete. Restarting playlist...`);
    saveState();

    const pl = loadPlaylist();
    if (pl) {
      pl.clips = pl.clips.filter(c => c.priority !== 'breaking');
      writeFileSync(PLAYLIST, JSON.stringify(pl, null, 2));
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n\n🛑 Stream engine stopping...');
  engineState.running = false;
  saveState();
  process.exit(0);
});
process.on('SIGTERM', () => {
  engineState.running = false;
  saveState();
  process.exit(0);
});

main().catch(e => {
  console.error('💀 Stream engine died:', e);
  process.exit(1);
});
