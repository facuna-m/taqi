// H1: manda frases reales de test-audio/ a whisper-server y mide latencia.
// Uso: node h1-bench.js [carpeta] [desdeHHMMSS] [hastaHHMMSS] [maxFrases]
const fs = require('node:fs');
const path = require('node:path');
const { to16kMono, wav } = require('./audio');

const [dir = 'test-audio/discord-2026-11-27', desde = '003800', hasta = '004300', max = '40'] = process.argv.slice(2);
const URL = process.env.WHISPER_URL ?? 'http://127.0.0.1:8178/inference';

const frases = fs.readdirSync(dir)
  .map((f) => ({ f, m: f.match(/^(.+)-(\d{6})-(\d+)\.wav$/) }))
  .filter(({ m }) => m && m[2] >= desde && m[2] <= hasta)
  .sort((a, b) => a.m[2].localeCompare(b.m[2]) || a.m[3] - b.m[3])
  .slice(0, Number(max));

async function transcribir(wavBuf) {
  const form = new FormData();
  form.append('file', new Blob([wavBuf], { type: 'audio/wav' }), 'frase.wav');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  const res = await fetch(URL, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`whisper-server ${res.status}: ${await res.text()}`);
  return (await res.json()).text.trim();
}

(async () => {
  let audioS = 0, procS = 0;
  for (const { f, m } of frases) {
    const pcm = to16kMono(fs.readFileSync(path.join(dir, f)).subarray(44));
    const dur = pcm.length / 32000;
    const t = performance.now();
    const texto = await transcribir(wav(pcm));
    const lat = (performance.now() - t) / 1000;
    audioS += dur; procS += lat;
    console.log(`${m[2].replace(/(..)(..)(..)/, '$1:$2:$3')} ${m[1].padEnd(16)} ${dur.toFixed(1).padStart(5)}s  ${lat.toFixed(2)}s  ${texto}`);
  }
  console.log(`\n${frases.length} frases, ${audioS.toFixed(0)} s de audio, ${procS.toFixed(1)} s de proceso, ` +
    `latencia media ${(procS / frases.length).toFixed(2)} s, ${(audioS / procS).toFixed(0)}x tiempo real`);
})();
