const sql = require('mssql');
const config = require('../config/env');
const logger = require('../utils/logger');

let poolPromise;

function connectionConfig(database = config.database.database) {
  const options = {
    encrypt: config.database.encrypt,
    trustServerCertificate: config.database.trustServerCertificate,
    enableArithAbort: true
  };
  if (config.database.instanceName) options.instanceName = config.database.instanceName;

  const result = {
    server: config.database.server,
    database,
    options,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout: 300000
  };
  if (!config.database.instanceName) result.port = config.database.port;
  if (config.database.user) result.user = config.database.user;
  if (config.database.password) result.password = config.database.password;
  return result;
}

async function getPool() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(connectionConfig());
    pool.on('error', (error) => logger.error({ error }, 'Error en el pool SQL Server'));
    poolPromise = pool.connect().catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

module.exports = { sql, getPool, connectionConfig };
