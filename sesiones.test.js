const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { guardarMeta, leerMeta, sinCerrar, buscarRetomable } = require('./sesiones');

const ahora = new Date('2026-11-27T15:00:00Z');
const hace = (min) => new Date(ahora - min * 60000).toISOString();

function base(sesiones) {
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'taqi-'));
  for (const [nombre, meta] of Object.entries(sesiones)) {
    fs.mkdirSync(path.join(b, nombre));
    if (meta) guardarMeta(path.join(b, nombre), meta);
  }
  return b;
}

test('retoma la interrumpida más reciente del mismo canal, nunca una cerrada con /taqi parar', () => {
  const b = base({
    terminada: { canalId: 'A', inicio: hace(30), fin: hace(5), cerradaPor: 'comando' },
    caida: { canalId: 'A', inicio: hace(60), latido: hace(20) },
    ctrlc: { canalId: 'A', inicio: hace(50), fin: hace(10), cerradaPor: 'cierre' },
    otroCanal: { canalId: 'B', inicio: hace(10), latido: hace(1) },
    vieja: { canalId: 'A', inicio: hace(300), latido: hace(200) },
    'simulacion-x': { canalId: 'A', inicio: hace(1), latido: hace(1) },
    sinMeta: null,
  });
  const r = buscarRetomable('A', ahora, b);
  assert.strictEqual(path.basename(r.dir), 'ctrlc');
  assert.strictEqual(r.desde.toISOString(), hace(10));
  assert.strictEqual(buscarRetomable('C', ahora, b), null);
  fs.rmSync(b, { recursive: true });
});

test('sinCerrar lista solo las que murieron sin "fin"', () => {
  const b = base({ caida: { canalId: 'A', inicio: hace(60), latido: hace(20) }, ok: { canalId: 'A', inicio: hace(9), fin: hace(1), cerradaPor: 'comando' } });
  assert.deepStrictEqual(sinCerrar(b).map((s) => path.basename(s.dir)), ['caida']);
  fs.rmSync(b, { recursive: true });
});

test('guardarMeta reemplaza sin dejar el temporal', () => {
  const b = base({ s: { canalId: 'A', inicio: hace(1) } });
  guardarMeta(path.join(b, 's'), { canalId: 'A', inicio: hace(1), latido: hace(0) });
  assert.strictEqual(leerMeta(path.join(b, 's')).latido, hace(0));
  assert.deepStrictEqual(fs.readdirSync(path.join(b, 's')), ['sesion.json']);
  fs.rmSync(b, { recursive: true });
});
