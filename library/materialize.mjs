#!/usr/bin/env node
/**
 * Materializer: source JSON with data bindings → resolved script → video via assemble-segment.
 *
 * Usage:
 *   materialize <source.json> [--voice macos|elevenlabs] [--aspect 16:9] [--output dir/]
 *   materialize <source.json> --resolve-only
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { CONFIG } from '../lib/config.mjs';
import { PKG_ROOT } from '../lib/pkg-root.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSEMBLE = join(PKG_ROOT, 'cli', 'assemble-segment.mjs');
const STATE_FILE = CONFIG.paths.recursiveState;

const args = process.argv.slice(2);
const sourcePath = args.find(a => !a.startsWith('--'));
const voiceOverride = args.includes('--voice') ? args[args.indexOf('--voice') + 1] : null;
const aspectOverride = args.includes('--aspect') ? args[args.indexOf('--aspect') + 1] : '16:9';
const outputDir = args.includes('--output') ? args[args.indexOf('--output') + 1] : join(process.cwd(), '.segment-stream', 'renders');
const resolveOnly = args.includes('--resolve-only');

if (!sourcePath) {
  console.error('Usage: materialize <source.json> [--voice macos|elevenlabs] [--output dir/] [--resolve-only]');
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

async function resolveBinding(uri) {
  const [provider, ...rest] = uri.split(':');

  switch (provider) {
    case 'static':
      return rest.join(':');

    case 'dexscreener': {
      const [token, ...fieldPath] = rest;
      try {
        const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token}`);
        const data = await resp.json();
        const pair = data.pairs?.[0];
        if (!pair) return '?';
        let val = pair;
        for (const key of fieldPath.join(':').split('.')) {
          val = val?.[key];
        }
        return typeof val === 'number' ? Math.round(val).toLocaleString() : String(val ?? '?');
      } catch { return '?'; }
    }

    case 'state': {
      try {
        const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
        const path = rest.join(':');
        if (path === 'iteration') return String(state.iteration || 0);
        if (path === 'history[-1].mc') {
          const h = state.history;
          return h?.length ? Math.round(h[h.length - 1].mc).toLocaleString() : '?';
        }
        return '?';
      } catch { return '?'; }
    }

    case 'system': {
      const fn = rest[0];
      const tz = rest[1] || 'America/New_York';
      if (fn === 'now') return new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true });
      if (fn === 'date') return new Date().toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' });
      return new Date().toISOString();
    }

    case 'computed': {
      const fn = rest[0];
      if (fn === 'days_since') {
        const start = new Date(rest[1]);
        return String(Math.floor((Date.now() - start) / 86400000));
      }
      return '?';
    }

    default:
      return uri;
  }
}

async function resolveAllBindings(bindings) {
  const resolved = {};
  for (const [key, uri] of Object.entries(bindings || {})) {
    resolved[key] = await resolveBinding(uri);
  }
  return resolved;
}

function interpolate(text, vars) {
  if (!text) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

async function main() {
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  console.log(`\n📖 Source: ${source.metadata?.title || source.title}`);
  console.log(`   Beats: ${source.beats?.length}`);

  const vars = await resolveAllBindings(source.data_bindings);
  for (const [k, v] of Object.entries(vars)) {
    console.log(`   ${k}: ${v}`);
  }

  const resolvedBeats = (source.beats || []).map(beat => ({
    text: interpolate(beat.text, vars),
    slideTitle: interpolate(beat.slideTitle, vars),
    slideBody: interpolate(beat.slideBody, vars),
    slideAccent: beat.slideAccent?.includes('{{') ? '#00d4aa' : beat.slideAccent,
    ...(beat.slideImage ? { slideImage: beat.slideImage } : {})
  }));

  const resolvedScript = {
    title: interpolate(source.metadata?.title || source.title, vars),
    beats: resolvedBeats
  };

  if (resolveOnly) {
    console.log('\n📋 Resolved script:');
    console.log(JSON.stringify(resolvedScript, null, 2));
    return;
  }

  const voice = voiceOverride || source.render?.voice?.split(':')?.[0] || 'macos';
  const ttsFlag = voice === 'macos' ? '--macos-tts' : '';

  const scriptFile = join(outputDir, `${source.id || 'out'}-resolved.json`);
  writeFileSync(scriptFile, JSON.stringify(resolvedScript, null, 2));

  const outputFile = join(outputDir, `${source.id || 'out'}.${aspectOverride.replace(':', 'x')}.${voice}.mp4`);

  console.log(`\n🎬 Rendering: ${outputFile}`);
  const result = spawnSync('node', [
    ASSEMBLE,
    '--script', scriptFile,
    '--output', outputFile,
    ...(ttsFlag ? [ttsFlag] : [])
  ], { stdio: 'inherit', timeout: 300000 });

  if (result.status === 0) {
    console.log(`\n✅ Materialized: ${outputFile}`);
  } else {
    console.error(`\n❌ Render failed (code ${result.status})`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('💀 Materializer failed:', e);
  process.exit(1);
});
