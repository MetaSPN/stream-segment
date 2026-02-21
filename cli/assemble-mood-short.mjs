#!/usr/bin/env node
/**
 * Portrait (1080x1920) mood short: script JSON + optional art → MP4.
 *
 * Usage:
 *   assemble-mood-short --script mood-segment.json [--art art.png] [--output out.mp4] [--macos-tts]
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../lib/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIDTH = 1080;
const HEIGHT = 1920;

const args = process.argv.slice(2);
const scriptPath = args[args.indexOf('--script') + 1];
const artPath = args.includes('--art') ? args[args.indexOf('--art') + 1] : null;
const outputPath = args.includes('--output') ? args[args.indexOf('--output') + 1] : null;
const voice = args.includes('--voice') ? args[args.indexOf('--voice') + 1] : 'Daniel';
const useElevenLabs = !args.includes('--macos-tts');

function getElevenLabsEnv() {
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
    return { apiKey: process.env.ELEVENLABS_API_KEY, voiceId: process.env.ELEVENLABS_VOICE_ID };
  }
  try {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
      const env = readFileSync(join(home, '.marvin/secrets/elevenlabs.env'), 'utf8');
      const apiKey = env.match(/ELEVENLABS_API_KEY=(.+)/)?.[1]?.trim() || '';
      const voiceId = env.match(/ELEVENLABS_VOICE_ID=(.+)/)?.[1]?.trim() || '';
      if (apiKey && voiceId) return { apiKey, voiceId };
    }
  } catch {}
  return { apiKey: '', voiceId: '' };
}

const { apiKey: EL_API_KEY, voiceId: EL_VOICE_ID } = getElevenLabsEnv();

if (!scriptPath) {
  console.error('Usage: assemble-mood-short --script <script.json> [--art art.png] [--output out.mp4] [--macos-tts]');
  process.exit(1);
}

const WORK_DIR = join(CONFIG.workDir, `.mood-short-work-${process.pid}`);
if (existsSync(WORK_DIR)) {
  readdirSync(WORK_DIR).forEach(f => unlinkSync(join(WORK_DIR, f)));
} else {
  mkdirSync(WORK_DIR, { recursive: true });
}

const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
console.log(`\n🎬 Mood Short: ${script.title}`);
console.log(`   ${script.beats.length} beats | Portrait ${WIDTH}x${HEIGHT}`);
if (artPath) console.log(`   🎨 Art: ${artPath}`);

console.log('\n🎤 Generating TTS...');
const beatAudio = [];
for (let i = 0; i < script.beats.length; i++) {
  const beat = script.beats[i];
  const wavPath = join(WORK_DIR, `beat-${i}.wav`);

  if (useElevenLabs && EL_API_KEY && EL_VOICE_ID) {
    const mp3Path = join(WORK_DIR, `beat-${i}.mp3`);
    spawnSync('curl', [
      '-s', '-X', 'POST',
      `https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE_ID}`,
      '-H', `xi-api-key: ${EL_API_KEY}`,
      '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({
        text: beat.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      }),
      '--output', mp3Path
    ], { stdio: 'pipe' });
    spawnSync('ffmpeg', ['-y', '-i', mp3Path, '-ar', '44100', '-ac', '1', wavPath], { stdio: 'pipe' });
  } else {
    const audioPath = join(WORK_DIR, `beat-${i}.aiff`);
    spawnSync('say', ['-v', voice, '-o', audioPath, beat.text]);
    spawnSync('ffmpeg', ['-y', '-i', audioPath, '-ar', '44100', '-ac', '1', wavPath], { stdio: 'pipe' });
  }

  const probe = spawnSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', wavPath], { encoding: 'utf8' });
  const duration = parseFloat(probe.stdout.trim()) || 5;
  beatAudio.push({ path: wavPath, duration, text: beat.text });
  console.log(`   Beat ${i}: ${duration.toFixed(1)}s`);
}

console.log('\n🖼️  Creating text overlays...');
for (let i = 0; i < script.beats.length; i++) {
  const beat = script.beats[i];
  const overlayPng = join(WORK_DIR, `overlay-${i}.png`);
  const title = (beat.slideTitle || script.title).replace(/'/g, "'\\''");
  const body = (beat.slideBody || '').replace(/\n/g, '  ').replace(/'/g, "'\\''").slice(0, 200);
  const accent = beat.slideAccent || '#00d4aa';
  spawnSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `color=c=0x000000@0.7:s=${WIDTH}x500:d=1`,
    '-vf', [
      `drawtext=text='${title}':fontsize=48:fontcolor=${accent}:x=(w-tw)/2:y=60:fontfile=/System/Library/Fonts/Helvetica.ttc:font=Helvetica-Bold`,
      `drawtext=text='${body}':fontsize=32:fontcolor=white:x=(w-tw)/2:y=160:fontfile=/System/Library/Fonts/Helvetica.ttc`
    ].join(','),
    '-frames:v', '1', overlayPng
  ], { stdio: 'pipe' });
}

console.log('\n🎬 Assembling portrait beats...');
const beatVideos = [];
for (let i = 0; i < script.beats.length; i++) {
  const beatMp4 = join(WORK_DIR, `beat-${i}.mp4`);
  const duration = beatAudio[i].duration + 0.5;

  const filterParts = [];
  const inputs = ['-f', 'lavfi', '-i', `color=c=#0d1117:s=${WIDTH}x${HEIGHT}:d=${duration}`];
  let streamIdx = 1;

  if (artPath && existsSync(artPath)) {
    inputs.push('-i', artPath);
    filterParts.push(`[${streamIdx}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1[art]`);
    filterParts.push(`[0:v][art]overlay=0:0:shortest=1[bg]`);
    streamIdx++;
  } else {
    filterParts.push(`[0:v]copy[bg]`);
  }

  inputs.push('-f', 'lavfi', '-i', `color=c=0x000000:s=${WIDTH}x600:d=${duration}`);
  filterParts.push(`[${streamIdx}:v]format=rgba,colorchannelmixer=aa=0.75[darkband]`);
  filterParts.push(`[bg][darkband]overlay=0:${HEIGHT - 600}[bg2]`);
  streamIdx++;

  const beat = script.beats[i];
  const title = (beat.slideTitle || script.title).replace(/'/g, "'\\\\\\''").replace(/:/g, '\\:');
  const bodyLines = (beat.slideBody || '').split('\n').slice(0, 6);
  let textFilters = `drawtext=text='${title}':fontsize=52:fontcolor=${beat.slideAccent || '#00d4aa'}:x=(w-tw)/2:y=${HEIGHT - 520}:fontfile=/System/Library/Fonts/Helvetica.ttc`;
  for (let j = 0; j < bodyLines.length; j++) {
    const line = bodyLines[j].replace(/'/g, "'\\\\\\''").replace(/:/g, '\\:').replace(/\$/g, '\\$');
    if (line.trim()) {
      textFilters += `,drawtext=text='${line}':fontsize=36:fontcolor=white:x=(w-tw)/2:y=${HEIGHT - 440 + j * 50}:fontfile=/System/Library/Fonts/Helvetica.ttc`;
    }
  }
  textFilters += `,drawtext=text='METASPN':fontsize=18:fontcolor=0xffffff@0.3:x=w-tw-30:y=30:fontfile=/System/Library/Fonts/Helvetica.ttc`;
  filterParts.push(`[bg2]${textFilters}[out]`);
  inputs.push('-i', beatAudio[i].path);

  spawnSync('ffmpeg', [
    '-y',
    ...inputs,
    '-filter_complex', filterParts.join(';'),
    '-map', '[out]',
    '-map', `${streamIdx}:a`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest',
    beatMp4
  ], { stdio: 'pipe' });

  if (!existsSync(beatMp4)) {
    if (artPath && existsSync(artPath)) {
      spawnSync('ffmpeg', [
        '-y', '-loop', '1', '-i', artPath, '-i', beatAudio[i].path,
        '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-shortest', '-pix_fmt', 'yuv420p',
        beatMp4
      ], { stdio: 'pipe' });
    } else {
      spawnSync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', `color=c=#0d1117:s=${WIDTH}x${HEIGHT}:d=${duration}`,
        '-i', beatAudio[i].path,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-shortest',
        beatMp4
      ], { stdio: 'pipe' });
    }
  }
  beatVideos.push(beatMp4);
  console.log(`   Beat ${i}: ✓`);
}

console.log('\n🔗 Concatenating...');
const concatList = join(WORK_DIR, 'concat.txt');
writeFileSync(concatList, beatVideos.map(v => `file '${v}'`).join('\n'));

const output = outputPath || join(CONFIG.paths.output, `mood-short-${Date.now()}.mp4`);
mkdirSync(dirname(output), { recursive: true });
spawnSync('ffmpeg', [
  '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
  '-c', 'copy', output
], { stdio: 'pipe' });

console.log(`\n✅ Portrait mood short: ${output}`);
const probe = spawnSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', output], { encoding: 'utf8' });
console.log(`   Duration: ${parseFloat(probe.stdout.trim()).toFixed(1)}s`);
console.log(`   Resolution: ${WIDTH}x${HEIGHT} (portrait)`);
