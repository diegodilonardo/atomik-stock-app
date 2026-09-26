const express = require('express');
const { sql, getPool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { runDailyJob } = require('../services/daily-job');

const router = express.Router();

router.get('/', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().input('company', sql.Int, req.user.companyId).query(`SELECT TOP 30 ID_IMPORT,STARTED_AT AT TIME ZONE 'Argentina Standard Time' AS STARTED_AT,FINISHED_AT AT TIME ZONE 'Argentina Standard Time' AS FINISHED_AT,STATUS,
      ROW_COUNT,STOCK_TOTAL,ERROR_MESSAGE,EXCEL_STATUS,EXCEL_ERROR,TRIGGERED_BY FROM dbo.STOCK_IMPORTS WHERE ID_EMPRESA=@company ORDER BY ID_IMPORT DESC`);
    res.json({ data: result.recordset });
  } catch (error) { next(error); }
});

router.post('/run', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const result = await runDailyJob(req.user.companyId, 'MANUAL', req.user.id);
    res.json({ ...result, excelUpdated: false });
  } catch (error) { next(error); }
});

module.exports = router;
