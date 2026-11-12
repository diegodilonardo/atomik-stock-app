const express = require('express');
const { sql, getPool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { loadMaster, validateSelection, invalid } = require('../services/fashion-master');
const { buildFashionWorkbook } = require('../services/fashion-excel');
const { priceFashionProducts } = require('../services/fashion-prices');
const router = express.Router();
router.use((req, res, next) => {
  if (!require('../services/fashion-source').fashionEnabled(req.company)) return res.status(403).json({ error: 'La empresa no tiene configurado un maestro de moda.' });
  next();
});
const serialize = row => ({ id: row.ID_GRID, name: row.NAME, version: row.VERSION, ...JSON.parse(row.SELECTION_JSON) });
function gridId(value) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 2147483647) throw invalid('Grilla inválida');
  return Number(value);
}
router.get('/master', async (req, res, next) => {
  try { const master = await loadMaster(false, req.company); res.json({ ...master, products:await priceFashionProducts(master.products,req.company) }); } catch (error) { next(error); }
});
router.post('/refresh', requireRole('ADMIN'), async (req, res, next) => {
  try { const master = await loadMaster(true, req.company); res.json({ ...master, products:await priceFashionProducts(master.products,req.company) }); } catch (error) { next(error); }
});
router.get('/grids', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().input('company', sql.Int, req.user.companyId)
      .query('SELECT * FROM dbo.FASHION_GRIDS WHERE ID_EMPRESA=@company AND ACTIVE=1 ORDER BY NAME');
    res.json({ data: result.recordset.map(serialize) });
  } catch (error) { next(error); }
});
for (const method of ['post', 'put']) router[method](method === 'post' ? '/grids' : '/grids/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { products } = await loadMaster(false, req.company);
    const selection = validateSelection(req.body, products);
    const pool = await getPool();
    const request = pool.request().input('company', sql.Int, req.user.companyId).input('user', sql.Int, req.user.id)
      .input('name', sql.NVarChar(150), selection.name)
      .input('selection', sql.NVarChar(sql.MAX), JSON.stringify({ filters: selection.filters, items: selection.items, columns: selection.columns, protectExcel: selection.protectExcel, columnOrder: selection.columnOrder, excludedColumns: selection.excludedColumns, sort: selection.sort }));
    let result;
    if (method === 'post') result = await request.query(`INSERT dbo.FASHION_GRIDS(ID_EMPRESA,NAME,SELECTION_JSON,UPDATED_BY)
      OUTPUT INSERTED.* VALUES(@company,@name,@selection,@user)`);
    else {
      if (!Number.isInteger(req.body.version) || req.body.version < 1) throw invalid('Versión inválida');
      result = await request.input('id', sql.Int, gridId(req.params.id)).input('version', sql.Int, req.body.version)
        .query(`UPDATE dbo.FASHION_GRIDS SET NAME=@name,SELECTION_JSON=@selection,UPDATED_BY=@user,
          UPDATED_AT=SYSDATETIME(),VERSION=VERSION+1 OUTPUT INSERTED.*
          WHERE ID_EMPRESA=@company AND ID_GRID=@id AND VERSION=@version AND ACTIVE=1`);
    }
    if (!result.recordset.length) return res.status(409).json({ error: 'La grilla cambió o ya no existe. Volvé a abrirla.' });
    res.status(method === 'post' ? 201 : 200).json(serialize(result.recordset[0]));
  } catch (error) {
    if ([2601,2627].includes(error.number)) return res.status(409).json({ error: 'Ya existe una grilla de moda con ese nombre.' });
    next(error);
  }
});
router.post('/export', async (req, res, next) => {
  try {
    const { products } = await loadMaster(false, req.company);
    const selection = validateSelection(req.body, products);
    const workbook = await buildFashionWorkbook(req.company, selection, await priceFashionProducts(products,req.company));
    const buffer = await workbook.xlsx.writeBuffer();
    const selectedIds = new Set(selection.items.map(item => item.id));
    const rubros = [...new Set(products.filter(product => selectedIds.has(product.id))
      .map(product => String(product.RUBRO || '').trim().toUpperCase()).filter(Boolean))]
      .sort((a,b) => a.localeCompare(b,'es'));
    const filename = [selection.name, ...rubros].join(' - ')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0,200).replace(/[. ]+$/, '') + '.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(Buffer.from(buffer));
  } catch (error) { next(error); }
});
router.delete('/grids/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    if (!Number.isInteger(req.body.version) || req.body.version < 1) throw invalid('Versión inválida');
    const pool = await getPool();
    const result = await pool.request().input('company', sql.Int, req.user.companyId)
      .input('id', sql.Int, gridId(req.params.id)).input('version', sql.Int, req.body.version).input('user', sql.Int, req.user.id)
      .query(`UPDATE dbo.FASHION_GRIDS SET ACTIVE=0,VERSION=VERSION+1,UPDATED_BY=@user,UPDATED_AT=SYSDATETIME()
        OUTPUT INSERTED.ID_GRID WHERE ID_EMPRESA=@company AND ID_GRID=@id AND VERSION=@version AND ACTIVE=1`);
    if (!result.recordset.length) return res.status(409).json({ error: 'La grilla cambió o ya no existe. Volvé a abrirla.' });
    res.status(204).end();
  } catch (error) { next(error); }
});
module.exports = router;
