// Taqi: /taqi unirse entra a tu canal de voz y transcribe cada frase por persona; /taqi parar genera el acta.
// Uso: npm run whisper (en otra terminal) y luego npm start.
const { Client, GatewayIntentBits, Events, MessageFlags, ActivityType } = require('discord.js');
const { joinVoiceChannel, EndBehaviorType, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const OpusScript = require('opusscript');
const { crearSesion, whisperDisponible } = require('./pipeline');
const { escribirActa } = require('./acta');
const { guardarMeta, sinCerrar, buscarRetomable, RETOMAR_MS } = require('./sesiones');
const { APODO, MENSAJES: M, COMANDOS } = require('./marca');

const { DISCORD_TOKEN, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error('Faltan DISCORD_TOKEN o GUILD_ID en .env (ver .env.example)');
  process.exit(1);
}

const LATIDO_MS = 15_000; // marca de vida en sesion.json: tras una caída, el hueco empieza aquí
const SILENCIO_MS = 800; // fin de frase tras este silencio
const MAX_FRASE_BYTES = 25 * 192000; // 25 s de PCM 48 kHz estéreo: la ventana de Whisper es de 30 s
const hora = (d = new Date()) => d.toLocaleTimeString('es-CL', { hour12: false });
const efimero = (embed) => ({ embeds: [embed], flags: MessageFlags.Ephemeral });

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
  const connection = joinVoiceChannel({
    channelId: canal.id,
    guildId: canal.guild.id,
    adapterCreator: canal.guild.voiceAdapterCreator,
    selfDeaf: false, // sordo = no recibe audio
    selfMute: true,
  });
  try { await entersState(connection, VoiceConnectionStatus.Ready, 20_000); }
  catch { connection.destroy(); throw Object.assign(new Error('sin conexión de voz en 20 s'), { sinPermiso: true }); }
  connection.on('error', (e) => console.error(`[${hora()}] ERROR conexión:`, e.message));

  // Si este canal tiene una sesión interrumpida hace menos de 2 h (caída o Ctrl+C), se continúa y se anota el hueco.
  const ahora = new Date();
  const previa = buscarRetomable(canal.id, ahora);
  const corte = previa && { desde: previa.desde.toISOString(), hasta: ahora.toISOString() };
  const sesion = crearSesion({
    ...(previa && { dir: previa.dir }),
    alTranscribir: (f) => {
      const lat = ((Date.now() - new Date(f.inicio).getTime() - f.duracion * 1000) / 1000).toFixed(1);
      console.log(`[${hora(new Date(f.inicio))}] ${f.nombre} (${f.duracion} s, +${lat} s): ${f.texto ?? `⚠ ${f.error}`}`);
    },
  });
  const meta = previa
    ? { ...previa.meta, canal: canal.name, cortes: [...(previa.meta.cortes ?? []), corte], fin: undefined, cerradaPor: undefined }
    : { canal: canal.name, canalId: canal.id, inicio: ahora.toISOString(), cortes: [] };
  meta.latido = ahora.toISOString();
  guardarMeta(sesion.dir, meta);

  const yo = canal.guild.members.me;
  const a = {
    canal, canalTexto, connection, sesion, meta, corte, inicio: new Date(meta.inicio), apodoAnterior: yo.nickname, aviso: null,
    activos: escuchar(connection, canal, sesion),
    latido: setInterval(() => { meta.latido = new Date().toISOString(); guardarMeta(sesion.dir, meta); }, LATIDO_MS),
  };
  await yo.setNickname(APODO).catch((e) => console.error('No pude cambiar mi apodo:', e.message));
  client.user.setActivity(`#${canal.name}`, { type: ActivityType.Listening }); // "Escuchando #canal" en el perfil

  // Patrón recomendado por @discordjs/voice: si se desconecta y no reconecta en 5 s, se da por perdida.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try { await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5000), entersState(connection, VoiceConnectionStatus.Connecting, 5000)]); }
    catch {
      if (actual !== a) return;
      const r = await terminar('desconexion');
      await canalTexto?.send({ embeds: [M.desconectado({ canalId: canal.id, frases: r.frases })] }).catch(() => {});
    }
  });
  console.log(`[${hora()}] ${previa ? 'Retomando' : 'Transcribiendo'} "${canal.name}". Sesión: ${sesion.dir}`);
  return a;
}

// motivo: 'comando' (/taqi parar) | 'desconexion' | 'cierre' (Ctrl+C o cerrar la ventana) | 'error'
async function terminar(motivo) {
  const a = actual;
  if (!a) return null;
  actual = null;
  clearInterval(a.latido);
  a.connection.destroy();
  // Al cerrar la conexión, cada stream entrega su última frase: esperar a que lo hagan (máx. 2 s).
  for (let i = 0; i < 20 && a.activos.size; i++) await new Promise((r) => setTimeout(r, 100));
  await a.sesion.terminar();
  const fin = new Date();
  Object.assign(a.meta, { latido: fin.toISOString(), fin: fin.toISOString(), cerradaPor: motivo });
  guardarMeta(a.sesion.dir, a.meta);
  const r = escribirActa(a.sesion.dir);
  // Punto de integración futuro con una IA (resumen, etc.; fuera de alcance por ahora): recibiría r.ruta.
  console.log(`[${hora()}] Acta: ${r.ruta} (${r.frases} frases). Descartadas: ${JSON.stringify(a.sesion.descartes)}`);
  await a.canal.guild.members.me.setNickname(a.apodoAnterior).catch(() => {});
  client.user.setPresence({ activities: [] });
  await a.aviso?.edit({ embeds: [M.terminado({ canalId: a.canal.id, inicio: a.inicio, fin })] }).catch(() => {});
  return { ...r, minutos: Math.max(1, Math.round((fin - a.inicio) / 60000)) };
}

// Al arrancar: las sesiones que murieron sin cerrarse reciben su acta. Las de más de 2 h se dan por cerradas.
function recuperarSesiones() {
  for (const { dir, meta } of sinCerrar()) {
    const ultimo = meta.latido ?? meta.inicio;
    if (Date.now() - new Date(ultimo) >= RETOMAR_MS) guardarMeta(dir, { ...meta, fin: ultimo, cerradaPor: 'caida' });
    const r = escribirActa(dir);
    console.log(`[${hora()}] Sesión interrumpida recuperada: ${r.ruta} (${r.frases} frases)`);
  }
}

client.once(Events.ClientReady, async () => {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.set(COMANDOS);
  recuperarSesiones();
  if (!(await whisperDisponible())) console.warn('⚠ whisper-server no responde todavía. Arráncalo con: npm run whisper');
  console.log(`[${hora()}] Conectado como ${client.user.tag}. Comando /taqi listo en "${guild.name}".`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.guildId !== GUILD_ID || interaction.commandName !== 'taqi') return;
  const canalVoz = interaction.member.voice?.channel;
  const sub = interaction.options.getSubcommand();

  if (sub === 'unirse') {
    if (actual) return interaction.reply(efimero(M.yaEscuchando(actual.canal.id)));
    if (!canalVoz) return interaction.reply(efimero(M.sinCanal()));
    if (!(await whisperDisponible())) return interaction.reply(efimero(M.sinMotor()));
    await interaction.deferReply();
    try { actual = await iniciar(canalVoz, interaction.channel); }
    catch (e) { return interaction.editReply({ embeds: [e.sinPermiso ? M.sinPermiso() : M.noPude(e.message)] }); }
    actual.aviso = await interaction.editReply({ embeds: [M.escuchando({ canalId: canalVoz.id, inicio: actual.inicio, corte: actual.corte })] });
  }

  if (sub === 'parar') {
    if (!actual) return interaction.reply(efimero(M.nadaQueParar()));
    if (canalVoz?.id !== actual.canal.id) return interaction.reply(efimero(M.otroCanal(actual.canal.id)));
    await interaction.deferReply();
    const r = await terminar('comando');
    await interaction.editReply({ embeds: [r ? M.listo(r) : M.yaTermino()] });
  }
});

// Aviso a quien entra a mitad de la reunión.
client.on(Events.VoiceStateUpdate, (antes, despues) => {
  if (!actual || despues.id === client.user.id) return;
  if (antes.channelId !== actual.canal.id && despues.channelId === actual.canal.id) {
    actual.canalTexto?.send(M.bienvenida(despues.id)).catch(() => {});
  }
});

// Ctrl+C, cerrar la ventana de la terminal o un error inesperado: se guarda el acta antes de salir.
async function cerrar(motivo, codigo) {
  console.log(`
[${hora()}] Cerrando Taqi (${motivo})...`);
  try { await terminar(motivo); } catch (e) { console.error('No se pudo cerrar la sesión:', e); }
  client.destroy();
  process.exit(codigo);
}
process.on('SIGINT', () => cerrar('cierre', 0));
process.on('SIGHUP', () => cerrar('cierre', 0)); // Windows lo envía al cerrar la ventana de la consola
process.on('uncaughtException', (e) => { console.error('Error inesperado:', e); cerrar('error', 1); });
process.on('unhandledRejection', (e) => { console.error('Error inesperado:', e); cerrar('error', 1); });
client.login(DISCORD_TOKEN);
