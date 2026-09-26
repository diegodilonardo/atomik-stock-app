const fs = require('node:fs/promises');

const FIELDS = [
  'rubro', 'cod_alfa', 'codigo', 'dmodc', 'det_linea', 'dcolorc', 'pares', 'dtallc',
  'sexo', 'edad', 'precio', 'nombre',
  't01', 't02', 't03', 't04', 't05', 't06', 't07', 't08', 't10', 't12', 't14',
  't15', 't16', 't17', 't18', 't19', 't20', 't21', 't22', 't23', 't24', 't25',
  't26', 't27', 't28', 't29', 't30', 't31', 't32', 't33', 't34', 't35', 't36',
  't37', 't38', 't39', 't40', 't41', 't42', 't43', 't44', 't45', 't46', 't47',
  't48', 't49', 't50', 't_2xl', 't_3xl', 't_l', 't_m', 't_s', 't_xl', 't_xs',
  'stock', 'deposito', 'nivel', 'tallc', 'disciplina', 'colorc', 'cod_tem', 'cod_anio',
  'modc', 'dtoesp', 'p_bas', 'estadio', 'licencia'
];
const EXTENDED_FIELDS = [...FIELDS.slice(0, 75), 'licencia', 'dtoesp', 'p_bas', 'estadio', 'marca', 'lista', 'version'];
const LEGACY_FIELDS = FIELDS.filter(field => !['colorc', 'cod_tem', 'cod_anio', 'modc', 'licencia'].includes(field));

const INTEGER_FIELDS = new Set([
  'pares', 'deposito', 'nivel',
  ...FIELDS.filter((name) => /^t(?:\d|_)/.test(name))
]);
const DECIMAL_FIELDS = new Set(['precio', 'stock', 'dtoesp', 'p_bas']);

function toInteger(value, field, lineNumber) {
  const parsed = Number(value || 0);
  if (!Number.isInteger(parsed)) throw new Error(`Linea ${lineNumber}: ${field} no es entero (${value})`);
  return parsed;
}

function toDecimal(value, field, lineNumber) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) throw new Error(`Linea ${lineNumber}: ${field} no es numerico (${value})`);
  return parsed;
}

function parseLine(line, lineNumber) {
  const values = line.split('|');
  if (![74, 78, FIELDS.length, EXTENDED_FIELDS.length].includes(values.length)) {
    throw new Error(`Linea ${lineNumber}: se esperaban 74, 78 o 79 campos, o 82 con MARCA, LISTA y VERSION; llegaron ${values.length}`);
  }

  const row = {};
  const fields = values.length === 74 ? LEGACY_FIELDS : values.length === 82 ? EXTENDED_FIELDS : FIELDS;
  fields.forEach((field, index) => {
    const value = (values[index] || '').trim();
    if (INTEGER_FIELDS.has(field)) row[field] = toInteger(value, field, lineNumber);
    else if (DECIMAL_FIELDS.has(field)) row[field] = toDecimal(value, field, lineNumber);
    else row[field] = value || null;
  });
  row.licencia ??= null;
  for (const [field, limit] of [['marca', 150], ['lista', 30], ['version', 30]]) {
    row[field] ??= null;
    if (row[field] && row[field].length > limit) throw new Error(`Linea ${lineNumber}: ${field} supera ${limit} caracteres`);
  }
  if (row.licencia && row.licencia.length > 150) throw new Error(`Linea ${lineNumber}: licencia supera 150 caracteres`);
  for (const field of ['colorc', 'cod_tem', 'cod_anio', 'modc']) row[field] ??= null;
  for (const field of ['colorc', 'cod_tem', 'cod_anio', 'modc']) {
    if (row[field] && !/^[A-Za-z0-9_-]{1,30}$/.test(row[field])) throw new Error(`Linea ${lineNumber}: ${field} contiene un codigo invalido`);
  }

  for (const field of ['rubro', 'cod_alfa', 'codigo', 'dmodc', 'dcolorc']) {
    if (!row[field]) throw new Error(`Linea ${lineNumber}: falta ${field}`);
  }
  if (![7, 8, 21].includes(row.deposito)) {
    throw new Error(`Linea ${lineNumber}: deposito inesperado ${row.deposito}`);
  }
  if (row.stock < 0) throw new Error(`Linea ${lineNumber}: stock negativo`);
  return row;
}

function parseStockText(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error('El archivo de stock esta vacio');
  if (new Set(lines.map(line => line.split('|').length)).size !== 1) throw new Error('El archivo mezcla filas con distinta cantidad de campos');

  const rows = lines.map((line, index) => parseLine(line, index + 1));
  const unique = new Set();
  for (const row of rows) {
    const key = JSON.stringify([row.cod_alfa, row.deposito, row.nivel, row.lista, row.version]);
    if (unique.has(key)) throw new Error(`Clave duplicada: ${row.cod_alfa}, deposito ${row.deposito}, nivel ${row.nivel}`);
    unique.add(key);
  }
  return rows;
}

function splitStockPrices(rows) {
  const inventory = new Map();
  const prices = [];
  const priceFields = new Set(['precio', 'p_bas', 'dtoesp', 'lista', 'version']);
  for (const row of rows) {
    if (Boolean(row.lista) !== Boolean(row.version)) throw new Error(`Lista y version incompletas: ${row.cod_alfa}`);
    const key = JSON.stringify([row.cod_alfa, row.deposito, row.nivel]);
    const previous = inventory.get(key);
    if (previous) {
      const different = Object.keys(row).find(field => !priceFields.has(field) && row[field] !== previous[field]);
      if (different || !row.lista || !previous.lista) throw new Error(`Datos incompatibles entre listas: ${row.cod_alfa} (${different || 'lista'})`);
    } else inventory.set(key, row);
    if (row.lista) prices.push(row);
  }
  if (prices.length && rows.some(row => !row.lista)) throw new Error('El archivo mezcla productos con y sin lista de precios');
  return { stock: [...inventory.values()], prices };
}

async function parseStockFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return parseStockText(buffer.toString('latin1'));
}

module.exports = { FIELDS, parseLine, parseStockText, parseStockFile, splitStockPrices };
