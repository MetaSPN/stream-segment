#!/usr/bin/env node
/**
 * Generate + assemble + stream a show to an RTMP endpoint.
 *
 * Usage:
 *   stream-scheduler --show wire --stream-key <rtmp-url>
 *   stream-scheduler --video /path/to/video.mp4 --stream-key <rtmp-url> [--duration 1800]
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../lib/config.mjs';
import { PKG_ROOT } from '../lib/pkg-root.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}

const show = arg('show');
const episode = arg('episode');
const streamKey = arg('stream-key');
const videoPath = arg('video');
const duration = parseInt(arg('duration') || '1800');

if (!streamKey) {
  console.error('--stream-key required (full RTMP URL, e.g. rtmps://... or rtmp://...)');
  process.exit(1);
}

async function run() {
  let mp4;

  if (videoPath) {
    mp4 = videoPath;
    if (!existsSync(mp4)) {
      console.error(`Video not found: ${mp4}`);
      process.exit(1);
    }
    console.log(`Streaming pre-made video: ${mp4}`);
  } else {
    let scriptPath = episode;

    if (show && !episode) {
      const date = new Date().toISOString().split('T')[0];
      scriptPath = join(CONFIG.paths.output, `${show}-${date}.json`);

      if (show === 'wire') {
        console.log('Generating Wire episode...');
        try {
          execSync(`node ${join(PKG_ROOT, 'generators', 'wire-show.mjs')} --output ${scriptPath}`, { stdio: 'inherit' });
        } catch (e) {
          console.error('Wire episode generation failed. Provide --episode <script.json> or install optional data.');
          process.exit(1);
        }
      } else {
        console.error(`Unknown show: ${show}. Use --episode <script.json> or --video <file.mp4>.`);
        process.exit(1);
      }
    }

    if (!scriptPath || !existsSync(scriptPath)) {
      console.error(`No episode script at: ${scriptPath}`);
      process.exit(1);
    }

    const date = new Date().toISOString().split('T')[0];
    mp4 = join(CONFIG.paths.output, `${show || 'episode'}-${date}.mp4`);
    console.log(`Assembling video from ${scriptPath}...`);

    try {
      execSync(`node ${join(PKG_ROOT, 'cli', 'assemble-segment.mjs')} --script ${scriptPath} --output ${mp4}`, {
        stdio: 'inherit',
        timeout: 300000
      });
    } catch (e) {
      console.error('Assembly failed:', e.message);
      process.exit(1);
    }
  }

  const notifyUrl = process.env.SEGMENT_STREAM_NOTIFY_URL;
  if (notifyUrl) {
    console.log('\nNotifying webhook...');
    try {
      const notifyRes = await fetch(notifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SEGMENT_STREAM_NOTIFY_SECRET || ''}`,
        },
        body: JSON.stringify({
          event: 'stream_live',
          data: { show: show || 'custom', video: mp4, duration, url: streamKey ? '(live)' : null },
        }),
      });
      const data = await notifyRes.json().catch(() => ({}));
      console.log(`Notified: ${data.delivered ?? 'ok'}`);
    } catch (e) {
      console.log('Webhook failed (non-fatal):', e.message);
    }
  }

  console.log(`\nStreaming ${mp4} to RTMP for ${duration}s...`);

  const ffmpeg = spawn('ffmpeg', [
    '-stream_loop', '-1',
    '-re',
    '-i', mp4,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '1000k',
    '-maxrate', '1200k',
    '-bufsize', '2400k',
    '-pix_fmt', 'yuv420p',
    '-g', '50',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    streamKey
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  ffmpeg.stdout.on('data', d => process.stdout.write(d));
  ffmpeg.stderr.on('data', d => process.stderr.write(d));

  const timer = setTimeout(() => {
    console.log(`\n[${duration}s elapsed] Stopping stream.`);
    ffmpeg.kill('SIGTERM');
  }, duration * 1000);

  ffmpeg.on('close', (code, signal) => {
    clearTimeout(timer);
    console.log(`Stream ended (code=${code}, signal=${signal})`);
  });
}

run().catch(e => { console.error(e); process.exit(1); });
