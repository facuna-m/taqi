// Estado de cada sesión en sesiones/<dir>/sesion.json: { canal, canalId, inicio, latido, fin?, cerradaPor?, cortes: [{desde, hasta}] }.
// cerradaPor: 'comando' (/taqi parar) | 'desconexion' | 'cierre' (Ctrl+C) | 'error' | 'caida' (murió y nadie la retomó en 2 h).
// Sin "fin" = el proceso murió sin cerrarla.
const fs = require('node:fs');
const path = require('node:path');

const BASE = path.join(__dirname, 'sesiones');
const RETOMAR_MS = 2 * 60 * 60 * 1000; // una sesión interrumpida hace menos de 2 h se continúa

function leerMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'sesion.json'), 'utf8')); } catch { return null; }
}

function guardarMeta(dir, meta) {
  const tmp = path.join(dir, 'sesion.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
  fs.renameSync(tmp, path.join(dir, 'sesion.json')); // reemplazo atómico: una caída no deja el archivo a medias
}

function listar(base = BASE) {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('simulacion-'))
    .map((d) => ({ dir: path.join(base, d.name), meta: leerMeta(path.join(base, d.name)) }))
    .filter((s) => s.meta);
}

// Sesiones que el proceso no alcanzó a cerrar (sin "fin").
const sinCerrar = (base = BASE) => listar(base).filter((s) => !s.meta.fin);

// La sesión más reciente del mismo canal que se interrumpió (no se cerró con /taqi parar) hace menos de 2 h.
function buscarRetomable(canalId, ahora = new Date(), base = BASE) {
  return listar(base)
    .filter((s) => s.meta.canalId === canalId && s.meta.cerradaPor !== 'comando')
    .map((s) => ({ ...s, desde: new Date(s.meta.fin ?? s.meta.latido ?? s.meta.inicio) }))
    .filter((s) => ahora - s.desde < RETOMAR_MS)
    .sort((a, b) => b.desde - a.desde)[0] ?? null;
}

module.exports = { BASE, RETOMAR_MS, leerMeta, guardarMeta, sinCerrar, buscarRetomable };
