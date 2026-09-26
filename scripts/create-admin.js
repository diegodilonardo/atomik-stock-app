const bcrypt = require('bcryptjs');
const { sql, getPool } = require('../src/db/pool');
const { getCompanyByCode } = require('../src/services/company-service');

async function main() {
  const args = process.argv.slice(2);
  let companyCode = '0';
  if (args[0] === '--empresa') { args.shift(); companyCode = args.shift(); }
  const [usernameArg, password, ...nameParts] = args;
  const username = String(usernameArg || '').trim().toUpperCase();
  const fullName = nameParts.join(' ').trim() || username;
  if (!username || !password || password.length < 8) {
    throw new Error('Uso: npm run user:create-admin -- USUARIO contraseña_de_8_caracteres "Nombre Apellido"');
  }
  const hash = await bcrypt.hash(password, 12);
  const pool = await getPool();
  try {
  const company = await getCompanyByCode(companyCode);
  await pool.request()
    .input('company', sql.Int, company.ID_EMPRESA)
    .input('username', sql.VarChar(80), username)
    .input('fullName', sql.VarChar(150), fullName)
    .input('hash', sql.VarChar(255), hash)
    .query(`MERGE dbo.USERS AS T USING (SELECT @username USERNAME) S ON T.USERNAME=S.USERNAME AND T.ID_EMPRESA=@company
      WHEN MATCHED THEN UPDATE SET FULL_NAME=@fullName,PASSWORD_HASH=@hash,ROLE='ADMIN',ACTIVE=1,UPDATED_AT=SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (ID_EMPRESA,USERNAME,FULL_NAME,PASSWORD_HASH,ROLE) VALUES (@company,@username,@fullName,@hash,'ADMIN');`);
  console.log(`Administrador ${username} creado/actualizado en ${company.CODIGO}.`);
  } catch (error) {
    if ([2601, 2627].includes(error.number)) throw new Error('Ese nombre de usuario ya esta asignado a otra empresa. Use un nombre unico.');
    throw error;
  } finally { await pool.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
