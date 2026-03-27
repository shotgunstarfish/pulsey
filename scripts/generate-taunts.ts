/**
 * Pre-generates taunt audio from DashScope TTS (Momo voice).
 * Saves MP3 files to public/taunts/{group}/{idx}.mp3 (WAV → MP3 via FFmpeg).
 *
 * Usage:
 *   DASHSCOPE_API_KEY=sk-xxx node --experimental-strip-types scripts/generate-taunts.ts
 *
 * Re-run safely — skips files that already exist unless --force is passed.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { MESSAGES } from '../src/engine/encouragementText.ts';

const FFMPEG = process.env.FFMPEG_PATH ?? 'E:\\tools\\ffmpeg\\bin\\ffmpeg.exe';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --voice <Name>   selects the DashScope voice (default: Momo)
// --model <name>   overrides the TTS model (default: qwen3-tts-instruct-flash)
const voiceArgIdx = process.argv.indexOf('--voice');
const VOICE       = voiceArgIdx >= 0 ? (process.argv[voiceArgIdx + 1] ?? 'Momo') : 'Momo';
const VOICE_DIR   = VOICE.toLowerCase();

const modelArgIdx = process.argv.indexOf('--model');
const MODEL_ARG   = modelArgIdx >= 0 ? (process.argv[modelArgIdx + 1] ?? '') : '';

const PUBLIC_DIR = join(__dirname, '..', 'public', 'taunts', VOICE_DIR);
const FORCE      = process.argv.includes('--force');

const API_KEY = process.env.DASHSCOPE_API_KEY;
if (!API_KEY) {
  console.error('Error: DASHSCOPE_API_KEY environment variable is required');
  process.exit(1);
}

const API_URL    = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const MODEL      = MODEL_ARG || 'qwen3-tts-instruct-flash';
// instructions only supported on instruct-variant models
const IS_INSTRUCT  = MODEL.includes('instruct');
const INSTRUCTIONS = 'Speak with a teasing, sarcastic, encouraging tone — like someone who is rooting for you ' +
                     'but also enjoying watching you struggle. Playful cruelty. Confident and amused. ' +
                     'Short phrases land with weight. Never shout, but never boring. ' +
                     'Think: smug AI that finds the whole situation entertaining.';

const RATE_LIMIT_MS = 2000; // 2s between calls

async function generateOne(text: string, outputPath: string): Promise<void> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: {
        text,
        voice: VOICE,
        language_type: 'English',
        ...(IS_INSTRUCT ? { instructions: INSTRUCTIONS } : {}),
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }

  const json = await res.json() as { output?: { audio?: { url?: string } } };
  const audioUrl = json.output?.audio?.url;
  if (!audioUrl) throw new Error(`No audio URL in response: ${JSON.stringify(json)}`);

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Download failed ${audioRes.status}`);

  const wavBuffer = Buffer.from(await audioRes.arrayBuffer());

  // Convert WAV → MP3 via FFmpeg
  const result = spawnSync(FFMPEG, [
    '-i', 'pipe:0',
    '-f', 'mp3', '-q:a', '4',
    '-loglevel', 'error',
    'pipe:1',
  ], { input: wavBuffer, maxBuffer: 10 * 1024 * 1024 });

  if (result.status !== 0) {
    throw new Error(`FFmpeg failed: ${result.stderr?.toString()}`);
  }

  writeFileSync(outputPath, result.stdout);
  console.log(`  ✓  [${result.stdout.length} bytes MP3]  ${text}`);
}

async function main() {
  console.log(`Voice: ${VOICE}  Model: ${MODEL}  →  public/taunts/${VOICE_DIR}/`);
  let total = 0, skipped = 0, failed = 0;

  for (const [group, texts] of Object.entries(MESSAGES)) {
    const dir = join(PUBLIC_DIR, group);
    mkdirSync(dir, { recursive: true });
    console.log(`\n── ${group} (${texts.length} lines) ──`);

    for (let i = 0; i < texts.length; i++) {
      const outputPath = join(dir, `${i}.mp3`);
      total++;

      if (!FORCE && existsSync(outputPath)) {
        console.log(`  –  [skip]  ${texts[i]}`);
        skipped++;
        continue;
      }

      try {
        await generateOne(texts[i], outputPath);
      } catch (err) {
        console.error(`  ✗  [fail]  ${texts[i]}\n     ${(err as Error).message}`);
        failed++;
      }

      // Respect rate limit between calls
      const isLast = i === texts.length - 1 && group === Object.keys(MESSAGES).at(-1);
      if (!isLast) await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  console.log(`\nDone. ${total} total — ${skipped} skipped, ${failed} failed, ${total - skipped - failed} generated.`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
