/**
 * TTS: ElevenLabs or macOS `say`.
 */

import { writeFile } from 'fs/promises';
import { execSync } from 'child_process';
import { join } from 'path';
import { CONFIG } from '../lib/config.mjs';

/**
 * Generate TTS audio from script text.
 * Returns { audioPath: string, durationSec: number }
 */
export async function generateTTS(script, segmentId, options = {}) {
  const { engine = 'elevenlabs' } = options;
  switch (engine) {
    case 'elevenlabs':
      return await elevenLabsTTS(script, segmentId);
    case 'macos':
      return await macosTTS(script, segmentId);
    default:
      throw new Error(`Unknown TTS engine: ${engine}`);
  }
}

async function elevenLabsTTS(script, segmentId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn('No ELEVENLABS_API_KEY — falling back to macOS TTS');
    return macosTTS(script, segmentId);
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'onwK4e9ZLuTAKqWW03F9';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: script,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.7, similarity_boost: 0.8, style: 0.25, use_speaker_boost: false }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs API error: ${response.status} — ${err}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const audioPath = join(CONFIG.paths.segments, `${segmentId}.mp3`);
  await writeFile(audioPath, audioBuffer);

  const wordCount = script.split(/\s+/).length;
  const durationSec = Math.round(wordCount / 2.7);
  return { audioPath, durationSec };
}

async function macosTTS(script, segmentId) {
  const audioPath = join(CONFIG.paths.segments, `${segmentId}.aiff`);
  const escaped = script.replace(/"/g, '\\"').replace(/`/g, '\\`');
  execSync(`say -v Daniel -o "${audioPath}" "${escaped}"`, { timeout: 30000 });
  const wordCount = script.split(/\s+/).length;
  const durationSec = Math.round(wordCount / 2.7);
  return { audioPath, durationSec };
}
