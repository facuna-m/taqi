// Genera acta.md a partir de frases.jsonl (y sesion.json si existe). Se puede regenerar siempre desde el JSONL.
const fs = require('node:fs');
const path = require('node:path');

const AGRUPAR_MS = 5000; // frases seguidas de la misma persona con menos de 5 s de pausa van en un mismo párrafo
const hora = (d) => d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fecha = (d) => d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
const escapar = (t) => t.replace(/([\\*_`#[\]<>|])/g, '\\$1');
// Etiqueta de hablante del manual de marca: tiempo desde el inicio (00:12, o 1:02:03 pasada la hora).
function relativo(t, t0) {
  const s = Math.max(0, Math.round((t - t0) / 1000));
  const mmss = `${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mmss}` : mmss;
}
// Símbolo de Taqi (versión positiva, para fondo claro) incrustado: el acta sigue siendo un solo archivo.
// Lo muestran los visores con HTML (VS Code, Obsidian, Typora); GitHub y los visores de texto plano no.
const SIMBOLO = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 18 80 64">'
  + '<g fill="#5B3FD9"><rect x="16" y="36" width="7" height="28" rx="3.5"/><rect x="27" y="24" width="7" height="52" rx="3.5"/><rect x="38" y="32" width="7" height="36" rx="3.5"/></g>'
  + '<g stroke="#17151F" stroke-width="7" stroke-linecap="round"><line x1="56" y1="36" x2="84" y2="36"/><line x1="56" y1="50" x2="78" y2="50"/><line x1="56" y1="64" x2="70" y2="64"/></g></svg>').toString('base64');
const duracion =(ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : `${Math.round(s / 60)} min`; };

function generarActa({ frases, canal = 'canal de voz', inicio, fin, cortes = [] }) {
  const orden = [...frases].sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  const t0 = inicio ? new Date(inicio) : new Date(orden[0]?.inicio ?? Date.now());
  const ultima = orden.at(-1);
  const t1 = fin ? new Date(fin) : ultima ? new Date(new Date(ultima.inicio).getTime() + ultima.duracion * 1000) : t0;
  const participantes = [...new Set(orden.map((f) => f.nombre))];
  const minutos = Math.max(1, Math.round((t1 - t0) / 60000));

  const parrafos = [];
  for (const f of orden) {
    const t = new Date(f.inicio);
    const texto = f.texto == null ? '⚠ *(no se pudo transcribir)*' : escapar(f.texto);
    const prev = parrafos.at(-1);
    if (prev && prev.nombre === f.nombre && f.texto != null && prev.ok && t - prev.fin < AGRUPAR_MS) {
      prev.textos.push(texto);
    } else {
      parrafos.push({ nombre: f.nombre, t, textos: [texto], ok: f.texto != null });
    }
    parrafos.at(-1).fin = new Date(t.getTime() + f.duracion * 1000);
  }
  for (const c of cortes) {
    const t = new Date(c.desde);
    const i = parrafos.findIndex((p) => p.t >= t);
    const marca = { t, linea: `\`${relativo(t, t0)}\` ⚠ *Transcripción interrumpida ${duracion(new Date(c.hasta) - t)}, de ${hora(t)} a ${hora(new Date(c.hasta))} (Taqi se cayó o se reinició).*\n` };
    parrafos.splice(i === -1 ? parrafos.length : i, 0, marca);
  }

  return [
    `# Acta — ${escapar(canal)}`,
    '',
    `**Fecha:** ${fecha(t0)} · **Hora:** ${hora(t0).slice(0, 5)}–${hora(t1).slice(0, 5)}  `,
    `\`${minutos} MIN · ${participantes.length} ${participantes.length === 1 ? 'VOZ' : 'VOCES'} · ES\`  `,
    `**Participantes:** ${participantes.map(escapar).join(', ') || '—'}`,
    '',
    '> Transcripción automática local (Whisper). Puede contener errores.',
    '',
    '## Transcripción',
    '',
    ...(parrafos.length ? parrafos.map((p) => p.linea ?? `\`${relativo(p.t, t0)}\` **${escapar(p.nombre)}** ${p.textos.join(' ')}\n`) : ['*(sin frases)*', '']),
    '---',
    `<img src="${SIMBOLO}" alt="Taqi" width="28"> *Taqi · Tus reuniones, por escrito.*`,
    '',
  ].join('\n');
}

function escribirActa(dir) {
  const jsonl = path.join(dir, 'frases.jsonl');
  const frases = fs.existsSync(jsonl)
    ? fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) // una línea a medio escribir tras una caída se ignora
    : [];
  const metaPath = path.join(dir, 'sesion.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  const destino = path.join(dir, 'acta.md');
  fs.writeFileSync(destino, generarActa({ frases, ...meta }));
  return { ruta: destino, frases: frases.length, voces: new Set(frases.map((f) => f.nombre)).size };
}

module.exports = { generarActa, escribirActa };
