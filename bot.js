// H2: Taqi en vivo. Entra a VOICE_CHANNEL_ID, transcribe cada frase por usuario y la guarda en sesiones/<fecha>/frases.jsonl.
// Uso: npm run whisper (en otra terminal) y luego npm start. Ctrl+C para terminar.
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { joinVoiceChannel, EndBehaviorType, VoiceConnectionStatus } = require('@discordjs/voice');
const OpusScript = require('opusscript');
const { crearSesion, whisperDisponible } = require('./pipeline');

const { DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID || !VOICE_CHANNEL_ID) {
  console.error('Faltan DISCORD_TOKEN, GUILD_ID o VOICE_CHANNEL_ID en .env (ver .env.example)');
  process.exit(1);
}

const SILENCIO_MS = 800; // fin de frase tras este silencio
const MAX_FRASE_BYTES = 25 * 192000; // 25 s de PCM 48 kHz estéreo: la ventana de Whisper es de 30 s
const hora = (d = new Date()) => d.toLocaleTimeString('es-CL');

let sesion;
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

client.once(Events.ClientReady, async () => {
  if (!(await whisperDisponible())) { console.error('whisper-server no responde. Arráncalo con: npm run whisper'); process.exit(1); }
  const channel = await client.channels.fetch(VOICE_CHANNEL_ID);
  sesion = crearSesion({
    alTranscribir: (f) => {
      const finHabla = new Date(f.inicio).getTime() + f.duracion * 1000;
      const lat = ((Date.now() - finHabla) / 1000).toFixed(1);
      console.log(`[${hora(new Date(f.inicio))}] ${f.nombre} (${f.duracion} s, +${lat} s): ${f.texto ?? `⚠ ${f.error}`}`);
    },
  });
  console.log(`[${hora()}] Conectado como ${client.user.tag}. Sesión: ${sesion.dir}`);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: GUILD_ID,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false, // sordo = no recibe audio
    selfMute: true,
  });
  connection.on('error', (e) => console.error(`[${hora()}] ERROR conexión:`, e.message));
  connection.on(VoiceConnectionStatus.Ready, () => console.log(`[${hora()}] Escuchando "${channel.name}"`));

  const activos = new Set();
  connection.receiver.speaking.on('start', (userId) => {
    if (activos.has(userId) || userId === client.user.id) return;
    activos.add(userId);
    const nombre = channel.guild.members.cache.get(userId)?.displayName ?? userId;
    const decoder = new OpusScript(48000, 2);
    let pcm = [], bytes = 0, inicio = new Date();
    const entregar = () => {
      if (bytes) sesion.procesarFrase({ userId, nombre, inicio, pcm48: Buffer.concat(pcm) });
      pcm = []; bytes = 0; inicio = new Date();
    };

    const stream = connection.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCIO_MS } });
    stream.on('data', (packet) => {
      try { const b = Buffer.from(decoder.decode(packet)); pcm.push(b); bytes += b.length; } catch { /* paquete corrupto: se omite */ }
      if (bytes >= MAX_FRASE_BYTES) entregar();
    });
    stream.on('error', (e) => console.error(`[${hora()}] ERROR stream de ${nombre}:`, e.message));
    stream.on('close', () => { activos.delete(userId); decoder.delete(); entregar(); });
  });
});

process.on('SIGINT', async () => {
  console.log(`\n[${hora()}] Terminando: esperando las frases pendientes...`);
  if (sesion) { await sesion.terminar(); console.log(`Guardado en ${sesion.archivo}`); }
  client.destroy();
  process.exit(0);
});
client.login(DISCORD_TOKEN);
