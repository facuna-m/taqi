const test = require('node:test');
const assert = require('node:assert');
const { dbfs, motivoDescarteAudio, limpiarTexto } = require('./filtros');

test('dbfs: silencio, escala completa y media escala', () => {
  assert.strictEqual(dbfs(Buffer.alloc(320)), -Infinity);
  const lleno = Buffer.alloc(320); for (let i = 0; i < 320; i += 2) lleno.writeInt16LE(i % 4 ? -32768 : 32767, i);
  assert.ok(Math.abs(dbfs(lleno)) < 0.01);
  const medio = Buffer.alloc(320); for (let i = 0; i < 320; i += 2) medio.writeInt16LE(16384, i);
  assert.ok(Math.abs(dbfs(medio) + 6.02) < 0.01);
});

test('descarte de audio: muy corta, corta y baja, larga y baja se conserva', () => {
  assert.strictEqual(motivoDescarteAudio(0.2, -20), 'muy corta');
  assert.strictEqual(motivoDescarteAudio(0.5, -44), 'volumen bajo');
  assert.strictEqual(motivoDescarteAudio(0.5, -30), null);
  assert.strictEqual(motivoDescarteAudio(5, -44), null);
});

test('limpiarTexto: alucinaciones en frases cortas', () => {
  assert.strictEqual(limpiarTexto('Gracias.', 0.6), '');
  assert.strictEqual(limpiarTexto('¡Gracias!', 1.2), '');
  assert.strictEqual(limpiarTexto('Subtítulos realizados por la comunidad de Amara.org', 1.5), '');
  assert.strictEqual(limpiarTexto('Gracias, señor.', 1.3), 'Gracias, señor.');
  assert.strictEqual(limpiarTexto('Gracias.', 3), 'Gracias.'); // en frase larga puede ser real
  assert.strictEqual(limpiarTexto('...', 1), '');
});

test('limpiarTexto: repeticiones consecutivas', () => {
  assert.strictEqual(limpiarTexto('¿En qué tal? ¿En qué tal?', 1.5), '¿En qué tal?');
  assert.strictEqual(limpiarTexto('Hola. Hola. Chao.', 3), 'Hola. Chao.');
  assert.strictEqual(limpiarTexto('No, no, no, no.', 2), 'No, no, no, no.');
});
