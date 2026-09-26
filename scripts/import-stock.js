const { runDailyJob } = require('../src/services/daily-job');
const { getCompanyByCode } = require('../src/services/company-service');
const { getPool } = require('../src/db/pool');

async function main() {
  const pool = await getPool();
  try {
    const company = await getCompanyByCode(process.argv[2] || '0');
    console.log(await runDailyJob(company.ID_EMPRESA, 'MANUAL'));
  } finally { await pool.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
