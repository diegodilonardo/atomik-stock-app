const { Writable } = require('node:stream');
const { Client } = require('basic-ftp');
const crypto = require('node:crypto');

const CATEGORIES = ['DISCIPLINA', 'HOMBRE', 'DAMA', 'KIDS', 'SUELTOS', 'ACCESORIOS'];
function invalid(message) { return Object.assign(new Error(message), { status: 400 }); }

// The .dbi export uses dBase III fixed-width records, not the stock TXT layout.
function parseMaster(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer[0] !== 3) throw invalid('Formato del maestro DBI no reconocido');
  const count = buffer.readUInt32LE(4), header = buffer.readUInt16LE(8), size = buffer.readUInt16LE(10);
  if (header < 33 || header > buffer.length || size < 2 || header + count * size > buffer.length) throw invalid('El maestro DBI está incompleto');
  const decoder = new TextDecoder('windows-1252');
  const fields = [];
  let offset = 1;
  for (let pos = 32; pos < header - 1; pos += 32) {
    if (pos + 32 > header) throw invalid('Encabezado DBI inválido');
    const name = decoder.decode(buffer.subarray(pos, pos + 11)).split('\0')[0].replace('Ñ', 'N');
    const length = buffer[pos + 16];
    fields.push({ name, offset, length });
    offset += length;
  }
  if (offset !== size || buffer[header - 1] !== 13) throw invalid('Longitud de registro DBI inválida');
  for (const name of ['CODIGO', 'COD_ALFA', 'COD_ANO', 'COD_TEM', 'DMODC', 'DCOLORC', 'PRECIO']) {
    if (!fields.some(field => field.name === name)) throw invalid(`Falta ${name} en el maestro`);
  }
  const products = [], seen = new Set();
  for (let i = 0; i < count; i++) {
    const start = header + i * size;
    if (buffer[start] === 42) continue;
    const row = Object.fromEntries(fields.map(f => [f.name, decoder.decode(buffer.subarray(start + f.offset, start + f.offset + f.length)).trim()]));
    if (!row.CODIGO || !row.COD_ALFA) throw invalid(`Registro ${i + 1}: faltan códigos`);
    const price = Number(row.PRECIO);
    if (!row.PRECIO || !Number.isFinite(price) || price < 0) throw invalid(`Registro ${i + 1}: precio inválido`);
    const stock = row.STOCK === undefined || row.STOCK === '' ? null : Number(row.STOCK);
    if (stock !== null && !Number.isFinite(stock)) throw invalid(`Registro ${i + 1}: stock inválido`);
    const id = crypto.createHash('sha256').update(JSON.stringify([row.CODIGO, row.COD_ALFA])).digest('hex');
    if (seen.has(id)) throw invalid(`Producto duplicado en el maestro: ${row.COD_ALFA}`);
    seen.add(id);
    products.push({ ...row, COD_ANIO: row.COD_ANO, PRECIO: price, STOCK: stock, PARES: Number(row.PARES || 0), id });
  }
  return products;
}

const cachedByCompany = new Map(), pendingByCompany = new Map();
async function loadMaster(refresh = false, companyCode = '0') {
  const source = require('./fashion-source').fashionSource(companyCode);
  if (!source) throw Object.assign(new Error('La empresa no tiene configurado un maestro de moda.'), { status: 400 });
  const key = JSON.stringify([source.code,source.path,source.host,source.port,source.user]);
  if (pendingByCompany.has(key)) return pendingByCompany.get(key);
  const cached = cachedByCompany.get(key);
  if (!refresh && cached && Date.now() - cached.timestamp < 3600000) return cached;
  const pending = (async () => {
    const client = new Client(30000);
    try {
      if (!source.host || !source.user || !source.password) {
        throw new Error('Configuración incompleta');
      }
      await client.access({ host:source.host, port:source.port, user:source.user, password:source.password, secure:source.secure });
      const chunks = [];
      let bytes = 0;
      const destination = new Writable({ write(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > 30 * 1024 * 1024) return done(new Error('Archivo demasiado grande'));
        chunks.push(chunk); done();
      } });
      await client.downloadTo(destination, source.path);
      const products = parseMaster(Buffer.concat(chunks));
      const result = { products, timestamp: Date.now() };
      cachedByCompany.set(key, result);
      return result;
    } catch (error) {
      if (error.status === 400) throw error;
      // Never expose FTP responses, connection options or credentials to the client/log.
      throw Object.assign(new Error('No se pudo leer el maestro FTP. Revise conexión y configuración.'), { status: 502 });
    } finally { client.close(); }
  })();
  pendingByCompany.set(key, pending);
  try { return await pending; } finally { pendingByCompany.delete(key); }
}

function validateSelection(body, products) {
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 150) throw invalid('Ingrese un nombre de hasta 150 caracteres');
  const filters = body.filters;
  if (!filters || !Array.isArray(filters.years) || !Array.isArray(filters.seasons) ||
      [...filters.years, ...filters.seasons].some(value => typeof value !== 'string' || value.length > 20)) throw invalid('Filtros de año y temporada inválidos');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 10000) throw invalid('Seleccione productos y asígneles una categoría');
  const byId = new Map(products.map(p => [p.id, p])), seen = new Set();
  const items = body.items.map(item => {
    const product = byId.get(item?.id);
    if (!product) throw invalid('Hay productos que ya no están en el maestro. Revise la selección.');
    const category = item.category === 'SUELTOS Y ACCESORIOS' ? 'SUELTOS' : item.category;
    if (seen.has(item.id) || !CATEGORIES.includes(category)) throw invalid('Categoría inválida o producto repetido');
    seen.add(item.id);
    return { id: item.id, category };
  });
  if(body.protectExcel !== undefined && typeof body.protectExcel !== 'boolean') throw invalid('La opción de protección del Excel debe ser verdadera o falsa');
  const columns = require('../../public/js/fashion-columns').normalize(body.columns);
  return { name: body.name.trim(), filters: { years: [...new Set(filters.years)], seasons: [...new Set(filters.seasons)] }, items, columns, protectExcel: body.protectExcel !== false, columnOrder: require('../../public/js/fashion-columns').normalizeOrder(body.columnOrder, columns), excludedColumns: require('../../public/js/fashion-columns').normalizeExcluded(body.excludedColumns, columns), sort: require('../../public/js/fashion-sort').normalize(body.sort) };
}

module.exports = { CATEGORIES, parseMaster, loadMaster, validateSelection, invalid };
