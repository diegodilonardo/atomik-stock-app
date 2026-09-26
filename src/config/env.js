const path = require('node:path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable obligatoria ${name} en .env`);
  return value;
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'si'].includes(value.toLowerCase());
}

function number(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} debe ser numerico`);
  return value;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: number('PORT', 3200),
  timezone: process.env.APP_TIMEZONE || 'America/Argentina/Buenos_Aires',
  database: {
    server: process.env.DB_SERVER || 'localhost',
    instanceName: process.env.DB_INSTANCE || undefined,
    port: number('DB_PORT', 1433),
    database: process.env.DB_DATABASE || 'GESTION_STOCK',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    encrypt: bool('DB_ENCRYPT', false),
    trustServerCertificate: bool('DB_TRUST_SERVER_CERTIFICATE', true)
  },
  jwt: {
    secret: process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'test-secret' : ''),
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  },
  stock: {
    sourceFile: process.env.STOCK_SOURCE_FILE || '',
    cron: process.env.STOCK_CRON || '0 7 * * *',
    retentionDays: number('STOCK_RETENTION_DAYS', 30)
  },
  excel: {
    outputDirectory: process.env.EXCEL_OUTPUT_DIRECTORY || '',
    outputFilename: process.env.EXCEL_OUTPUT_FILENAME || 'Grilla Atomik Stock Calzado - Vendedores.xlsx',
    publicPriceFactor: number('PUBLIC_PRICE_FACTOR', 1.85)
  },
  images: {
    directory: process.env.IMAGE_DIRECTORY || '',
    extensions: (process.env.IMAGE_EXTENSIONS || '.jpg,.jpeg,.png').split(',').map((x) => x.trim())
  }
};

config.assertRuntime = () => {
  required('JWT_SECRET');
};

module.exports = config;
