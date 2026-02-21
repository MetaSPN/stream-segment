#!/usr/bin/env node
/**
 * Colbert-style segment assembler: script JSON → slides + TTS → MP4.
 *
 * Usage:
 *   assemble-segment --script segment.json [--output out.mp4]
 *   assemble-segment --dry-run --script segment.json
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../lib/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WIDTH = 1920;
const HEIGHT = 1080;
const AVATAR_WIDTH = 680;
const SLIDE_WIDTH = WIDTH - AVATAR_WIDTH;

const args = process.argv.slice(2);
const scriptPath = args[args.indexOf('--script') + 1];
const outputPath = args.includes('--output') ? args[args.indexOf('--output') + 1] : null;
const dryRun = args.includes('--dry-run');
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
  console.error('Usage: assemble-segment --script <script.json> [--output out.mp4] [--voice Daniel] [--dry-run] [--macos-tts]');
  process.exit(1);
}

const WORK_DIR = join(CONFIG.workDir, `.segment-work-${process.pid}`);
let AVATAR = CONFIG.avatarPath;
if (!existsSync(AVATAR)) {
  mkdirSync(dirname(WORK_DIR), { recursive: true });
  AVATAR = join(CONFIG.workDir, 'avatar-placeholder.png');
  if (!existsSync(AVATAR)) {
    mkdirSync(dirname(AVATAR), { recursive: true });
    spawnSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=#0d1117:s=${AVATAR_WIDTH}x${HEIGHT}:d=1`,
      '-frames:v', '1', AVATAR
    ], { stdio: 'pipe' });
  }
}

if (existsSync(WORK_DIR)) {
  readdirSync(WORK_DIR).forEach(f => unlinkSync(join(WORK_DIR, f)));
} else {
  mkdirSync(WORK_DIR, { recursive: true });
}

const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
console.log(`\n🎬 Segment: ${script.title}`);
console.log(`   ${script.beats.length} beats\n`);

console.log('🎤 Generating TTS...');
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
  console.log(`   Beat ${i}: ${duration.toFixed(1)}s — "${beat.text.slice(0, 50)}..."`);
}

console.log('\n🖼️  Generating slides...');
const beatSlides = [];
for (let i = 0; i < script.beats.length; i++) {
  const beat = script.beats[i];
  const slidePng = join(WORK_DIR, `slide-${i}.png`);

  if (beat.slideImage && existsSync(beat.slideImage)) {
    spawnSync('cp', [beat.slideImage, slidePng]);
  } else {
    const slideHtml = generateSlideHtml(beat, i, script);
    const htmlPath = join(WORK_DIR, `slide-${i}.html`);
    writeFileSync(htmlPath, slideHtml);

    const wk = spawnSync('which', ['wkhtmltoimage'], { encoding: 'utf8' });
    if (wk.stdout.trim()) {
      spawnSync('wkhtmltoimage', ['--encoding', 'utf-8', '--width', String(SLIDE_WIDTH), '--height', String(HEIGHT), '--quality', '95', htmlPath, slidePng], { stdio: 'pipe' });
    } else {
      const title = beat.slideTitle || script.title;
      const body = (beat.slideBody || beat.slide || beat.text.slice(0, 80)).replace(/\n/g, ' ');
      const accent = beat.slideAccent || 'white';
      const filters = [
        `drawtext=text='${title.replace(/'/g, "\\\\'")}':fontsize=40:fontcolor=${accent}:x=(w-tw)/2:y=120:fontfile=/System/Library/Fonts/Helvetica.ttc`,
        `drawtext=text='${body.replace(/'/g, "\\\\'")}':fontsize=56:fontcolor=white:x=(w-tw)/2:y=(h-th)/2:fontfile=/System/Library/Fonts/Helvetica.ttc`,
        `drawtext=text='METASPN':fontsize=14:fontcolor=0x555555:x=w-tw-40:y=30:fontfile=/System/Library/Fonts/Helvetica.ttc`
      ].join(',');
      spawnSync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', `color=c=#0d1117:s=${SLIDE_WIDTH}x${HEIGHT}:d=1`,
        '-vf', filters,
        '-frames:v', '1', slidePng
      ], { stdio: 'pipe' });
    }
  }
  beatSlides.push(slidePng);
  console.log(`   Slide ${i}: ${slidePng}`);
}

if (dryRun) {
  console.log('\n✅ Dry run complete. Files in:', WORK_DIR);
  const totalDuration = beatAudio.reduce((s, b) => s + b.duration, 0);
  console.log(`   Total duration: ${totalDuration.toFixed(1)}s`);
  process.exit(0);
}

console.log('\n🎬 Assembling beats...');
const beatVideos = [];
for (let i = 0; i < script.beats.length; i++) {
  const beatMp4 = join(WORK_DIR, `beat-${i}.mp4`);
  const duration = beatAudio[i].duration + 0.5;

  spawnSync('ffmpeg', [
    '-y',
    '-f', 'lavfi', '-i', `color=c=#0d1117:s=${WIDTH}x${HEIGHT}:d=${duration}`,
    '-i', AVATAR,
    '-i', beatSlides[i],
    '-i', beatAudio[i].path,
    '-filter_complex', [
      `[1:v]scale=${AVATAR_WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${AVATAR_WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=#0d1117[avatar]`,
      `[2:v]scale=${SLIDE_WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${SLIDE_WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=#1a2332[slide]`,
      `[0:v][avatar]overlay=0:0[bg1]`,
      `[bg1][slide]overlay=${AVATAR_WIDTH}:0[out]`
    ].join(';'),
    '-map', '[out]',
    '-map', '3:a',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest',
    beatMp4
  ], { stdio: 'pipe' });

  beatVideos.push(beatMp4);
  console.log(`   Beat ${i}: ✓`);
}

console.log('\n🔗 Concatenating...');
const concatList = join(WORK_DIR, 'concat.txt');
writeFileSync(concatList, beatVideos.map(v => `file '${v}'`).join('\n'));

const output = outputPath || join(CONFIG.paths.output, `segment-${Date.now()}.mp4`);
mkdirSync(dirname(output), { recursive: true });
spawnSync('ffmpeg', [
  '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
  '-c', 'copy', output
], { stdio: 'pipe' });

console.log(`\n✅ Segment assembled: ${output}`);
const probe = spawnSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', output], { encoding: 'utf8' });
console.log(`   Duration: ${parseFloat(probe.stdout.trim()).toFixed(1)}s`);

function generateSlideHtml(beat, index, script) {
  const title = beat.slideTitle || script.title;
  const body = beat.slideBody || beat.slide || beat.text;
  const accent = beat.slideAccent || '#00d4aa';
  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${SLIDE_WIDTH}px; height: ${HEIGHT}px;
    background: #0d1117;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: white;
    margin: 0; padding: 0;
  }
  table.layout { width: 100%; height: ${HEIGHT}px; border-collapse: collapse; }
  table.layout td { text-align: center; vertical-align: middle; padding: 60px 80px; }
  .title { font-size: 36px; font-weight: 700; color: ${accent}; text-transform: uppercase; letter-spacing: 3px; padding-bottom: 30px; }
  .body { font-size: 36px; font-weight: 300; line-height: 1.5; color: #e0e0e0; }
  .beat-num { position: absolute; bottom: 30px; right: 40px; font-size: 14px; color: #555; }
  .brand { position: absolute; top: 30px; right: 40px; font-size: 14px; color: #555; letter-spacing: 2px; }
</style></head><body>
  <div class="brand">METASPN</div>
  <table class="layout"><tr><td>
    <div class="title">${escapeHtml(title)}</div>
    <div class="body">${escapeHtml(body).replace(/\n/g, '<br>')}</div>
  </td></tr></table>
  <div class="beat-num">${index + 1}/${script.beats.length}</div>
</body></html>`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
