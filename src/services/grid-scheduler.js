const cron = require('node-cron');
const { sql, getPool } = require('../db/pool');
const { getCompany, normalizeFile } = require('./company-service');
const { queryStock, invalid } = require('./stock-rules');
const { getGrid } = require('./grid-service');
const { withCompanyLock } = require('./daily-job');
const { replaceSharedExcel } = require('./excel-service');
const logger = require('../utils/logger');
const TIMEZONE = 'America/Argentina/Buenos_Aires';

function validateSchedule(body) {
  if (typeof body.enabled !== 'boolean') throw invalid('Indique si la exportacion esta activa');
  if (!body.enabled) return { enabled: false, time: null, path: null };
  if (typeof body.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) throw invalid('Indique una hora valida');
  let path;
  try { path = normalizeFile(body.path); } catch (error) { throw invalid(error.message); }
  if (!/\.xlsx$/i.test(path)) throw invalid('La ruta debe terminar en .xlsx');
  return { enabled: true, time: body.time, path };
}

function localClock(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

async function runScheduledExports(now = new Date()) {
  const clock = localClock(now), pool = await getPool();
  const due = await pool.request().input('date', sql.Date, clock.date).input('time', sql.Char(5), clock.time)
    .query(`SELECT G.ID_EMPRESA,G.ID_GRID FROM dbo.STOCK_GRIDS G JOIN dbo.EMPRESAS E ON E.ID_EMPRESA=G.ID_EMPRESA
      WHERE E.ACTIVE=1 AND G.ACTIVE=1 AND G.EXPORT_ENABLED=1 AND G.EXPORT_TIME<=@time
      AND (G.EXPORT_LAST_DATE IS NULL OR G.EXPORT_LAST_DATE<@date)`);
  for (const item of due.recordset) {
    try {
      await withCompanyLock(item.ID_EMPRESA, async () => {
        const grid = await getGrid(item.ID_EMPRESA, item.ID_GRID);
        const company = await getCompany(item.ID_EMPRESA);
        const claim = await pool.request().input('id', sql.Int, grid.ID_GRID).input('date', sql.Date, clock.date).input('time', sql.Char(5), clock.time)
          .query(`UPDATE dbo.STOCK_GRIDS SET EXPORT_LAST_DATE=@date,EXPORT_STATUS='RUNNING',EXPORT_ERROR=NULL,EXPORT_FINISHED_AT=NULL
            OUTPUT INSERTED.ID_GRID WHERE ID_GRID=@id AND ACTIVE=1 AND EXPORT_ENABLED=1 AND EXPORT_TIME<=@time
            AND (EXPORT_LAST_DATE IS NULL OR EXPORT_LAST_DATE<@date)`);
        if (!claim.recordset.length) return;
        let error = null;
        try {
          const { data } = await queryStock(company, grid.rules);
          await replaceSharedExcel({ ...company, EXCEL_PATH: grid.EXPORT_PATH }, data, grid.rules.excelColumns);
        } catch (failure) { error = String(failure.message).slice(0, 2000); }
        await pool.request().input('id', sql.Int, grid.ID_GRID).input('error', sql.NVarChar(2000), error)
          .query(`UPDATE dbo.STOCK_GRIDS SET EXPORT_STATUS=CASE WHEN @error IS NULL THEN 'SUCCESS' ELSE 'ERROR' END,
            EXPORT_ERROR=@error,EXPORT_FINISHED_AT=SYSDATETIMEOFFSET() WHERE ID_GRID=@id`);
        if (error) logger.error({ gridId: grid.ID_GRID, error }, 'Fallo la exportacion programada');
        else logger.info({ gridId: grid.ID_GRID }, 'Grilla exportada');
      });
    } catch (error) { logger.warn({ gridId: item.ID_GRID, error: error.message }, 'Exportacion pendiente'); }
  }
}

function startGridScheduler() {
  const run = () => runScheduledExports().catch(error => logger.error({ err: error }, 'Fallo el programador de grillas'));
  cron.schedule('* * * * *', run, { timezone: TIMEZONE, noOverlap: true });
  run();
}
module.exports = { validateSchedule, localClock, runScheduledExports, startGridScheduler };
