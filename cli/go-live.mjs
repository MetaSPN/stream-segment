#!/usr/bin/env node
/**
 * Stream a video file or playlist to local RTMP relay.
 * Requires nginx with RTMP (or direct RTMP URL via env).
 *
 * Usage:
 *   go-live --video segment.mp4 [--loop]
 *   go-live --playlist file1.mp4 file2.mp4 ...
 */

import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';

const RTMP_URL = process.env.SEGMENT_STREAM_RTMP_URL || 'rtmp://localhost:1935/live/marvin';

const args = process.argv.slice(2);
const loop = args.includes('--loop');
const videoIdx = args.indexOf('--video');
const playlistIdx = args.indexOf('--playlist');

if (process.env.SEGMENT_STREAM_RTMP_URL) {
  console.log('Using RTMP URL from SEGMENT_STREAM_RTMP_URL');
} else {
  try {
    execSync('pgrep nginx', { stdio: 'pipe' });
    console.log('✅ nginx RTMP relay is running');
  } catch {
    console.log('⚠️  nginx not detected. Set SEGMENT_STREAM_RTMP_URL to push directly, or start nginx (e.g. brew services start nginx-full)');
  }
}

if (videoIdx !== -1) {
  const videoPath = resolve(args[videoIdx + 1]);
  if (!existsSync(videoPath)) {
    console.error(`❌ Video not found: ${videoPath}`);
    process.exit(1);
  }
  streamVideo(videoPath, loop);
} else if (playlistIdx !== -1) {
  const videos = args.slice(playlistIdx + 1).filter(a => !a.startsWith('--')).map(v => resolve(v));
  streamPlaylist(videos);
} else {
  console.error('Usage: go-live --video <file.mp4> [--loop]');
  console.error('       go-live --playlist <file1.mp4> <file2.mp4> ...');
  process.exit(1);
}

function streamVideo(path, loop = false) {
  console.log(`\n📡 Streaming to: ${RTMP_URL}`);
  console.log(`   Video: ${path}`);
  console.log(`   Loop: ${loop}`);
  console.log(`   Press Ctrl+C to stop\n`);

  const inputArgs = loop
    ? ['-stream_loop', '-1', '-re', '-i', path]
    : ['-re', '-i', path];

  const ff = spawn('ffmpeg', [
    ...inputArgs,
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
    '-f', 'flv',
    RTMP_URL
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  ff.stdout.on('data', d => process.stdout.write(d));
  ff.stderr.on('data', d => {
    const line = d.toString();
    if (line.includes('frame=') || line.includes('Stream') || line.includes('error') || line.includes('Error')) {
      process.stderr.write(d);
    }
  });

  ff.on('close', code => {
    console.log(`\n📡 Stream ended (code ${code})`);
  });

  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping stream...');
    ff.kill('SIGINT');
    process.exit(0);
  });
}

async function streamPlaylist(videos) {
  console.log(`\n📡 Streaming playlist (${videos.length} videos) to ${RTMP_URL}\n`);
  for (let i = 0; i < videos.length; i++) {
    console.log(`\n▶️  Playing ${i + 1}/${videos.length}: ${videos[i]}`);
    await new Promise((resolve) => {
      const ff = spawn('ffmpeg', [
        '-re', '-i', videos[i],
        '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '2500k',
        '-pix_fmt', 'yuv420p', '-g', '60',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
        '-f', 'flv',
        RTMP_URL
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      ff.stderr.on('data', d => {
        const line = d.toString();
        if (line.includes('frame=')) process.stderr.write(d);
      });

      ff.on('close', () => resolve());
    });
  }
  console.log('\n📡 Playlist complete');
}
