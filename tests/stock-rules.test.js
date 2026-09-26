const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRules } = require('../src/services/stock-rules');

test('reglas aceptan seleccion multiple sin perder ceros y mantienen compatibilidad simple', () => {
  assert.deepEqual(normalizeRules({ rubro: ['CALZADO','CALZADO','INDUMENTARIA'], season: ['01','2'], level: '950', positiveStock: 'true' }), {
    brand: [], license: [], rubro: ['CALZADO','INDUMENTARIA'], year: [], season: ['01','2'], level: ['950'], type: '', search: '', positiveStock: true, actioned: ''
  });
});
test('rechaza reglas desconocidas, tipos y valores no admitidos', () => {
  for (const input of [{ level: ['999'] }, { rubro: { x: 1 } }, { positiveStock: 'yes' }, { year: [26] }, { search: ['x'] }]) {
    assert.throws(() => normalizeRules(input), error => error.status === 400);
  }
  assert.throws(() => normalizeRules({ sql: 'DELETE' }, true), /no admitida/);
});

test('lista y version se guardan juntas y conservan ceros iniciales', () => {
  assert.equal(normalizeRules({ priceList: '["093","017"]' }, true).priceList, '["093","017"]');
  for (const priceList of ['93', '["93"]', '[93,17]', '["93",""]', {}]) {
    assert.throws(() => normalizeRules({ priceList }), /Lista de precios invalida/);
  }
});

test('marca admite seleccion multiple y se guarda como regla de grilla', () => {
  assert.deepEqual(normalizeRules({ brand: ['ATOMIK', '47 STREET', 'ATOMIK'] }, true).brand, ['ATOMIK', '47 STREET']);
  assert.deepEqual(normalizeRules({ brand: 'Sin marca' }).brand, ['Sin marca']);
  assert.throws(() => normalizeRules({ brand: ['x'.repeat(151)] }), /brand invalido/);
});
