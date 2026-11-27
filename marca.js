// Identidad de Taqi en Discord (manual de marca): colores de estado y textos de cada mensaje, con la voz de la marca.
// Voz: breve, atenta, sin protagonismo, de tú, frases cortas.
const { EmbedBuilder } = require('discord.js');

// El violeta va en lo neutro; la Lima no se usa porque Discord tiene tema claro y el manual la prohíbe sobre fondos claros.
const COLOR = { violeta: 0x5B3FD9, grabando: 0xF2545B, inactivo: 0xA391F0, aviso: 0xFFB547 };
const APODO = '🔴 Taqi · transcribiendo';
const t = (d, estilo = 't') => `<t:${Math.floor(new Date(d).getTime() / 1000)}:${estilo}>`; // Discord la muestra en la hora local de cada uno
const voces = (n) => `${n} ${n === 1 ? 'voz' : 'voces'}`;

function tarjeta(color, titulo, texto, pie) {
  const e = new EmbedBuilder().setColor(COLOR[color]).setTitle(titulo);
  if (texto) e.setDescription(texto);
  if (pie) e.setFooter({ text: pie });
  return e;
}

const MENSAJES = {
  escuchando: ({ canalId, inicio, corte }) => tarjeta('grabando', 'Estoy transcribiendo',
    [`<#${canalId}> desde las ${t(inicio)}. Lo que se diga queda por escrito; el audio no se guarda.`,
      corte && `Retomo el acta donde quedó: hubo un corte de ${t(corte.desde)} a ${t(corte.hasta)}.`,
      'Usa `/taqi parar` cuando terminen.'].filter(Boolean).join('\n\n'), 'EN VIVO'),
  // Reemplaza al aviso de arriba al terminar, para que no siga diciendo que graba.
  terminado: ({ canalId, inicio, fin }) => tarjeta('inactivo', 'Ya no estoy transcribiendo', `<#${canalId}> · ${t(inicio)}–${t(fin)}`),
  listo: ({ frases, voces: n, minutos }) => tarjeta('violeta', 'Listo. Tu reunión ya está por escrito.',
    frases ? 'El acta quedó guardada en el PC donde corre Taqi.' : 'No alcancé a escuchar nada, así que el acta quedó vacía.',
    `${minutos} MIN · ${voces(n).toUpperCase()} · ${frases} FRASES · ES`),
  desconectado: ({ canalId, frases }) => tarjeta('aviso', 'Me desconecté del canal',
    `Perdí la conexión con <#${canalId}>. Guardé lo que alcancé a escuchar (${frases} frases).\n\nUsa \`/taqi unirse\` y sigo en la misma acta.`),
  bienvenida: (userId) => `👋 <@${userId}>, estoy transcribiendo este canal. El audio no se guarda.`,
  // Errores (solo los ve quien usó el comando)
  yaEscuchando: (canalId) => tarjeta('aviso', 'Ya estoy en otra reunión', `Estoy transcribiendo <#${canalId}>. Solo puedo estar en un canal a la vez.`),
  sinCanal: () => tarjeta('aviso', 'No sé a qué canal ir', 'Entra a un canal de voz y vuelve a usar `/taqi unirse`.'),
  sinMotor: () => tarjeta('aviso', 'Mi motor de transcripción está apagado', 'En el PC donde corro, abre una terminal y ejecuta `npm run whisper`.'),
  sinPermiso: () => tarjeta('aviso', 'No pude entrar al canal', '¿Me das permiso de voz? Necesito **Ver canal** y **Conectar**.'),
  noPude: (motivo) => tarjeta('aviso', 'No pude empezar', motivo),
  nadaQueParar: () => tarjeta('aviso', 'No estoy transcribiendo', 'No hay ninguna reunión en curso.'),
  otroCanal: (canalId) => tarjeta('aviso', 'Estás en otro canal', `Entra a <#${canalId}> para detener la transcripción.`),
  yaTermino: () => tarjeta('inactivo', 'Ya había terminado', 'Esa transcripción ya se cerró.'),
};

const COMANDOS = [{
  name: 'taqi',
  description: 'Transcribe tus reuniones de voz',
  options: [
    { type: 1, name: 'unirse', description: 'Entro a tu canal de voz y empiezo a transcribir' },
    { type: 1, name: 'parar', description: 'Dejo de transcribir y guardo el acta' },
  ],
}];

module.exports = { COLOR, APODO, MENSAJES, COMANDOS };
