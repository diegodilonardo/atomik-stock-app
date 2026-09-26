const cron = require('node-cron');
const config = require('../config/env');
const { sql, getPool, connectionConfig } = require('../db/pool');
const { importStock } = require('./import-service');


const logger = require('../utils/logger');

// Session lock also protects against another Node process or a manual export.
async function withCompanyLock(companyId, work) {
  const options = connectionConfig();
  options.pool = { max: 1, min: 1, idleTimeoutMillis: 300000 };
  const connection = new sql.ConnectionPool(options);
  let locked = false;
  const resource = `stock-company-${companyId}`;
  try {
    await connection.connect();
    const result = await connection.request().input('resource', sql.NVarChar(255), resource)
      .query(`DECLARE @result INT; EXEC @result=sys.sp_getapplock @Resource=@resource,
        @LockMode='Exclusive',@LockOwner='Session',@LockTimeout=0; SELECT @result AS RESULT;`);
    if (result.recordset[0].RESULT < 0) throw new Error('Ya hay una actualizacion o exportacion en curso para esta empresa');
    locked = true;
    return await work();
  } finally {
    if (locked) await connection.request().input('resource', sql.NVarChar(255), resource)
      .query("EXEC sys.sp_releaseapplock @Resource=@resource,@LockOwner='Session'").catch(() => {});
    await connection.close();
  }
}

async function runDailyJob(companyId, triggeredBy = 'CRON', userId = null) {
  return withCompanyLock(companyId, async () => {
    const imported = await importStock({ companyId, triggeredBy, userId });
    logger.info(imported, 'Importacion de stock finalizada');
    return imported;
  });
}

async function shouldCatchUp(companyId) {
  if (config.stock.cron !== '0 7 * * *') return false;
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  if (hour < 7) return false;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
  const pool = await getPool();
  const result = await pool.request().input('company', sql.Int, companyId).input('today', sql.Date, today)
    .query(`SELECT TOP 1 CASE WHEN CONVERT(date,FINISHED_AT)=@today THEN 1 ELSE 0 END AS DONE_TODAY
      FROM dbo.STOCK_IMPORTS WHERE STATUS='SUCCESS' AND ID_EMPRESA=@company ORDER BY ID_IMPORT DESC`);
  return result.recordset[0]?.DONE_TODAY !== 1;
}

async function runCompanies(triggeredBy) {
  const pool = await getPool();
  const companies = await pool.request().query('SELECT ID_EMPRESA FROM dbo.EMPRESAS WHERE ACTIVE=1 AND SOURCE_FILE IS NOT NULL');
  for (const company of companies.recordset) {
    try {
      if (triggeredBy !== 'STARTUP' || await shouldCatchUp(company.ID_EMPRESA)) await runDailyJob(company.ID_EMPRESA, triggeredBy);
    } catch (error) { logger.error({ err: error, companyId: company.ID_EMPRESA }, 'Fallo el proceso de la empresa'); }
  }
}

function startDailyJob() {
  cron.schedule(config.stock.cron, () => runCompanies('CRON').catch(error => logger.error({ err: error }, 'Fallo el proceso diario')),
    { timezone: config.timezone, noOverlap: true });
  logger.info({ cron: config.stock.cron }, 'Cron multiempresa iniciado');
  setTimeout(() => runCompanies('STARTUP').catch(error => logger.error({ err: error }, 'Fallo la recuperacion al iniciar')), 10000).unref();
}

module.exports = { runDailyJob, startDailyJob, shouldCatchUp, withCompanyLock };
