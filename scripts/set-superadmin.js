const { sql, getPool } = require('../src/db/pool');

async function main() {
  const username = String(process.argv[2] || '').trim().toUpperCase();
  if (!username || username.length > 80 || process.argv.length !== 3) throw new Error('Uso: node scripts/set-superadmin.js USUARIO');
  const pool = await getPool();
  try {
    const result = await pool.request().input('username', sql.VarChar(80), username)
      .query(`UPDATE dbo.USERS SET IS_SUPERADMIN=1,UPDATED_AT=SYSDATETIME()
        OUTPUT INSERTED.USERNAME WHERE USERNAME=@username AND ACTIVE=1 AND ROLE='ADMIN'`);
    if (result.recordset.length !== 1) throw new Error('Debe indicar un administrador activo existente');
    console.log(`Superadministrador habilitado: ${result.recordset[0].USERNAME}`);
  } finally { await pool.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
