const test = require('node:test');
const assert = require('node:assert');
const { to16kMono, wav } = require('./audio');

test('48k estéreo -> 16k mono: largo y promedio de canales', () => {
  const frames = 4800; // 0,1 s
  const pcm = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) { pcm.writeInt16LE(1000, i * 4); pcm.writeInt16LE(3000, i * 4 + 2); }
  const out = to16kMono(pcm);
  assert.strictEqual(out.length, 1600 * 2);
  assert.strictEqual(out.readInt16LE(0), 2000);
  assert.strictEqual(out.readInt16LE(out.length - 2), 2000);
});

test('cabecera WAV', () => {
  const w = wav(Buffer.alloc(32000));
  assert.strictEqual(w.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(w.readUInt32LE(24), 16000);
  assert.strictEqual(w.readUInt32LE(40), 32000);
});
