// Reproduce una reunión guardada (WAV de probe.js) por el mismo pipeline que el bot, sin Discord.
// Uso: node simular.js [carpeta] [desdeHHMMSS] [hastaHHMMSS]
const fs = require('node:fs');
const path = require('node:path');
const { crearSesion, whisperDisponible, marcaTiempo } = require('./pipeline');

const [dir = 'test-audio/discord-2026-11-27', desde = '000000', hasta = '235959'] = process.argv.slice(2);
const fecha = dir.match(/(\d{4})-(\d{2})-(\d{2})/)?.slice(1).map(Number) ?? [2026, 1, 1];

const frases = fs.readdirSync(dir)
  .map((f) => ({ f, m: f.match(/^(.+)-(\d{2})(\d{2})(\d{2})-(\d+)\.wav$/) }))
  .filter(({ m }) => m && `${m[2]}${m[3]}${m[4]}` >= desde && `${m[2]}${m[3]}${m[4]}` <= hasta)
  .map(({ f, m }) => ({ f, nombre: m[1], inicio: new Date(fecha[0], fecha[1] - 1, fecha[2], +m[2], +m[3], +m[4]) }))
  .sort((a, b) => a.inicio - b.inicio);

(async () => {
  if (!(await whisperDisponible())) { console.error('whisper-server no responde. Arráncalo con: npm run whisper'); process.exit(1); }
  const sesion = crearSesion({
    dir: path.join(__dirname, 'sesiones', `simulacion-${marcaTiempo()}`),
    alTranscribir: (f) => console.log(`[${new Date(f.inicio).toLocaleTimeString('es-CL')}] ${f.nombre}: ${f.texto ?? `⚠ ${f.error}`}`),
  });
  const t = performance.now();
  for (const { f, nombre, inicio } of frases) {
    sesion.procesarFrase({ userId: nombre, nombre, inicio, pcm48: fs.readFileSync(path.join(dir, f)).subarray(44) });
  }
  await sesion.terminar();
  const lineas = fs.existsSync(sesion.archivo) ? fs.readFileSync(sesion.archivo, 'utf8').trim().split('\n').length : 0;
  console.log(`\n${frases.length} frases -> ${lineas} líneas en ${path.relative(__dirname, sesion.archivo)} (${((performance.now() - t) / 1000).toFixed(1)} s)`);
  console.log('Descartadas:', JSON.stringify(sesion.descartes));
})();
