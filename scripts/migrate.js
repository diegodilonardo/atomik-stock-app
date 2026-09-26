const fs = require('node:fs/promises');
const path = require('node:path');
const { sql, getPool } = require('../src/db/pool');
const config = require('../src/config/env');
const { normalizeFile } = require('../src/services/company-service');

async function main() {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    for (const file of ['001_schema.sql', '002_multiempresa.sql', '003_product_images.sql', '004_optional_stock_fields.sql', '005_saved_grids.sql', '006_grid_schedule.sql', '007_licenses.sql', '008_stock_brand.sql', '009_price_lists.sql', '010_unique_usernames.sql', '011_superadmin.sql', '012_atomik_company_code.sql', '013_cross_company_actors.sql', '014_price_factors.sql', '015_factor_dimensions.sql', '016_factor_lists.sql']) {
      const source = await fs.readFile(path.join(__dirname, '..', 'sql', file), 'utf8');
      for (const batch of source.split(/^GO\s*$/mi).filter((part) => part.trim())) {
        await new sql.Request(transaction).batch(batch);
      }
    }
    const sourceFile = config.stock.sourceFile ? normalizeFile(config.stock.sourceFile) : null;
    const excelPath = config.excel.outputDirectory ? normalizeFile(path.win32.join(config.excel.outputDirectory, config.excel.outputFilename)) : null;
    await new sql.Request(transaction)
      .input('source', sql.NVarChar(400), sourceFile)
      .input('excel', sql.NVarChar(400), excelPath)
      .input('factor', sql.Decimal(9,4), config.excel.publicPriceFactor)
      .input('retention', sql.Int, config.stock.retentionDays)
      .query(`UPDATE dbo.EMPRESAS SET SOURCE_FILE=@source,EXCEL_PATH=@excel,
        PUBLIC_PRICE_FACTOR=@factor,RETENTION_DAYS=@retention
        WHERE CODIGO='0' AND SOURCE_FILE IS NULL AND EXCEL_PATH IS NULL`);
    await transaction.commit();
    console.log('Esquema multiempresa actualizado; datos existentes conservados en Atomik.');
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  } finally { await pool.close(); }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
