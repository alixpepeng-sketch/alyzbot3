import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`))
    );
  });
}

// Durasi dalam detik. ffmpeg -i tanpa output selalu exit 1, jadi baca stderr saja.
function probeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', () => resolve(0));
    p.on('close', () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0);
    });
  });
}

async function withTemp(buffer, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alyz-'));
  const input = path.join(dir, 'in.mp4');
  try {
    await fs.writeFile(input, buffer);
    return await fn({ dir, input });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function makeThumb(input, dir, atSec) {
  const out = path.join(dir, 'thumb.jpg');
  await run(['-ss', String(atSec), '-i', input, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out]);
  return fs.readFile(out);
}

const H264_AAC = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart'
];

/** Video biasa jadi video note: persegi 480x480, maksimal 60 detik. */
export function toVideoNote(buffer) {
  return withTemp(buffer, async ({ dir, input }) => {
    const out = path.join(dir, 'note.mp4');
    await run([
      '-i', input, '-t', '60',
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=480:480,setsar=1",
      ...H264_AAC, out
    ]);
    const duration = Math.min(await probeDuration(out), 60);
    const thumbnail = await makeThumb(out, dir, 0).catch(() => undefined);
    return { buffer: await fs.readFile(out), thumbnail, seconds: Math.max(1, Math.round(duration)) };
  });
}

/** Video biasa jadi klip pendek (maks 3 detik) untuk foto live. */
export function toLivePhoto(buffer) {
  return withTemp(buffer, async ({ dir, input }) => {
    const out = path.join(dir, 'live.mp4');
    await run([
      '-i', input, '-t', '3',
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale='trunc(min(720,iw)/2)*2':-2,setsar=1",
      ...H264_AAC, out
    ]);
    const duration = (await probeDuration(out)) || 3;
    const offsetMs = Math.round((duration * 1000) / 2);
    const thumbnail = await makeThumb(out, dir, offsetMs / 1000).catch(() => undefined);
    return {
      buffer: await fs.readFile(out),
      thumbnail,
      seconds: Math.max(1, Math.ceil(duration)),
      offsetMs
    };
  });
}
