const express = require('express');
const { sql, getPool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');


const router = express.Router();
const imageIndexes = new Map();
router.get('/image', async (req, res, next) => {
  try {
    const code = req.query.code;
    if (typeof code !== 'string' || !code || code.length > 30) return res.sendStatus(400);
    if (!req.company.IMAGE_DIRECTORY) return res.sendStatus(404);
    const pool = await getPool();
    const result = await pool.request().input('company', sql.Int, req.user.companyId)
      .input('code', sql.VarChar(30), code).query(`SELECT TOP 1 COD_ANIO,COD_TEM,MODC,COLORC
        FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company AND COD_ALFA=@code`);
    if (!result.recordset.length) return res.sendStatus(404);
    const { loadImageIndex, findImage } = require('../services/product-images');
    const directory = req.company.IMAGE_DIRECTORY;
    const key = req.user.companyId;
    let cached = imageIndexes.get(key);
    if (!cached || cached.directory !== directory || cached.expires < Date.now()) {
      cached = { directory, expires: Date.now() + 60000, promise: loadImageIndex(directory) };
      imageIndexes.set(key, cached);
    }
    const filename = findImage(result.recordset[0], await cached.promise, req.company);
    if (!filename) return res.sendStatus(404);
    res.set('Cache-Control', 'private, max-age=60');
    res.sendFile(require('node:path').resolve(directory, filename), error => {
      if (error && !res.headersSent) res.sendStatus(404);
    });
  } catch (error) {
    if (['ENOENT','EACCES','EPERM','ENOTDIR'].includes(error.code)) return res.sendStatus(404);
    next(error);
  }
});

const { normalizeRules, queryStock } = require('../services/stock-rules');
const { getGrid } = require('../services/grid-service');
router.get('/', async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1), pageSize = Number(req.query.pageSize || 50);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200 || (page - 1) * pageSize > 2147483647) {
      return res.status(400).json({ error: 'Pagina invalida' });
    }
    const rules = req.query.gridId ? (await getGrid(req.user.companyId, req.query.gridId)).rules : normalizeRules(req.query);
    const grouped = req.query.groupSizes === '1' && (rules.type === 'SUELTOS' || (rules.level.length === 1 && rules.level[0] === '900'));
    let result;
    if (grouped) {
      const raw = await queryStock(req.company, { ...rules, positiveStock: true });
      const groups = require('../services/single-stock').groupSingles(raw.data);
      result = { data: groups.slice((page - 1) * pageSize, page * pageSize), total: groups.length, grouped: true };
    } else result = await queryStock(req.company, rules, { page, pageSize });
    res.json({ ...result, page, pageSize });
  } catch (error) { next(error); }
});

router.get('/filters', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().input('company', sql.Int, req.user.companyId).query(`
      SELECT DISTINCT RUBRO AS VALUE FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company AND RUBRO<>'' ORDER BY VALUE;
      SELECT DISTINCT COD_ANIO AS VALUE FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company AND COD_ANIO<>'' ORDER BY VALUE DESC;
      SELECT DISTINCT COD_TEM AS VALUE FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company AND COD_TEM<>'' ORDER BY VALUE;
      SELECT DISTINCT COALESCE(NULLIF(LICENCIA,''),N'Sin licencia') AS VALUE FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company ORDER BY VALUE;
      SELECT DISTINCT LISTA,VERSION FROM dbo.STOCK_PRICES WHERE ID_EMPRESA=@company ORDER BY LISTA,VERSION;
      SELECT DISTINCT COALESCE(NULLIF(MARCA,''),N'Sin marca') AS VALUE FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company ORDER BY VALUE;`);
    res.json({ brands: result.recordsets[5].map(r => r.VALUE), priceLists: result.recordsets[4].map(r => ({ value: JSON.stringify([r.LISTA,r.VERSION]), label: `Lista ${r.LISTA} — version ${r.VERSION}` })), licenses: result.recordsets[3].map(r => r.VALUE), rubros: result.recordsets[0].map(r => r.VALUE), years: result.recordsets[1].map(r => r.VALUE), seasons: result.recordsets[2].map(r => r.VALUE) });
  } catch (error) { next(error); }
});

router.get('/summary', async (req, res, next) => {
  try {
    const pool = await getPool();
    const rules = normalizeRules(req.query);
    const request = pool.request().input('company', sql.Int, req.user.companyId);
    const predicates = [];
    for (const [key, expression] of [['year','COD_ANIO'],['season','COD_TEM'],['rubro','RUBRO'],['license',"COALESCE(NULLIF(LICENCIA,''),N'Sin licencia')"],['brand',"COALESCE(NULLIF(MARCA,''),N'Sin marca')"]]) {
      request.input(key, sql.NVarChar(sql.MAX), JSON.stringify(rules[key]));
      predicates.push(`(@${key}=N'[]' OR ${expression} IN (SELECT value FROM OPENJSON(@${key})))`);
    }
    const result = await request.query(`
      SELECT COUNT(*) ROWS_COUNT, SUM(STOCK * PARES) STOCK_TOTAL,
        SUM(CASE WHEN NIVEL=950 THEN STOCK ELSE 0 END) MODULE_STOCK,
        SUM(CASE WHEN NIVEL=900 THEN STOCK ELSE 0 END) SINGLE_STOCK,
        MAX(IMPORTED_AT) AT TIME ZONE 'Argentina Standard Time' AS LAST_UPDATE
      FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company AND ${predicates.join(' AND ')};
      SELECT TOP 1 STATUS,STARTED_AT AT TIME ZONE 'Argentina Standard Time' AS STARTED_AT,FINISHED_AT AT TIME ZONE 'Argentina Standard Time' AS FINISHED_AT,ROW_COUNT,STOCK_TOTAL,ERROR_MESSAGE,EXCEL_STATUS,EXCEL_ERROR
      FROM dbo.STOCK_IMPORTS WHERE ID_EMPRESA=@company ORDER BY ID_IMPORT DESC;`);
    res.json({ stock: result.recordsets[0][0], lastImport: result.recordsets[1][0] || null });
  } catch (error) { next(error); }
});

router.patch('/classification', requireRole('ADMIN'), async (req, res, next) => {
  const codAlfas = Array.isArray(req.body.codAlfas) ? [...new Set(req.body.codAlfas.map(String))] : [];
  const classification = req.body.classification;
  if (!codAlfas.length || codAlfas.length > 500 || !['MODULOS','ACCIONADO'].includes(classification)) {
    return res.status(400).json({ error: 'Seleccione productos y una clasificacion valida' });
  }
  try {
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const codAlfa of codAlfas) {
        const request = new sql.Request(transaction).input('company', sql.Int, req.user.companyId)
          .input('codAlfa', sql.VarChar(30), codAlfa)
          .input('classification', sql.VarChar(20), classification)
          .input('userId', sql.Int, req.user.id);
        await request.query(`
          IF NOT EXISTS(SELECT 1 FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company AND COD_ALFA=@codAlfa AND NIVEL=950)
            THROW 50001,'Solo se pueden clasificar productos con nivel 950 (modulos)',1;
          DECLARE @previous VARCHAR(20)=(SELECT CLASSIFICATION FROM dbo.PRODUCT_CLASSIFICATION WHERE ID_EMPRESA=@company AND COD_ALFA=@codAlfa);
          MERGE dbo.PRODUCT_CLASSIFICATION T USING (SELECT @codAlfa COD_ALFA) S ON T.COD_ALFA=S.COD_ALFA AND T.ID_EMPRESA=@company
          WHEN MATCHED THEN UPDATE SET CLASSIFICATION=@classification,UPDATED_AT=SYSDATETIME(),UPDATED_BY=@userId
          WHEN NOT MATCHED THEN INSERT(ID_EMPRESA,COD_ALFA,CLASSIFICATION,UPDATED_BY) VALUES(@company,@codAlfa,@classification,@userId);
          IF ISNULL(@previous,'')<>@classification
            INSERT dbo.CLASSIFICATION_AUDIT(ID_EMPRESA,COD_ALFA,PREVIOUS_CLASSIFICATION,NEW_CLASSIFICATION,ID_USER)
            VALUES(@company,@codAlfa,@previous,@classification,@userId);`);
      }
      await transaction.commit();
    } catch (error) { await transaction.rollback(); throw error; }
    res.json({ updated: codAlfas.length, classification });
  } catch (error) { next(error); }
});

module.exports = router;
