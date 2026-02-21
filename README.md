# segment-stream

Colbert-style segment video assembly (script JSON → slides + TTS → MP4) and RTMP streaming. One package for generating talking-head + slides segments and pushing them to YouTube, Twitch, or any RTMP endpoint.

## Requirements

- **Node.js** 18+
- **ffmpeg** (and optionally **ffprobe**, **wkhtmltoimage** for HTML slides)
- **macOS**: `say` for fallback TTS; **ElevenLabs** optional for better voice
- **Streaming**: nginx with RTMP module, or push directly to platform RTMP URLs

## Install

```bash
npm install segment-stream
# or
pnpm add segment-stream
```

Global install for CLIs:

```bash
npm install -g segment-stream
```

## Quick start

1. **Script format** — JSON with `title` and `beats` (each beat: `text`, optional `slideTitle`, `slideBody`, `slideAccent`):

```json
{
  "title": "My Segment",
  "beats": [
    {
      "text": "Welcome to the show. Here is the first point.",
      "slideTitle": "INTRO",
      "slideBody": "First point"
    }
  ]
}
```

2. **Assemble a segment** (landscape 1920×1080, avatar left + slides right):

```bash
npx assemble-segment --script segment.json --output out.mp4
```

Use `--macos-tts` to use macOS `say` instead of ElevenLabs.

3. **Stream to RTMP** (e.g. after starting nginx with RTMP):

```bash
npx go-live --video out.mp4
# or loop
npx go-live --video out.mp4 --loop
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `ELEVENLABS_API_KEY` | ElevenLabs TTS (optional; falls back to macOS `say`) |
| `ELEVENLABS_VOICE_ID` | Voice ID (defaults to Daniel if unset) |
| `SEGMENT_STREAM_AVATAR` | Path to avatar image for left panel (default: package `assets/avatar.png` or generated placeholder) |
| `SEGMENT_STREAM_OUTPUT` | Output directory (default: `<cwd>/.segment-stream`) |
| `SEGMENT_STREAM_RTMP_URL` | Default RTMP ingest URL (default: `rtmp://localhost:1935/live/marvin`) |
| `SEGMENT_STREAM_NOTIFY_URL` | Optional webhook URL for stream_live events (e.g. `stream-scheduler`) |
| `SEGMENT_STREAM_NGINX_CONF` | nginx config path for `update-rtmp-destinations` |

## CLI commands

| Command | Description |
|---------|-------------|
| `assemble-segment` | Script JSON → MP4 (landscape, avatar + slides) |
| `assemble-mood-short` | Script JSON + optional art → portrait MP4 (Shorts) |
| `go-live` | Stream a single file or playlist to RTMP |
| `stream-scheduler` | Assemble from show/episode or video, then stream for a set duration |
| `stream-engine` | Playlist player: reads `playlist.json`, plays clips to RTMP in a loop |
| `recursive-stream` | Data-driven loop: fetch data → generate script → render → stream → repeat |
| `materialize` | Resolve data bindings in source JSON and render video |
| `update-rtmp-destinations` | Update nginx RTMP push destinations from `rtmp/destinations.json` |

## Programmatic use

```js
import { CONFIG } from 'segment-stream';
import { generateScript } from 'segment-stream/generators/script';
import { generateTTS } from 'segment-stream/generators/tts';
import { createSegment, appendToFeed } from 'segment-stream/generators/json-segment';
```

- **CONFIG** — paths (`paths.output`, `paths.segments`, `paths.feed`), `avatarPath`, `workDir`, `tokens`, thresholds.
- **generateScript(eventType, eventData)** — returns `{ script, wordCount, estimatedDurationSec }`. Requires `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`.
- **generateTTS(script, segmentId, { engine: 'elevenlabs' \| 'macos' })** — returns `{ audioPath, durationSec }`.
- **createSegment / appendToFeed** — build and append structured segment to feed JSON.

## Playlist format (stream-engine)

In the queue directory (e.g. `.segment-stream/queue/`), create `playlist.json`:

```json
{
  "clips": [
    { "id": "intro", "path": "clips/intro.mp4", "priority": "pinned", "position": 0, "title": "Intro", "addedAt": "2026-02-21T12:00:00Z" },
    { "id": "main", "path": "clips/main.mp4", "priority": "normal", "title": "Main", "addedAt": "2026-02-21T12:05:00Z" }
  ]
}
```

Priorities: `pinned` (play first, by `position`), `breaking` (insert next), `normal` (by `addedAt`), `filler`.

## License

MIT
