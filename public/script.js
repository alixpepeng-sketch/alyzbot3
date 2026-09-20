(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('pair-form');
  const input = $('number');
  const submit = $('submit');
  const errorEl = $('error');
  const result = $('result');
  const codeEl = $('code');
  const copyBtn = $('copy');
  const dot = $('dot');
  const stateText = $('state-text');

  const LABEL = 'Dapatkan kode';
  const COOLDOWN_SECONDS = 10;

  let cooldownTimer = null;
  let currentCode = '';
  let busy = false;

  function showError(message) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function normalize(value) {
    let n = value.replace(/\D/g, '');
    if (n.startsWith('0')) n = '62' + n.slice(1);
    return n;
  }

  function startCooldown(seconds) {
    clearInterval(cooldownTimer);
    let left = Math.max(1, Math.ceil(seconds));
    submit.disabled = true;
    const tick = () => {
      if (left <= 0) {
        clearInterval(cooldownTimer);
        submit.disabled = false;
        submit.textContent = LABEL;
        return;
      }
      submit.textContent = `Coba lagi dalam ${left} detik`;
      left -= 1;
    };
    tick();
    cooldownTimer = setInterval(tick, 1000);
  }

  function renderCode(raw) {
    currentCode = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    codeEl.replaceChildren();
    [...currentCode].forEach((char, i) => {
      if (i === 4) codeEl.appendChild(document.createElement('span'));
      const cell = document.createElement('span');
      cell.className = 'cell';
      cell.style.setProperty('--i', String(i));
      cell.textContent = char;
      codeEl.appendChild(cell);
    });
    codeEl.setAttribute('aria-label', `Kode pairing ${currentCode.slice(0, 4)} ${currentCode.slice(4)}`);
    copyBtn.textContent = 'Salin kode';
    result.hidden = false;
  }

  async function requestCode(number) {
    const res = await fetch(`/pair?number=${encodeURIComponent(number)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    let data = {};
    try { data = await res.json(); } catch { /* respons bukan JSON */ }
    return { status: res.status, data };
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;

    const number = normalize(input.value);
    if (number.length < 8 || number.length > 15) {
      showError('Nomor tidak valid. Gunakan kode negara, contoh 628123456789.');
      input.focus();
      return;
    }

    showError('');
    busy = true;
    submit.disabled = true;
    submit.textContent = 'Meminta kode';
    result.hidden = true;

    try {
      const { status, data } = await requestCode(number);
      if (data.ok) {
        renderCode(data.code);
        startCooldown(COOLDOWN_SECONDS);
      } else {
        showError(data.error || 'Gagal meminta kode. Coba lagi.');
        startCooldown(status === 429 && data.retryAfter ? data.retryAfter : 3);
      }
    } catch {
      showError('Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.');
      startCooldown(3);
    } finally {
      busy = false;
    }
  });

  copyBtn.addEventListener('click', async () => {
    if (!currentCode) return;
    try {
      await navigator.clipboard.writeText(currentCode);
      copyBtn.textContent = 'Kode tersalin';
    } catch {
      copyBtn.textContent = 'Salin manual dari kode di atas';
    }
    setTimeout(() => { copyBtn.textContent = 'Salin kode'; }, 2000);
  });

  const STATES = {
    open: ['open', 'Bot tersambung ke WhatsApp'],
    connecting: ['connecting', 'Bot sedang menghubungkan'],
    default: ['idle', 'Bot belum tersambung']
  };

  async function refreshStatus() {
    if (document.hidden) return;
    try {
      const res = await fetch('/status', { cache: 'no-store' });
      const data = await res.json();
      const [key, text] = STATES[data.status] || STATES.default;
      dot.dataset.state = key;
      stateText.textContent = text;
      document.body.dataset.connected = data.connected ? 'true' : 'false';
    } catch {
      dot.dataset.state = 'idle';
      stateText.textContent = 'Server tidak dapat dijangkau';
    }
  }

  refreshStatus();
  setInterval(refreshStatus, 3000);
  document.addEventListener('visibilitychange', refreshStatus);
})();
