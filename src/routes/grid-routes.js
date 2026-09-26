const express = require('express');
const { sql, getPool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { normalizeRules, invalid, validatePriceList } = require('../services/stock-rules');
const { getGrid, serializeGrid } = require('../services/grid-service');
const router = express.Router();
const { validateSchedule } = require('../services/grid-scheduler');
const { withCompanyLock } = require('../services/daily-job');

router.put('/:id/schedule', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const schedule = validateSchedule(req.body);
    if (!Number.isInteger(req.body.version)) throw invalid('Version invalida');
    const result = await withCompanyLock(req.user.companyId, async () => {
      await getGrid(req.user.companyId, req.params.id);
      const pool = await getPool();
      return pool.request().input('company', sql.Int, req.user.companyId).input('id', sql.Int, Number(req.params.id))
        .input('version', sql.Int, req.body.version).input('user', sql.Int, req.user.id)
        .input('enabled', sql.Bit, schedule.enabled).input('time', sql.Char(5), schedule.time)
        .input('path', sql.NVarChar(400), schedule.path)
        .query(`UPDATE dbo.STOCK_GRIDS SET EXPORT_ENABLED=@enabled,EXPORT_TIME=@time,EXPORT_PATH=@path,
          UPDATED_BY=@user,UPDATED_AT=SYSDATETIME(),VERSION=VERSION+1
          OUTPUT INSERTED.* WHERE ID_EMPRESA=@company AND ID_GRID=@id AND ACTIVE=1 AND VERSION=@version`);
    });
    if (!result.recordset.length) return res.status(409).json({ error: 'La grilla cambio. Volve a abrirla.' });
    res.json(serializeGrid(result.recordset[0]));
  } catch (error) {
    if ([2601,2627].includes(error.number)) return res.status(409).json({ error: 'Otra grilla activa ya exporta a esa ruta. Elegi otro nombre de archivo.' });
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().input('company', sql.Int, req.user.companyId)
      .query('SELECT * FROM dbo.STOCK_GRIDS WHERE ID_EMPRESA=@company AND ACTIVE=1 ORDER BY NAME');
    res.json({ data: result.recordset.map(serializeGrid) });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try { res.json(await getGrid(req.user.companyId, req.params.id)); } catch (error) { next(error); }
});

function validateBody(body) {
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 150) throw invalid('Ingrese un nombre de hasta 150 caracteres');
  if (!body.rules) throw invalid('Indique las reglas de la grilla');
  return { name: body.name.trim(), rules: normalizeRules(body.rules, true) };
}

for (const method of ['post', 'put']) router[method](method === 'post' ? '/' : '/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await withCompanyLock(req.user.companyId, async () => {
    const body = validateBody(req.body);
    body.rules = await validatePriceList(req.user.companyId, body.rules);
    if (method === 'put') await getGrid(req.user.companyId, req.params.id);
    if (method === 'put' && (!Number.isInteger(req.body.version) || req.body.version < 1)) throw invalid('Version de grilla invalida');
    const pool = await getPool();
    const request = pool.request().input('company', sql.Int, req.user.companyId).input('user', sql.Int, req.user.id)
      .input('name', sql.NVarChar(150), body.name).input('rules', sql.NVarChar(sql.MAX), JSON.stringify(body.rules));
    let result;
    if (method === 'post') result = await request.query(`INSERT dbo.STOCK_GRIDS(ID_EMPRESA,NAME,RULES_JSON,CREATED_BY,UPDATED_BY)
      OUTPUT INSERTED.* VALUES(@company,@name,@rules,@user,@user)`);
    else result = await request.input('id', sql.Int, Number(req.params.id)).input('version', sql.Int, req.body.version)
      .query(`UPDATE dbo.STOCK_GRIDS SET NAME=@name,RULES_JSON=@rules,UPDATED_BY=@user,UPDATED_AT=SYSDATETIME(),VERSION=VERSION+1
        OUTPUT INSERTED.* WHERE ID_EMPRESA=@company AND ID_GRID=@id AND ACTIVE=1 AND VERSION=@version`);
    if (!result.recordset[0]) return res.status(409).json({ error: 'La grilla cambio. Volve a abrirla antes de guardar.' });
    res.status(method === 'post' ? 201 : 200).json(serializeGrid(result.recordset[0]));
    });
  } catch (error) {
    if ([2601,2627].includes(error.number)) return res.status(409).json({ error: 'Ya existe una grilla con ese nombre en la empresa' });
    next(error);
  }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await withCompanyLock(req.user.companyId, async () => {
    const grid = await getGrid(req.user.companyId, req.params.id);
    if (req.body.version !== grid.VERSION) return res.status(409).json({ error: 'La grilla cambio. Volve a abrirla antes de anular.' });
    const pool = await getPool();
    const result = await pool.request().input('company', sql.Int, req.user.companyId).input('id', sql.Int, grid.ID_GRID)
      .input('user', sql.Int, req.user.id).input('version', sql.Int, grid.VERSION)
      .query(`UPDATE dbo.STOCK_GRIDS SET ACTIVE=0,UPDATED_BY=@user,UPDATED_AT=SYSDATETIME(),VERSION=VERSION+1
        OUTPUT INSERTED.ID_GRID
        WHERE ID_EMPRESA=@company AND ID_GRID=@id AND ACTIVE=1 AND VERSION=@version`);
    if (!result.recordset.length) return res.status(409).json({ error: 'La grilla cambio. Volve a abrirla.' });
    res.status(204).end();
    });
  } catch (error) { next(error); }
});

module.exports = router;
