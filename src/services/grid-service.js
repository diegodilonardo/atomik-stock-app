const { sql, getPool } = require('../db/pool');
const { normalizeRules, invalid } = require('./stock-rules');

function serializeGrid(row) {
  const { RULES_JSON, ...grid } = row;
  return { ...grid, rules: normalizeRules(JSON.parse(RULES_JSON), true) };
}

async function getGrid(companyId, id) {
  if (!/^\d+$/.test(String(id)) || Number(id) < 1 || Number(id) > 2147483647) throw invalid('Grilla invalida');
  const pool = await getPool();
  const result = await pool.request().input('company', sql.Int, companyId).input('id', sql.Int, Number(id))
    .query('SELECT * FROM dbo.STOCK_GRIDS WHERE ID_EMPRESA=@company AND ID_GRID=@id AND ACTIVE=1');
  if (!result.recordset[0]) throw Object.assign(new Error('Grilla inexistente'), { status: 404 });
  return serializeGrid(result.recordset[0]);
}

module.exports = { getGrid, serializeGrid };
