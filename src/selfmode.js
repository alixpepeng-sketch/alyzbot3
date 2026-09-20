import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = path.join(config.dbDir, 'selfmode.json');
let cache = null;

function save() {
  fs.mkdirSync(config.dbDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache, null, 2));
}

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    cache = { self: raw.self !== false };
  } catch {
    // File belum ada atau rusak: default self mode ON
    cache = { self: true };
    save();
  }
  return cache;
}

export const isSelfMode = () => load().self;

export function setSelfMode(value) {
  load();
  cache.self = Boolean(value);
  save();
  return cache.self;
}
