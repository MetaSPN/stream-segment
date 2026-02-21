#!/usr/bin/env node
/**
 * Update nginx RTMP relay destinations from destinations.json.
 * Regenerates config and optionally reloads nginx.
 *
 * Usage:
 *   update-rtmp-destinations [--list]
 *   update-rtmp-destinations --add YouTube <stream-key>
 *   update-rtmp-destinations --disable YouTube
 *
 * Set SEGMENT_STREAM_NGINX_CONF to nginx config path (e.g. /opt/homebrew/etc/nginx/nginx.conf).
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEST_FILE = join(__dirname, 'destinations.json');
const NGINX_CONF = process.env.SEGMENT_STREAM_NGINX_CONF || '/opt/homebrew/etc/nginx/nginx.conf';

const args = process.argv.slice(2);
let destinations;
try {
  destinations = JSON.parse(readFileSync(DEST_FILE, 'utf8'));
} catch (e) {
  console.error('Could not read', DEST_FILE, e.message);
  process.exit(1);
}

if (args[0] === '--add') {
  const name = args[1];
  const key = args[2];
  const dest = destinations.destinations.find(d => d.name.toLowerCase() === name.toLowerCase());
  if (!dest) {
    console.error(`Unknown destination: ${name}. Known: ${destinations.destinations.map(d => d.name).join(', ')}`);
    process.exit(1);
  }
  dest.enabled = true;
  dest.key = key || dest.key || '';
  writeFileSync(DEST_FILE, JSON.stringify(destinations, null, 2));
  console.log(`✅ Enabled ${dest.name}`);
}

if (args[0] === '--disable') {
  const name = args[1];
  const dest = destinations.destinations.find(d => d.name.toLowerCase() === name.toLowerCase());
  if (dest) {
    dest.enabled = false;
    writeFileSync(DEST_FILE, JSON.stringify(destinations, null, 2));
  }
  console.log(`✅ Disabled ${name}`);
}

if (args[0] === '--list') {
  destinations.destinations.forEach(d => {
    console.log(`${d.enabled ? '🟢' : '⚫'} ${d.name}: ${d.rtmp}${d.key ? '****' : '(no key)'}`);
  });
  console.log('\nIngest URL: rtmp://localhost:1935/live/marvin');
  process.exit(0);
}

const pushLines = destinations.destinations
  .filter(d => d.enabled && d.key)
  .map(d => `            push ${d.rtmp}${d.key};`)
  .join('\n');

const rtmpBlock = `rtmp {
    server {
        listen 1935;
        chunk_size 4096;
        
        application live {
            live on;
            record off;
            
${pushLines || '            # No destinations configured. Use --add <name> <key>'}
            
            hls on;
            hls_path /tmp/segment-stream-hls;
            hls_fragment 3;
            hls_playlist_length 60;
        }
    }
}`;

let conf;
try {
  conf = readFileSync(NGINX_CONF, 'utf8');
} catch (e) {
  console.error('Could not read nginx config at', NGINX_CONF);
  console.error('Set SEGMENT_STREAM_NGINX_CONF to your nginx.conf path.');
  process.exit(1);
}

const rtmpStart = conf.indexOf('rtmp {');
if (rtmpStart !== -1) {
  let depth = 0, end = rtmpStart;
  for (let i = rtmpStart; i < conf.length; i++) {
    if (conf[i] === '{') depth++;
    if (conf[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  conf = conf.slice(0, rtmpStart) + rtmpBlock + conf.slice(end);
} else {
  conf += '\n' + rtmpBlock + '\n';
}

writeFileSync(NGINX_CONF, conf);
console.log('✅ nginx.conf updated');

try {
  execSync('nginx -s reload', { stdio: 'pipe' });
  console.log('✅ nginx reloaded');
} catch {
  console.log('⚠️ nginx not running. Start with: nginx');
}

const enabled = destinations.destinations.filter(d => d.enabled);
console.log(`\n📡 Active destinations: ${enabled.length}`);
enabled.forEach(d => console.log(`   → ${d.name}`));
console.log(`\n🔗 Ingest URL: rtmp://localhost:1935/live/marvin`);
