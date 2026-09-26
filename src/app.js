const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const config = require('./config/env');
const logger = require('./utils/logger');
const { authenticate } = require('./middleware/auth');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api/auth', require('./routes/auth-routes'));
  app.use('/api/stock', authenticate, require('./routes/stock-routes'));
  app.use('/api/imports', authenticate, require('./routes/import-routes'));
  app.use('/api/export', authenticate, require('./routes/export-routes'));
  app.use('/api/users', authenticate, require('./routes/user-routes'));
  app.use('/api/company', authenticate, require('./routes/company-routes'));
  app.use('/api/grids', authenticate, require('./routes/grid-routes'));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta inexistente' }));
  app.use((error, _req, res, _next) => {
    logger.error({ err: error }, 'Error HTTP');
    res.status(error.status || 500).json({ error: config.env === 'production' && !error.status ? 'Error interno' : error.message });
  });
  return app;
}

module.exports = { createApp };
