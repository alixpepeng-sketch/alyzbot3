import { downloadMediaMessage, normalizeMessageContent } from '@whiskeysockets/baileys';
import { config } from './config.js';
import { baileysLogger, log } from './logger.js';
import { isSelfMode, setSelfMode } from './selfmode.js';
import { toVideoNote, toLivePhoto } from './ffmpeg.js';

const REACT_PROCESS = '🚀';
const REACT_DONE = '✅';
const REACT_FAIL = '❌';

class UserError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userPart = (jid) => String(jid || '').split('@')[0].split(':')[0];
const isGroup = (jid) => String(jid || '').endsWith('@g.us');

function getText(content) {
  return (
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption ||
    content?.documentMessage?.caption ||
    ''
  );
}

// Kumpulkan semua bentuk id pengirim (nomor telepon dan LID) untuk pengecekan owner/admin
async function collectSenderIds(sock, m) {
  const raw = [m.key.participant, m.key.participantAlt];
  if (!isGroup(m.key.remoteJid)) raw.push(m.key.remoteJid, m.key.remoteJidAlt);
  const jids = raw.filter(Boolean);
  const ids = new Set(jids.map(userPart));

  for (const jid of jids) {
    if (!jid.endsWith('@lid')) continue;
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid);
      if (pn) ids.add(userPart(pn));
    } catch {
      /* tidak semua versi Baileys punya mapping ini */
    }
  }
  return [...ids];
}

const react = (ctx, text) =>
  ctx.sock.sendMessage(ctx.jid, { react: { text, key: ctx.m.key } }).catch(() => {});

const reply = (ctx, text) => ctx.sock.sendMessage(ctx.jid, { text }, { quoted: ctx.m });

function requireOwner(ctx) {
  if (!ctx.owner) throw new UserError('Perintah ini khusus owner bot.');
}

/* ------------------------------ Perintah ------------------------------ */

function menuText() {
  const p = config.prefix;
  return [
    '*BOT ALYZ*',
    `Mode   : ${isSelfMode() ? 'SELF (hanya owner)' : 'PUBLIC (semua orang)'}`,
    `Prefix : ${p}`,
    '',
    '*Umum*',
    `${p}menu`,
    '   Tampilkan daftar perintah',
    '',
    '*Grup*',
    `${p}kickall`,
    '   Keluarkan semua anggota. Khusus admin grup, bot harus admin',
    '',
    '*Media*',
    `${p}toptv`,
    '   Kirim video dengan caption .toptv, atau reply video. Hasil: video note',
    `${p}fotolive`,
    '   Kirim video dengan caption .fotolive, atau reply video. Hasil: foto live',
    '',
    '*Owner*',
    `${p}self atau ${p}selfmode on`,
    '   Hanya owner yang bisa memakai bot',
    `${p}public atau ${p}selfmode off`,
    '   Semua orang bisa memakai bot'
  ].join('\n');
}

async function kickall(ctx) {
  const { sock, jid, m } = ctx;
  if (!isGroup(jid)) throw new UserError('Perintah ini hanya bisa dipakai di grup.');

  const meta = await sock.groupMetadata(jid);
  const isAdm = (p) => p.admin === 'admin' || p.admin === 'superadmin';
  const idsOf = (p) => [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(userPart);
  const botIds = [sock.user?.id, sock.user?.lid].filter(Boolean).map(userPart);

  const me = meta.participants.find((p) => idsOf(p).some((i) => botIds.includes(i)));
  if (!me || !isAdm(me)) throw new UserError('Jadikan bot admin grup terlebih dahulu.');

  const senderP = meta.participants.find((p) => idsOf(p).some((i) => ctx.senderIds.includes(i)));
  if (!m.key.fromMe && !(senderP && isAdm(senderP))) {
    throw new UserError('Perintah ini khusus admin grup.');
  }

  const skip = new Set([...botIds, ...ctx.senderIds]);
  const targets = meta.participants
    .filter((p) => p.admin !== 'superadmin')
    .filter((p) => !idsOf(p).some((i) => skip.has(i)))
    .filter((p) => config.kickAdmins || !isAdm(p))
    .map((p) => p.id);

  if (!targets.length) throw new UserError('Tidak ada anggota yang bisa dikeluarkan.');

  let removed = 0;
  for (let i = 0; i < targets.length; i += config.kickBatchSize) {
    const batch = targets.slice(i, i + config.kickBatchSize);
    try {
      const res = await sock.groupParticipantsUpdate(jid, batch, 'remove');
      removed += res.filter((r) => String(r.status) === '200').length;
    } catch (err) {
      log.warn({ err }, 'batch kickall gagal');
    }
    if (i + config.kickBatchSize < targets.length) await sleep(config.kickBatchDelayMs);
  }

  if (removed === 0) throw new UserError('Gagal mengeluarkan anggota. Coba lagi nanti.');
  await reply(ctx, `kick all berhasil ${removed}`);
}

const downloadVideo = (sock, msg) =>
  downloadMediaMessage(msg, 'buffer', {}, {
    logger: baileysLogger,
    reuploadRequest: sock.updateMediaMessage
  });

// Video bisa dikirim langsung dengan caption perintah, atau di-reply dengan perintah
async function getVideoBuffer(ctx, cmd) {
  const { sock, m, content, jid } = ctx;
  const tooBig = (video) => Number(video?.fileLength || 0) > config.maxVideoMb * 1024 * 1024;

  if (content.videoMessage) {
    if (tooBig(content.videoMessage)) throw new UserError(`Video terlalu besar, maksimal ${config.maxVideoMb} MB.`);
    return downloadVideo(sock, m);
  }

  const info = content.extendedTextMessage?.contextInfo;
  const quoted = info?.quotedMessage && normalizeMessageContent(info.quotedMessage);
  if (quoted?.videoMessage) {
    if (tooBig(quoted.videoMessage)) throw new UserError(`Video terlalu besar, maksimal ${config.maxVideoMb} MB.`);
    return downloadVideo(sock, {
      key: { remoteJid: jid, id: info.stanzaId, participant: info.participant, fromMe: false },
      message: info.quotedMessage
    });
  }

  throw new UserError(`Kirim video dengan caption ${config.prefix}${cmd}, atau reply video dengan perintah ini.`);
}

async function toptv(ctx) {
  const input = await getVideoBuffer(ctx, 'toptv');
  const out = await toVideoNote(input);
  await ctx.sock.sendMessage(
    ctx.jid,
    { video: out.buffer, mimetype: 'video/mp4', ptv: true, seconds: out.seconds, jpegThumbnail: out.thumbnail },
    { quoted: ctx.m }
  );
}

async function fotolive(ctx) {
  const input = await getVideoBuffer(ctx, 'fotolive');
  const out = await toLivePhoto(input);
  await ctx.sock.sendMessage(
    ctx.jid,
    {
      video: out.buffer,
      mimetype: 'video/mp4',
      seconds: out.seconds,
      jpegThumbnail: out.thumbnail,
      // Titik frame diam pada klip, ini yang membuat WhatsApp menampilkannya sebagai foto live
      motionPhotoPresentationOffsetMs: out.offsetMs
    },
    { quoted: ctx.m }
  );
}

async function selfOn(ctx) {
  requireOwner(ctx);
  setSelfMode(true);
  await reply(ctx, 'Mode self aktif. Hanya owner yang dapat memakai bot.');
}

async function selfOff(ctx) {
  requireOwner(ctx);
  setSelfMode(false);
  await reply(ctx, 'Mode public aktif. Semua orang dapat memakai bot.');
}

async function selfmode(ctx) {
  requireOwner(ctx);
  const arg = (ctx.args[0] || '').toLowerCase();
  if (arg === 'on') return selfOn(ctx);
  if (arg === 'off') return selfOff(ctx);
  const p = config.prefix;
  await reply(
    ctx,
    `Mode saat ini: ${isSelfMode() ? 'self' : 'public'}\nGunakan ${p}selfmode on atau ${p}selfmode off`
  );
}

const commands = new Map([
  ['menu', (ctx) => reply(ctx, menuText())],
  ['kickall', kickall],
  ['toptv', toptv],
  ['fotolive', fotolive],
  ['self', selfOn],
  ['public', selfOff],
  ['selfmode', selfmode]
]);

/* ------------------------------ Dispatcher ------------------------------ */

// Semua perintah lewat sini: 🚀 saat proses, ✅ saat selesai
async function runWithReaction(ctx, name, fn) {
  await react(ctx, REACT_PROCESS);
  try {
    await fn(ctx);
    await react(ctx, REACT_DONE);
  } catch (err) {
    await react(ctx, REACT_FAIL);
    if (err instanceof UserError) {
      await reply(ctx, err.message).catch(() => {});
    } else {
      log.error({ err, cmd: name }, 'perintah gagal');
      await reply(ctx, 'Terjadi kesalahan saat memproses perintah.').catch(() => {});
    }
  }
}

export async function handleMessage(sock, m) {
  if (!m.message || !m.key?.remoteJid || m.key.remoteJid === 'status@broadcast') return;

  const ts = Number(m.messageTimestamp);
  if (ts && Date.now() / 1000 - ts > config.maxMessageAgeSec) return;

  const content = normalizeMessageContent(m.message);
  const text = getText(content).trim();
  if (!text.startsWith(config.prefix)) return;

  const [rawCmd, ...args] = text.slice(config.prefix.length).trim().split(/\s+/);
  const name = rawCmd.toLowerCase();
  const command = commands.get(name);
  if (!command) return;

  const senderIds = await collectSenderIds(sock, m);
  const ctx = {
    sock,
    m,
    content,
    args,
    jid: m.key.remoteJid,
    senderIds,
    owner: Boolean(m.key.fromMe) || senderIds.includes(config.ownerNumber)
  };

  // Self mode: selain owner diabaikan tanpa balasan
  if (isSelfMode() && !ctx.owner) return;

  await runWithReaction(ctx, name, command);
}
