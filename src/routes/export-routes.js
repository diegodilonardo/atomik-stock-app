const express = require('express');
const { buildWorkbook, replaceSharedExcel } = require('../services/excel-service');
const path = require('node:path');
const { requireFiles, getCompany } = require('../services/company-service');
const { requireRole } = require('../middleware/auth');
const { withCompanyLock } = require('../services/daily-job');
const { normalizeRules, queryStock } = require('../services/stock-rules');
const { getGrid } = require('../services/grid-service');

const router = express.Router();

router.get('/download', async (req, res, next) => {
  try {
    const grid = req.query.gridId ? await getGrid(req.user.companyId, req.query.gridId) : null;
    const rules = grid ? grid.rules : normalizeRules(req.query);
    const { data } = await queryStock(req.company, rules);
    const workbook = await buildWorkbook(req.company, data, rules.excelColumns);
    const filename = grid ? `${grid.NAME.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.xlsx`
      : path.win32.basename(req.company.EXCEL_PATH || `Stock-${req.company.CODIGO}.xlsx`);
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(Buffer.from(buffer));
  } catch (error) { next(error); }
});

router.post('/shared', requireRole('ADMIN'), async (req, res, next) => {
  try {
    requireFiles(req.company);
    const excelPath = await withCompanyLock(req.user.companyId, async () => replaceSharedExcel(await getCompany(req.user.companyId)));
    res.json({ excelUpdated: true, excelPath });
  } catch (error) { next(error); }
});

module.exports = router;
