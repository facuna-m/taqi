// Taqi: /transcribir entra a tu canal de voz y transcribe cada frase por persona; /terminar genera el acta.
// Uso: npm run whisper (en otra terminal) y luego npm start.
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const { joinVoiceChannel, EndBehaviorType, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const OpusScript = require('opusscript');
const { crearSesion, whisperDisponible } = require('./pipeline');
const { escribirActa } = require('./acta');

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error('Faltan DISCORD_TOKEN o GUILD_ID en .env (ver .env.example)');
  process.exit(1);
}

const SILENCIO_MS = 800; // fin de frase tras este silencio
const MAX_FRASE_BYTES = 25 * 192000; // 25 s de PCM 48 kHz estéreo: la ventana de Whisper es de 30 s
const APODO = '🔴 Taqi · transcribiendo';
const COMANDOS = [
  { name: 'transcribir', description: 'Taqi empieza a transcribir el canal de voz en el que estás' },
  { name: 'terminar', description: 'Taqi deja de transcribir y guarda el acta' },
];
const hora = (d = new Date()) => d.toLocaleTimeString('es-CL', { hour12: false });
const hhmm = (d) => hora(d).slice(0, 5);
const efimero = (content) => ({ content, flags: MessageFlags.Ephemeral });

let actual = null; // la transcripción en curso (una a la vez)
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

function escuchar(connection, canal, sesion) {
  const activos = new Set();
  connection.receiver.speaking.on('start', (userId) => {
    if (activos.has(userId) || userId === client.user.id) return;
    activos.add(userId);
    const nombre = canal.guild.members.cache.get(userId)?.displayName ?? userId;
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
  return activos;
}

async function iniciar(canal, canalTexto) {
  const inicio = new Date();
  const sesion = crearSesion({
    alTranscribir: (f) => {
      const lat = ((Date.now() - new Date(f.inicio).getTime() - f.duracion * 1000) / 1000).toFixed(1);
      console.log(`[${hora(new Date(f.inicio))}] ${f.nombre} (${f.duracion} s, +${lat} s): ${f.texto ?? `⚠ ${f.error}`}`);
    },
  });
  const meta = { canal: canal.name, inicio: inicio.toISOString() };
  fs.writeFileSync(path.join(sesion.dir, 'sesion.json'), JSON.stringify(meta, null, 2));

  const connection = joinVoiceChannel({
    channelId: canal.id,
    guildId: canal.guild.id,
    adapterCreator: canal.guild.voiceAdapterCreator,
    selfDeaf: false, // sordo = no recibe audio
    selfMute: true,
  });
  try { await entersState(connection, VoiceConnectionStatus.Ready, 20_000); }
  catch { connection.destroy(); throw new Error('no pude conectarme al canal de voz en 20 s (¿tengo permiso para Ver canal y Conectar?)'); }
  connection.on('error', (e) => console.error(`[${hora()}] ERROR conexión:`, e.message));

  const yo = canal.guild.members.me;
  const a = { canal, canalTexto, connection, sesion, meta, inicio, apodoAnterior: yo.nickname, aviso: null, activos: escuchar(connection, canal, sesion) };
  await yo.setNickname(APODO).catch((e) => console.error('No pude cambiar mi apodo:', e.message));

  // Patrón recomendado por @discordjs/voice: si se desconecta y no reconecta en 5 s, se da por perdida.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try { await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]); }
    catch {
      if (actual !== a) return;
      const r = await terminar();
      await canalTexto?.send(`⚠ Taqi se desconectó de <#${canal.id}>. Lo transcrito hasta ahora (${r.frases} frases) quedó guardado en el acta.`).catch(() => {});
    }
  });
  console.log(`[${hora()}] Transcribiendo "${canal.name}". Sesión: ${sesion.dir}`);
  return a;
}

async function terminar() {
  const a = actual;
  actual = null;
  a.connection.destroy();
  // Al cerrar la conexión, cada stream entrega su última frase: esperar a que lo hagan (máx. 2 s).
  for (let i = 0; i < 20 && a.activos.size; i++) await new Promise((r) => setTimeout(r, 100));
  await a.sesion.terminar();
  const fin = new Date();
  fs.writeFileSync(path.join(a.sesion.dir, 'sesion.json'), JSON.stringify({ ...a.meta, fin: fin.toISOString() }, null, 2));
  const r = escribirActa(a.sesion.dir);
  // Punto de integración futuro con una IA (resumen, etc.; fuera de alcance por ahora): recibiría r.ruta.
  console.log(`[${hora()}] Acta: ${r.ruta} (${r.frases} frases). Descartadas: ${JSON.stringify(a.sesion.descartes)}`);
  await a.canal.guild.members.me.setNickname(a.apodoAnterior).catch(() => {});
  await a.aviso?.edit(`⚪ Taqi dejó de transcribir <#${a.canal.id}> (${hhmm(a.inicio)}–${hhmm(fin)}).`).catch(() => {});
  return r;
}

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.set(COMANDOS);
  if (!(await whisperDisponible())) console.warn('⚠ whisper-server no responde todavía. Arráncalo con: npm run whisper');
  console.log(`[${hora()}] Conectado como ${client.user.tag}. Comandos /transcribir y /terminar listos en "${guild.name}".`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.guildId !== GUILD_ID) return;
  const canalVoz = interaction.member.voice?.channel;

  if (interaction.commandName === 'transcribir') {
    if (actual) return interaction.reply(efimero(`Ya estoy transcribiendo <#${actual.canal.id}>.`));
    if (!canalVoz) return interaction.reply(efimero('Entra primero a un canal de voz y vuelve a usar /transcribir.'));
    if (!(await whisperDisponible())) return interaction.reply(efimero('El motor de transcripción no está corriendo en el PC de Taqi (`npm run whisper`).'));
    await interaction.deferReply();
    try { actual = await iniciar(canalVoz, interaction.channel); }
    catch (e) { return interaction.editReply(`No pude empezar: ${e.message}`); }
    actual.aviso = await interaction.editReply(
      `🔴 **Taqi está transcribiendo** <#${canalVoz.id}>. Lo que se diga queda en un acta escrita; el audio no se guarda. Usa \`/terminar\` para detener.`);
  }

  if (interaction.commandName === 'terminar') {
    if (!actual) return interaction.reply(efimero('No hay ninguna transcripción en curso.'));
    if (canalVoz?.id !== actual.canal.id) return interaction.reply(efimero(`Tienes que estar en <#${actual.canal.id}> para terminarla.`));
    await interaction.deferReply();
    const r = await terminar();
    await interaction.editReply(`✅ Transcripción terminada: ${r.frases} frases. El acta quedó guardada en el PC donde corre Taqi.`);
  }
});

// Aviso a quien entra a mitad de la reunión.
client.on(Events.VoiceStateUpdate, (antes, despues) => {
  if (!actual || despues.id === client.user.id) return;
  if (antes.channelId !== actual.canal.id && despues.channelId === actual.canal.id) {
    actual.canalTexto?.send(`👋 <@${despues.id}>, Taqi está transcribiendo este canal de voz.`).catch(() => {});
  }
});

process.on('SIGINT', async () => {
  console.log(`\n[${hora()}] Cerrando Taqi...`);
  if (actual) await terminar();
  client.destroy();
  process.exit(0);
});
client.login(DISCORD_TOKEN);
