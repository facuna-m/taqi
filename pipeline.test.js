const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { crearSesion } = require('./pipeline');

// Servidor falso de Whisper: falla la primera petición y luego responde con el número de petición.
function servidorFalso() {
  let n = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      n++;
      if (n === 1) { res.writeHead(500); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: n === 3 ? '' : ` hola\n  frase ${n} ` }));
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

test('cola en orden, reintento, texto limpio, omite vacías y marca fallos', async () => {
  const server = await servidorFalso();
  const url = `http://127.0.0.1:${server.address().port}/inference`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taqi-'));
  const s = crearSesion({ dir, url, reintentos: 1, esperaMs: 10 });
  const pcm48 = Buffer.alloc(48000 * 4, 0x0b); // 1 s de tono constante, unos -9 dB: pasa el filtro de volumen
  const inicio = new Date('2026-11-27T03:00:00Z');

  const r = await Promise.all([1, 2, 3].map((i) => s.procesarFrase({ userId: `u${i}`, nombre: `N${i}`, inicio, pcm48 })));
  assert.deepStrictEqual(r.map((f) => f.texto), ['hola frase 2', '', 'hola frase 4']);

  server.close();
  const caida = await s.procesarFrase({ userId: 'u4', nombre: 'N4', inicio, pcm48 });
  assert.strictEqual(caida.texto, null);
  assert.ok(caida.error);

  const lineas = fs.readFileSync(s.archivo, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepStrictEqual(lineas.map((l) => l.userId), ['u1', 'u3', 'u4']); // la vacía (u2) no se guarda
  assert.strictEqual(lineas[0].duracion, 1);
  fs.rmSync(dir, { recursive: true });
});

test('al retomar, una línea cortada por una caída no se pega a la siguiente', async () => {
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => res.end(JSON.stringify({ text: 'nueva' }))); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taqi-'));
  fs.writeFileSync(path.join(dir, 'frases.jsonl'), '{"texto":"vieja"}\n{"inicio":"2026-');
  const s = crearSesion({ dir, url: `http://127.0.0.1:${server.address().port}/inference` });
  await s.procesarFrase({ userId: 'u', nombre: 'N', inicio: new Date(), pcm48: Buffer.alloc(48000 * 4, 0x0b) });
  server.close();
  const lineas = fs.readFileSync(s.archivo, 'utf8').split('\n');
  assert.strictEqual(lineas[1], '{"inicio":"2026-');
  assert.strictEqual(JSON.parse(lineas[2]).texto, 'nueva');
  fs.rmSync(dir, { recursive: true });
});

test('el audio silencioso se descarta sin llamar a Whisper', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taqi-'));
  const s = crearSesion({ dir, url: 'http://127.0.0.1:9/no-existe', reintentos: 0 });
  const f = await s.procesarFrase({ userId: 'u', nombre: 'N', inicio: new Date(), pcm48: Buffer.alloc(48000 * 4) });
  assert.strictEqual(f.descartada, 'volumen bajo');
  assert.strictEqual(s.descartes['volumen bajo'], 1);
  assert.ok(!fs.existsSync(s.archivo));
  fs.rmSync(dir, { recursive: true });
});
