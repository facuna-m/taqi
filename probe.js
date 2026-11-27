// H0: prueba mínima de recepción de audio por usuario con DAVE.
// Entra al canal de voz VOICE_CHANNEL_ID y guarda un WAV por usuario y por frase en probe-out/.
// Uso: npm run probe   (Ctrl+C para terminar e imprimir el resumen)
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, EndBehaviorType, VoiceConnectionStatus, version } = require('@discordjs/voice');
const OpusScript = require('opusscript');

const { DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID || !VOICE_CHANNEL_ID) {
  console.error('Faltan DISCORD_TOKEN, GUILD_ID o VOICE_CHANNEL_ID en .env (ver .env.example)');
  process.exit(1);
}

const OUT = path.join(__dirname, 'probe-out');
fs.mkdirSync(OUT, { recursive: true });
const debugLog = fs.createWriteStream(path.join(OUT, 'debug.log'), { flags: 'a' });
const log = (...a) => {
  const line = `[${new Date().toLocaleTimeString('es-CL')}] ${a.join(' ')}`;
  console.log(line);
  debugLog.write(line + '\n');
};

const stats = new Map(); // userId -> { name, frases, paquetes, errores }
const errores = { stream: 0, conexion: 0, decryptReunion: 0, decryptTransicion: 0, opus: 0 };
// Al conectar o cuando alguien entra/sale, DAVE renegocia la clave y algunos paquetes fallan; eso es esperable.
const GRACIA_MS = 10000; // corrida 2: la clave nueva se aplica ~6 s después de que alguien entra
let ultimoCambio = Date.now();
const activos = new Set();
const t0 = Date.now();

function wavHeader(dataBytes, rate = 48000, channels = 2) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataBytes, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(dataBytes, 40);
  return h;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once(Events.ClientReady, async () => {
  log(`Conectado como ${client.user.tag}. @discordjs/voice ${version}`);
  const channel = await client.channels.fetch(VOICE_CHANNEL_ID);
  log(`Entrando a "${channel.name}". Ya presentes: ${[...channel.members.values()].map((m) => m.displayName).join(', ') || 'nadie'}`);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: GUILD_ID,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false, // sordo = no recibe audio
    selfMute: true,
    debug: true,
  });

  connection.on('stateChange', (a, b) => log(`conexión: ${a.status} -> ${b.status}`));
  connection.on('error', (e) => { errores.conexion++; log('ERROR conexión:', e.message); });
  connection.on('debug', (m) => {
    // los volcados de estado incluyen claves de sesión de voz y campos como "consecutiveFailures": no se guardan
    if (m.includes('state change')) return;
    debugLog.write(m + '\n');
    if (/decryption ?failed|failed to decrypt/i.test(m)) {
      const enTransicion = Date.now() - ultimoCambio < GRACIA_MS;
      errores[enTransicion ? 'decryptTransicion' : 'decryptReunion']++;
      log(enTransicion ? 'debug (transición, esperable):' : 'ERROR descifrado a mitad de reunión:', m);
    }
  });
  connection.on(VoiceConnectionStatus.Ready, () => (ultimoCambio = Date.now()) && log('Listo, escuchando. DAVE activo:', Boolean(connection.state.networking?.state?.dave)));
  setTimeout(() => {
    if (connection.state.status !== VoiceConnectionStatus.Ready)
      log(`AVISO: sin conexión de voz tras 20 s (estado: ${connection.state.status}). Revisa que Taqi tenga "Ver canal" y "Conectar" en ese canal.`);
  }, 20_000);

  connection.receiver.speaking.on('start', (userId) => {
    if (activos.has(userId) || userId === client.user.id) return;
    activos.add(userId);
    const name = channel.guild.members.cache.get(userId)?.displayName ?? userId;
    const s = stats.get(userId) ?? { name, frases: 0, paquetes: 0, errores: 0, ultimaFrase: '-' };
    stats.set(userId, s);

    const decoder = new OpusScript(48000, 2);
    const pcm = [];
    const inicio = new Date();
    const stream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 800 } });

    stream.on('data', (packet) => {
      s.paquetes++;
      try { pcm.push(Buffer.from(decoder.decode(packet))); } catch { errores.opus++; }
    });
    stream.on('error', (e) => { s.errores++; errores.stream++; log(`ERROR stream de ${name}:`, e.message); });
    stream.on('close', () => {
      activos.delete(userId);
      decoder.delete();
      if (!pcm.length) return;
      s.frases++;
      s.ultimaFrase = inicio.toLocaleTimeString('es-CL');
      const data = Buffer.concat(pcm);
      const hora = inicio.toTimeString().slice(0, 8).replaceAll(':', '');
      const file = path.join(OUT, `${name.replace(/[^\w-]/g, '_')}-${hora}-${s.frases}.wav`);
      fs.writeFileSync(file, Buffer.concat([wavHeader(data.length), data]));
      log(`frase ${name}: ${(data.length / 192000).toFixed(1)} s -> ${path.basename(file)}`);
    });
  });
});

client.on(Events.VoiceStateUpdate, (antes, despues) => {
  const n = despues.member?.displayName ?? despues.id;
  if ((antes.channelId === VOICE_CHANNEL_ID) !== (despues.channelId === VOICE_CHANNEL_ID)) ultimoCambio = Date.now();
  if (antes.channelId !== VOICE_CHANNEL_ID && despues.channelId === VOICE_CHANNEL_ID) log(`entra: ${n}`);
  if (antes.channelId === VOICE_CHANNEL_ID && despues.channelId !== VOICE_CHANNEL_ID) log(`sale: ${n}`);
});

function resumen() {
  const min = ((Date.now() - t0) / 60000).toFixed(1);
  const usuarios = [...stats.values()];
  const totalErrores = errores.stream + errores.conexion + errores.decryptReunion;
  const r = { minutos: Number(min), usuarios: usuarios.map((u) => ({ ...u, segundosAudio: u.paquetes * 0.02 })), errores };
  fs.writeFileSync(path.join(OUT, 'resumen.json'), JSON.stringify(r, null, 2));
  console.log('\n===== RESUMEN H0 =====');
  console.log(`Duración: ${min} min`);
  for (const u of r.usuarios) console.log(`- ${u.name}: ${u.frases} frases, ${u.segundosAudio.toFixed(0)} s de audio, ${u.errores} errores, última frase ${u.ultimaFrase}`);
  console.log('Errores:', JSON.stringify(errores));
  const ok = usuarios.filter((u) => u.frases > 0).length >= 2 && totalErrores === 0;
  console.log(ok
    ? 'Automático OK (>=2 usuarios, 0 errores). Falta oír los WAV y comprobar que cada uno tiene solo a esa persona.'
    : 'NO pasa: se necesitan >=2 usuarios con audio y 0 errores fuera de transiciones (los de transición se toleran).');
}

process.on('SIGINT', () => { resumen(); client.destroy(); process.exit(0); });
client.login(DISCORD_TOKEN);
