const config = require('./config/env');
const logger = require('./utils/logger');
const { getPool } = require('./db/pool');
const { startDailyJob } = require('./services/daily-job');
const { createApp } = require('./app');

async function start() {
  config.assertRuntime();
  const pool = await getPool();
  await pool.request().query('SELECT TOP 0 ID_EMPRESA FROM dbo.EMPRESAS');
  const server = createApp().listen(config.port, '0.0.0.0', () => {
    logger.info({ port: config.port }, 'Gestion Stock iniciada');
    startDailyJob();
    require('./services/grid-scheduler').startGridScheduler();
  });
  server.on('error', error => {
    logger.fatal({ err: error }, 'No se pudo abrir el puerto');
    process.exit(1);
  });
}

start().catch((error) => {
  logger.fatal({ err: error }, 'No se pudo iniciar la aplicacion. Verifique la conexion y ejecute npm run db:migrate.');
  process.exitCode = 1;
});
