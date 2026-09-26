const test = require('node:test');
const assert = require('node:assert/strict');
const { FIELDS, parseStockText, splitStockPrices } = require('../src/services/stock-parser');

function validLine(overrides = {}) {
  const row = Object.fromEntries(FIELDS.map((field) => [field, '0']));
  Object.assign(row, {
    rubro: 'CALZADO', cod_alfa: '2721135052001R9', codigo: '888889000067828',
    dmodc: 'BARESTEP', det_linea: 'LIFESTYLE', dcolorc: 'BLANCO', pares: '15',
    dtallc: '21 AL 26 X 15 PARES', sexo: 'UNI', edad: 'BABY', precio: '445135.1400',
    nombre: '21 AL 26', stock: '212.0000000', deposito: '7', nivel: '950',
    tallc: 'R9', disciplina: 'URBANO', dtoesp: '0.000', p_bas: '445135.1400', estadio: '',
    ...overrides
  });
  return FIELDS.map((field) => row[field]).join('|');
}

test('la estructura tiene 79 campos y respeta el orden de fotos', () => {
  assert.equal(FIELDS.length, 79);
  assert.deepEqual(FIELDS.slice(71), ['colorc', 'cod_tem', 'cod_anio', 'modc', 'dtoesp', 'p_bas', 'estadio', 'licencia']);
});
test('conserva ceros iniciales y acepta archivos anteriores de 74 campos', () => {
  const row = parseStockText(validLine({ colorc: '01', cod_tem: '2', cod_anio: '26', modc: '00345' }))[0];
  assert.equal(row.colorc, '01'); assert.equal(row.modc, '00345');
  const legacy = validLine().split('|').filter((_, index) => ![71,72,73,74,78].includes(index)).join('|');
  assert.equal(parseStockText(legacy)[0].modc, null);
  assert.equal(parseStockText(legacy)[0].p_bas, 445135.14);
});
test('rechaza formatos parciales y mezclados', () => {
  const line = validLine();
  assert.throws(() => parseStockText(line.split('|').slice(0, 77).join('|')), /74, 78 o 79/);
  assert.throws(() => parseStockText(line + '\n' + line.split('|').slice(0, 74).join('|')), /mezcla/);
});

test('convierte correctamente un registro valido', () => {
  const rows = parseStockText(`${validLine()}\r\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deposito, 7);
  assert.equal(rows[0].stock, 212);
  assert.equal(rows[0].cod_alfa, '2721135052001R9');
});

test('rechaza una fila con columnas faltantes', () => {
  assert.throws(() => parseStockText('CALZADO|CODIGO'), /se esperaban 74, 78 o 79 campos/);
});

test('rechaza claves duplicadas', () => {
  const line = validLine();
  assert.throws(() => parseStockText(`${line}\n${line}`), /Clave duplicada/);
});

test('rechaza depositos no admitidos', () => {
  assert.throws(() => parseStockText(validLine({ deposito: '9' })), /deposito inesperado/);
});

function extendedLine(overrides = {}) {
  const values = validLine(overrides).split('|');
  return [...values.slice(0, 75), values[78], ...values.slice(75, 78)].join('|');
}

test('MIDING acepta 82 campos, deposito 21 y conserva codigos adicionales', () => {
  const row = parseStockText(extendedLine({ deposito: '21', licencia: 'SAN LORENZO', dtoesp: '12.5', estadio: 'ACTIVO' }) + '|47 STREET|093|017')[0];
  assert.equal(row.licencia, 'SAN LORENZO');
  assert.equal(row.dtoesp, 12.5);
  assert.equal(row.estadio, 'ACTIVO');
  assert.equal(row.deposito, 21);
  assert.equal(row.marca, '47 STREET');
  assert.equal(row.lista, '093');
  assert.equal(row.version, '017');
  assert.equal(row.p_bas, 445135.14);
  const atomik = parseStockText(validLine())[0];
  assert.equal(atomik.marca, null);
  assert.equal(atomik.lista, null);
  assert.equal(atomik.version, null);
  assert.throws(() => parseStockText(extendedLine() + '|MARCA|' + '1'.repeat(31) + '|17'), /lista supera/);
});

test('separa listas sin sumar stock y rechaza inconsistencias o duplicados en la misma lista', () => {
  const first = extendedLine({ deposito: '21', stock: '10', precio: '100' }) + '|MARCA|93|17';
  const second = extendedLine({ deposito: '21', stock: '10', precio: '90' }) + '|MARCA|94|12';
  const result = splitStockPrices(parseStockText(first + '\n' + second));
  assert.equal(result.stock.length, 1);
  assert.equal(result.stock[0].stock, 10);
  assert.deepEqual(result.prices.map(row => row.precio), [100, 90]);
  assert.throws(() => parseStockText(first + '\n' + first), /duplicada/);
  const conflict = extendedLine({ deposito: '21', stock: '11' }) + '|MARCA|94|12';
  assert.throws(() => splitStockPrices(parseStockText(first + '\n' + conflict)), /stock/);
  assert.throws(() => splitStockPrices(parseStockText(extendedLine() + '|MARCA|93|')), /incompletas/);
});
