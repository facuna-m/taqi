// Pipeline compartido: frase PCM 48 kHz estéreo -> whisper-server -> una línea en frases.jsonl.
// Lo usan bot.js (en vivo) y simular.js (con audio guardado).
const fs = require('node:fs');
const path = require('node:path');
const { to16kMono, wav } = require('./audio');
const { dbfs, motivoDescarteAudio, limpiarTexto } = require('./filtros');

const WHISPER_URL = process.env.WHISPER_URL ?? 'http://127.0.0.1:8178/inference';

async function transcribir(wavBuf, url = WHISPER_URL) {
  const form = new FormData();
  form.append('file', new Blob([wavBuf], { type: 'audio/wav' }), 'frase.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`whisper-server respondió ${res.status}`);
  return (await res.json()).text.replace(/\s+/g, ' ').trim(); // Whisper separa segmentos con saltos de línea
}

async function whisperDisponible(url = WHISPER_URL) {
  try { await fetch(new URL('/', url), { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}

const marcaTiempo = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_` +
  `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

function crearSesion({ dir = path.join(__dirname, 'sesiones', marcaTiempo()), url = WHISPER_URL, reintentos = 2, esperaMs = 1000, alTranscribir = () => {} } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, 'frases.jsonl');
  let cola = Promise.resolve(); // una frase a la vez: la GPU es una sola
  const descartes = { 'muy corta': 0, 'volumen bajo': 0, 'alucinación': 0 };

  function procesarFrase({ userId, nombre, inicio, pcm48 }) {
    const pcm = to16kMono(pcm48);
    const duracion = +(pcm.length / 32000).toFixed(2);
    const db = +dbfs(pcm).toFixed(1);
    const motivo = motivoDescarteAudio(duracion, db);
    if (motivo) { descartes[motivo]++; return Promise.resolve({ inicio: inicio.toISOString(), userId, nombre, duracion, db, texto: '', descartada: motivo }); }

    const tarea = cola.then(async () => {
      let texto = null, error;
      for (let i = 0; i <= reintentos; i++) {
        try { texto = await transcribir(wav(pcm), url); error = undefined; break; }
        catch (e) { error = e.message; if (i < reintentos) await new Promise((r) => setTimeout(r, esperaMs * (i + 1))); }
      }
      if (texto) { const limpio = limpiarTexto(texto, duracion); if (!limpio) descartes['alucinación']++; texto = limpio; }
      const frase = { inicio: inicio.toISOString(), userId, nombre, duracion, db, texto, ...(error && { error }) };
      // Si Whisper falla, igual se escribe la línea (texto null) para que el acta marque el hueco.
      if (texto !== '') { fs.appendFileSync(archivo, JSON.stringify(frase) + '\n'); alTranscribir(frase); }
      return frase;
    });
    cola = tarea.catch(() => {});
    return tarea;
  }

  return { dir, archivo, procesarFrase, descartes, terminar: () => cola };
}

module.exports = { crearSesion, transcribir, whisperDisponible, marcaTiempo, WHISPER_URL };
