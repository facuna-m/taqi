const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generarActa, escribirActa } = require('./acta');

const base = new Date(2026, 10, 27, 10, 0, 0);
const f = (seg, nombre, texto, duracion = 1) => ({ inicio: new Date(base.getTime() + seg * 1000).toISOString(), userId: nombre, nombre, duracion, texto });
const etiquetas = (acta) => acta.split('\n').filter((l) => l.startsWith('`') && !l.includes('MIN ·'));

test('orden cronológico, agrupación por persona y huecos', () => {
  const acta = generarActa({
    canal: 'Reuniones',
    inicio: base.toISOString(),
    fin: new Date(base.getTime() + 10 * 60000).toISOString(),
    frases: [f(20, 'Bea', 'segunda'), f(0, 'Ana', 'hola'), f(2, 'Ana', 'qué tal'), f(30, 'Ana', null), f(40, 'Ana', 'vuelvo')],
  });
  assert.match(acta, /^# Acta — Reuniones/);
  assert.match(acta, /`10 MIN · 2 VOCES · ES`/);
  assert.match(acta, /\*\*Participantes:\*\* Ana, Bea/);
  assert.deepStrictEqual(etiquetas(acta), [
    '`00:00` **Ana** hola qué tal',
    '`00:20` **Bea** segunda',
    '`00:30` **Ana** ⚠ *(no se pudo transcribir)*',
    '`00:40` **Ana** vuelvo',
  ]);
});

test('marca los cortes por caídas en su lugar cronológico', () => {
  const corte = { desde: new Date(base.getTime() + 10_000).toISOString(), hasta: new Date(base.getTime() + 70_000).toISOString() };
  const acta = generarActa({ frases: [f(0, 'Ana', 'antes'), f(80, 'Ana', 'después')], cortes: [corte] });
  assert.deepStrictEqual(etiquetas(acta), [
    '`00:00` **Ana** antes',
    '`00:10` ⚠ *Transcripción interrumpida 1 min, de 10:00:10 a 10:01:10 (Taqi se cayó o se reinició).*',
    '`01:20` **Ana** después',
  ]);
});

test('pasada la hora la etiqueta incluye las horas', () => {
  const acta = generarActa({ frases: [f(3723, 'Ana', 'tarde')], inicio: base.toISOString() });
  assert.deepStrictEqual(etiquetas(acta), ['`1:02:03` **Ana** tarde']);
});

test('escapa Markdown en nombres y textos', () => {
  const acta = generarActa({ frases: [f(0, '[D7D] *Bo*', 'usa `npm` # ya')] });
  assert.ok(acta.includes('`00:00` **\\[D7D\\] \\*Bo\\*** usa \\`npm\\` \\# ya'));
});

test('escribirActa ignora una línea cortada por una caída', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taqi-'));
  fs.writeFileSync(path.join(dir, 'frases.jsonl'), JSON.stringify(f(0, 'Ana', 'hola')) + '\n{"inicio":"2026-');
  const r = escribirActa(dir);
  assert.deepStrictEqual([r.frases, r.voces], [1, 1]);
  assert.match(fs.readFileSync(r.ruta, 'utf8'), /\*\*Ana\*\* hola/);
  fs.rmSync(dir, { recursive: true });
});
