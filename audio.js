// Conversión de audio compartida: Discord entrega PCM 48 kHz estéreo s16le; Whisper quiere 16 kHz mono.

// shortcut: promedio de 3 muestras como filtro antialiasing; basta para voz, usar un resampler real si la calidad lo pide.
function to16kMono(pcm48stereo) {
  const frames = Math.floor(pcm48stereo.length / 4);
  const out = Buffer.alloc(Math.floor(frames / 3) * 2);
  for (let o = 0, i = 0; o < out.length; o += 2, i += 12) {
    let sum = 0;
    for (let k = 0; k < 12; k += 4) sum += pcm48stereo.readInt16LE(i + k) + pcm48stereo.readInt16LE(i + k + 2);
    out.writeInt16LE(Math.round(sum / 6), o);
  }
  return out;
}

function wav(pcm, rate = 16000, channels = 1) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

module.exports = { to16kMono, wav };
