const test = require('node:test');
const assert = require('node:assert/strict');
const { groupSingles } = require('../src/services/single-stock');
test('agrupa talles con stock por identidad y color sin mezclar empresas o temporadas', () => {
  const base = { ID_EMPRESA: 1, NIVEL: 900, MODC: '001', COLORC: '02', DMODC: 'Soft', DCOLORC: 'Verde', COD_ANIO: '26', COD_TEM: '1', PRICE_WHOLESALE: 10, PRICE_BASE: 12, PRICE_PUBLIC: 20 };
  const rows = [['XL', 2], ['L', 6], ['S', 5], ['M', 4], ['XS', 0], ['XXS', -1]].map(([TALLC, STOCK]) => ({ ...base, TALLC, STOCK, COD_ALFA: `code-${TALLC}` }));
  const [group] = groupSingles(rows);
  assert.deepEqual(group.SIZES.map(s => [s.label, s.stock]), [['S', 5], ['M', 4], ['L', 6], ['XL', 2]]);
  assert.equal(group.STOCK, 17);
  assert.equal(group.PRICE_WHOLESALE, 10);
  const split = groupSingles([...rows, { ...rows[0], COLORC: '03' }, { ...rows[0], ID_EMPRESA: 2 }, { ...rows[0], COD_TEM: '2' }]);
  assert.equal(split.length, 4);
  const varied = groupSingles([...rows, { ...rows[0], STOCK: 1, DEPOSITO: 8, PRICE_WHOLESALE: 11 }])[0];
  assert.equal(varied.PRICE_WHOLESALE, null);
  assert.equal(varied.SIZES.find(s => s.label === 'XL').stock, 3);
  assert.equal(varied.SIZES.find(s => s.label === 'XL').items.length, 2);
  assert.deepEqual(groupSingles(['40', '9', '35'].map(TALLC => ({ ...base, TALLC, STOCK: 1 })))[0].SIZES.map(s => s.label), ['9', '35', '40']);
});

test('stock general conserva modulos y accionados y agrupa los sueltos antes de paginar', () => {
  const { groupStockView } = require('../src/services/single-stock');
  const base = { ID_EMPRESA: 1, MODC: '001', COLORC: '02', DMODC: 'Soft', DCOLORC: 'Verde', NIVEL: 900 };
  const module = { ...base, NIVEL: 950, STOCK: 0, COD_ALFA: 'MOD', CLASSIFICATION: 'MODULOS' };
  const actioned = { ...module, STOCK: 3, COD_ALFA: 'ACC', CLASSIFICATION: 'ACCIONADO' };
  const rows = groupStockView([module, actioned, { ...base, STOCK: 2, TALLC: 'M' }, { ...base, STOCK: 5, TALLC: 'S' }, { ...base, STOCK: 0, TALLC: 'XL' }]);
  assert.equal(rows.length, 3);
  assert.ok(rows.includes(module)); assert.ok(rows.includes(actioned));
  const group = rows.find(row => row.GROUPED_SINGLE);
  assert.equal(group.STOCK, 7);
  assert.deepEqual(group.SIZES.map(s => s.label), ['S', 'M']);
  assert.deepEqual(groupStockView([]), []);
});
