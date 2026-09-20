import express from 'express';
import path from 'node:path';
import { ROOT, config } from './config.js';
import { log } from './logger.js';
import { getStatus, requestPairing, normalizeNumber, PairError } from './bot.js';

const lastPairAt = new Map();

// Mengembalikan sisa detik jika masih dalam cooldown, 0 jika boleh lanjut
function cooldownLeft(ip) {
  const now = Date.now();
  const wait = config.pairCooldownMs - (now - (lastPairAt.get(ip) || 0));
  if (wait > 0) return Math.ceil(wait / 1000);
  lastPairAt.set(ip, now);
  return 0;
}

async function handlePair(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    const number = normalizeNumber(req.body?.number ?? req.query.number);

    const wait = cooldownLeft(req.ip);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return res.status(429).json({
        ok: false,
        error: `Tunggu ${wait} detik sebelum meminta kode lagi.`,
        retryAfter: wait
      });
    }

    const code = await requestPairing(number);
    return res.json({ ok: true, code });
  } catch (err) {
    if (err instanceof PairError) return res.status(err.status).json({ ok: false, error: err.message });
    log.error({ err }, 'pair error');
    return res.status(500).json({ ok: false, error: 'Terjadi kesalahan pada server.' });
  }
}

export function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(ROOT, 'public')));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/status', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(getStatus());
  });
  app.route('/pair').get(handlePair).post(handlePair);

  app.listen(config.port, '0.0.0.0', () => log.info(`Server berjalan di port ${config.port}`));

  // Bersihkan catatan rate limit yang sudah lewat
  setInterval(() => {
    const limit = Date.now() - config.pairCooldownMs;
    for (const [ip, at] of lastPairAt) if (at < limit) lastPairAt.delete(ip);
  }, 60_000).unref();

  // Render menyediakan RENDER_EXTERNAL_URL otomatis, tidak perlu hardcode domain
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl) {
    setInterval(() => fetch(`${selfUrl}/health`).catch(() => {}), 10 * 60 * 1000).unref();
  }
}
