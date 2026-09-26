const express = require('express');

const path = require('node:path');

const { sql, getPool } = require('../db/pool');

const { requireRole } = require('../middleware/auth');

const { normalizeFile } = require('../services/company-service');

const { withCompanyLock } = require('../services/daily-job');



const router = express.Router();

router.use(requireRole('ADMIN'));

router.get('/', async (req, res, next) => {

  try {

  const { ID_EMPRESA, CODIGO, NOMBRE, SOURCE_FILE, EXCEL_PATH, PUBLIC_PRICE_FACTOR, RETENTION_DAYS, IMAGE_DIRECTORY } = req.company;

  const pool = await getPool();

  const result = await pool.request().input('company', sql.Int, ID_EMPRESA).query(`

    SELECT MARCA,NIVEL,FACTOR,ESPECIFICO,LICENCIA,RUBRO,LISTA FROM dbo.COMPANY_PRICE_FACTORS WHERE ID_EMPRESA=@company;

    SELECT COALESCE(MARCA,N'') AS MARCA FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company

    UNION SELECT MARCA FROM dbo.COMPANY_PRICE_FACTORS WHERE ID_EMPRESA=@company;

    SELECT DISTINCT COALESCE(MARCA,N'') AS MARCA,COALESCE(LICENCIA,N'') AS LICENCIA,RUBRO FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company

    UNION SELECT MARCA,LICENCIA,RUBRO FROM dbo.COMPANY_PRICE_FACTORS WHERE ID_EMPRESA=@company AND ESPECIFICO=1;
    SELECT DISTINCT LISTA FROM dbo.STOCK_PRICES WHERE ID_EMPRESA=@company
    UNION SELECT LISTA FROM dbo.COMPANY_PRICE_FACTORS WHERE ID_EMPRESA=@company AND LISTA<>N'';`);

  res.json({ ID_EMPRESA, CODIGO, NOMBRE, SOURCE_FILE, EXCEL_PATH, PUBLIC_PRICE_FACTOR, RETENTION_DAYS, IMAGE_DIRECTORY,

    priceLists: result.recordsets[3].map(row => row.LISTA).sort(), combinations: result.recordsets[2], priceFactors: result.recordsets[0], brands: result.recordsets[1].map(row => row.MARCA).sort() });

  } catch (error) { next(error); }

});

router.put('/', async (req, res, next) => {

  let source, excel, imageDirectory;

  const factor = Number(req.body.publicPriceFactor);

  const retention = Number(req.body.retentionDays);

  let priceFactors;

  try {

    if (req.body.priceFactors !== undefined) {

      if (!Array.isArray(req.body.priceFactors) || req.body.priceFactors.length > 2000) throw new Error('Coeficientes invalidos');

      const unique = new Set();

      priceFactors = req.body.priceFactors.map(rule => {

        if (!rule || typeof rule.brand !== 'string' || rule.brand.length > 150 || ![900,950].includes(rule.level)

          || typeof rule.factor !== 'number' || !Number.isFinite(rule.factor) || rule.factor < 0.0001 || rule.factor > 99999

          || Math.abs(rule.factor * 10000 - Math.round(rule.factor * 10000)) > 0.00001) throw new Error('Cada coeficiente debe tener marca, tipo de producto y un valor positivo de hasta cuatro decimales');

        const brand = rule.brand.trim();
        if (rule.list !== undefined && (typeof rule.list !== 'string' || rule.list.length > 30)) throw new Error('Lista inválida');
        const list = (rule.list || '').trim();

        const specific = rule.specific === true;

        if (rule.specific !== undefined && typeof rule.specific !== 'boolean') throw new Error('Combinación inválida');

        if (specific && (typeof rule.license !== 'string' || rule.license.length > 150 || typeof rule.rubro !== 'string' || rule.rubro.length > 40)) throw new Error('Licencia o rubro inválido');

        const license = specific ? rule.license.trim() : '';

        const rubro = specific ? rule.rubro.trim() : '';

        const key = JSON.stringify([brand.toUpperCase(),rule.level,specific,license.toUpperCase(),rubro.toUpperCase(),list.toUpperCase()]);

        if (unique.has(key)) throw new Error('Hay coeficientes repetidos para la misma marca, licencia, rubro y tipo de producto');

        unique.add(key);

        return { brand, specific, license, rubro, list, level: rule.level, factor: rule.factor };

      });

    }

    source = normalizeFile(req.body.sourceFile);

    excel = String(req.body.excelPath || '').trim() ? normalizeFile(req.body.excelPath) : null;

    imageDirectory = req.body.imageDirectory === undefined ? req.company.IMAGE_DIRECTORY : String(req.body.imageDirectory || '').trim();

    if (imageDirectory) imageDirectory = path.win32.dirname(normalizeFile(imageDirectory.replace(/\\+$/, '') + '\\image.jpg'));

    if (!/\.txt$/i.test(source) || (excel && !/\.xlsx$/i.test(excel))) throw new Error('El origen debe ser .TXT y la salida .xlsx');

    if (!Number.isFinite(factor) || factor <= 0 || factor > 99999 || !Number.isInteger(retention) || retention < 1 || retention > 3650) {

      throw new Error('Factor de precio o dias de historial invalidos');

    }

  } catch (error) { return res.status(400).json({ error: error.message }); }

  try {

    await withCompanyLock(req.user.companyId, async () => {

      const pool = await getPool();

      const transaction = new sql.Transaction(pool);

      await transaction.begin();

      try {

      await new sql.Request(transaction).input('company', sql.Int, req.user.companyId)

        .input('source', sql.NVarChar(400), source).input('excel', sql.NVarChar(400), excel)

        .input('factor', sql.Decimal(9,4), factor).input('retention', sql.Int, retention)

        .input('images', sql.NVarChar(400), imageDirectory || null)

        .query(`UPDATE dbo.EMPRESAS SET SOURCE_FILE=@source,EXCEL_PATH=@excel,

          PUBLIC_PRICE_FACTOR=@factor,RETENTION_DAYS=@retention,IMAGE_DIRECTORY=@images WHERE ID_EMPRESA=@company`);

      if (priceFactors !== undefined) await new sql.Request(transaction)

        .input('company', sql.Int, req.user.companyId).input('rules', sql.NVarChar(sql.MAX), JSON.stringify(priceFactors))

        .query(`DELETE dbo.COMPANY_PRICE_FACTORS WHERE ID_EMPRESA=@company;

          INSERT dbo.COMPANY_PRICE_FACTORS(ID_EMPRESA,MARCA,NIVEL,FACTOR,ESPECIFICO,LICENCIA,RUBRO,LISTA)

          SELECT @company,brand,level,factor,specific,license,rubro,list FROM OPENJSON(@rules)

          WITH (brand NVARCHAR(150),level INT,factor DECIMAL(9,4),specific BIT,license NVARCHAR(150),rubro NVARCHAR(40),list NVARCHAR(30));`);

      await transaction.commit();

      } catch (error) { await transaction.rollback().catch(() => {}); throw error; }

    });

    res.json({ updated: true });

  } catch (error) {

    if ([2601,2627].includes(error.number)) return res.status(409).json({ error: 'El archivo o la salida ya pertenecen a otra empresa' });

    next(error);

  }

});

module.exports = router;

