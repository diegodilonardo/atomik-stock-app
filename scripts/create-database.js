const { sql, connectionConfig } = require('../src/db/pool');
const config = require('../src/config/env');

async function main() {
  const database = config.database.database;
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('DB_DATABASE solo puede contener letras, numeros y guion bajo');
  const pool = await new sql.ConnectionPool(connectionConfig('master')).connect();
  await pool.request().query(`IF DB_ID('${database}') IS NULL CREATE DATABASE [${database}]`);
  console.log(`Base ${database} disponible.`);
  await pool.close();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
