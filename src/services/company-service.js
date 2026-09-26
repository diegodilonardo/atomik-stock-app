const path = require('node:path');
const { sql, getPool } = require('../db/pool');

function normalizeFile(value) {
  const file = String(value || '').trim();
  if (!file || file.length > 400 || !/^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+\\)/.test(file) || /[<>"|?*\x00-\x1f]/.test(file) || file.includes('/') || /[\\]$/.test(file)) {
    throw new Error('Ingrese una ruta completa de Windows, incluyendo el nombre del archivo (maximo 400 caracteres)');
  }
  const normalized = path.win32.normalize(file);
  if (normalized.split('\\').some(part => /[. ]$/.test(part)) || normalized.slice(2).includes(':')) throw new Error('La ruta contiene un nombre de archivo invalido');
  return normalized;
}

async function getCompany(id) {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Empresa invalida');
  const pool = await getPool();
  const result = await pool.request().input('id', sql.Int, id)
    .query('SELECT * FROM dbo.EMPRESAS WHERE ID_EMPRESA=@id AND ACTIVE=1');
  if (!result.recordset[0]) throw new Error('Empresa inexistente o inactiva');
  return result.recordset[0];
}

async function getCompanyByCode(code) {
  const pool = await getPool();
  const result = await pool.request().input('code', sql.VarChar(40), String(code || '').trim().toUpperCase())
    .query('SELECT * FROM dbo.EMPRESAS WHERE CODIGO=@code AND ACTIVE=1');
  if (!result.recordset[0]) throw new Error('Empresa inexistente o inactiva');
  return result.recordset[0];
}

function requireFiles(company) {
  if (!company.SOURCE_FILE || !company.EXCEL_PATH) throw new Error('Configure el archivo de stock y el Excel de salida de la empresa');
}

module.exports = { getCompany, getCompanyByCode, normalizeFile, requireFiles };
