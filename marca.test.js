const test = require('node:test');
const assert = require('node:assert');
const { EMOJI, MENSAJES, cargarEmojis } = require('./marca');

test('cargarEmojis sube solo los que faltan, con la versión animada si existe', async () => {
  const creados = [];
  const emoji = (name, id) => ({ name, toString: () => `<:${name}:${id}>` });
  const app = { emojis: {
    fetch: async () => [emoji('taqi_listo', 1)],
    create: async ({ name, attachment }) => { creados.push([name, attachment.split(/[\\/]/).pop()]); return emoji(name, 2); },
  } };
  await cargarEmojis(app);
  assert.deepStrictEqual(creados, [['taqi_grabando', 'taqi_grabando.gif'], ['taqi_procesando', 'taqi_procesando.png'], ['taqi_aviso', 'taqi_aviso.png']]);
  assert.strictEqual(EMOJI.listo, '<:taqi_listo:1>');
  assert.match(MENSAJES.sinCanal().toJSON().title, /^<:taqi_aviso:2> /);
});
