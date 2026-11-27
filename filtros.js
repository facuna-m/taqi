// Filtros contra frases falsas de Whisper. Umbrales calibrados con 186 frases reales de Discord (2026-11-27):
// las frases cortas bajo -35 dB eran casi todas "Gracias." inventado.
const MIN_DURACION_S = 0.3;
const CORTA_S = 2; // el filtro de volumen y la lista negra solo se aplican a frases cortas
const UMBRAL_DB = -35;
// shortcut: lista fija de alucinaciones típicas de Whisper en español; ampliarla con lo que aparezca en reuniones reales.
const ALUCINACIONES = new Set([
  'gracias', 'muchas gracias', 'gracias por ver', 'gracias por ver el video', 'suscribete',
  'subtitulos realizados por la comunidad de amaraorg', 'subtitulos por la comunidad de amaraorg', 'musica', 'aplausos',
]);

const normalizar = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();

// Volumen RMS en dBFS de PCM s16le mono.
function dbfs(pcm) {
  let suma = 0;
  for (let i = 0; i < pcm.length; i += 2) { const v = pcm.readInt16LE(i); suma += v * v; }
  return suma ? 10 * Math.log10(suma / (pcm.length / 2) / 32768 ** 2) : -Infinity;
}

// Antes de Whisper: devuelve el motivo para descartar el audio, o null si se transcribe.
function motivoDescarteAudio(duracion, db) {
  if (duracion < MIN_DURACION_S) return 'muy corta';
  if (duracion < CORTA_S && db < UMBRAL_DB) return 'volumen bajo';
  return null;
}

// Después de Whisper: quita repeticiones consecutivas de la misma oración y las alucinaciones típicas en frases cortas.
function limpiarTexto(texto, duracion) {
  const oraciones = texto.split(/(?<=[.!?])\s+/);
  const unicas = oraciones.filter((o, i) => i === 0 || normalizar(o) !== normalizar(oraciones[i - 1]));
  const limpio = unicas.join(' ').trim();
  if (!normalizar(limpio)) return '';
  if (duracion < CORTA_S && ALUCINACIONES.has(normalizar(limpio))) return '';
  return limpio;
}

module.exports = { dbfs, motivoDescarteAudio, limpiarTexto, UMBRAL_DB };
