const fs = require('node:fs/promises');
const config = require('../config/env');
const { getCompany } = require('./company-service');
const { sql, getPool } = require('../db/pool');
const { parseStockFile, splitStockPrices } = require('./stock-parser');
const logger = require('../utils/logger');

const running = new Set();

function argentinaDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

const openJsonColumns = `
  RUBRO VARCHAR(40) '$.rubro', COD_ALFA VARCHAR(30) '$.cod_alfa', CODIGO VARCHAR(30) '$.codigo',
  DMODC VARCHAR(150) '$.dmodc', DET_LINEA VARCHAR(80) '$.det_linea', DCOLORC VARCHAR(100) '$.dcolorc',
  PARES INT '$.pares', DTALLC VARCHAR(150) '$.dtallc', SEXO VARCHAR(20) '$.sexo', EDAD VARCHAR(30) '$.edad',
  PRECIO DECIMAL(19,4) '$.precio', NOMBRE VARCHAR(150) '$.nombre',
  T01 INT '$.t01', T02 INT '$.t02', T03 INT '$.t03', T04 INT '$.t04', T05 INT '$.t05',
  T06 INT '$.t06', T07 INT '$.t07', T08 INT '$.t08', T10 INT '$.t10', T12 INT '$.t12',
  T14 INT '$.t14', T15 INT '$.t15', T16 INT '$.t16', T17 INT '$.t17', T18 INT '$.t18',
  T19 INT '$.t19', T20 INT '$.t20', T21 INT '$.t21', T22 INT '$.t22', T23 INT '$.t23',
  T24 INT '$.t24', T25 INT '$.t25', T26 INT '$.t26', T27 INT '$.t27', T28 INT '$.t28',
  T29 INT '$.t29', T30 INT '$.t30', T31 INT '$.t31', T32 INT '$.t32', T33 INT '$.t33',
  T34 INT '$.t34', T35 INT '$.t35', T36 INT '$.t36', T37 INT '$.t37', T38 INT '$.t38',
  T39 INT '$.t39', T40 INT '$.t40', T41 INT '$.t41', T42 INT '$.t42', T43 INT '$.t43',
  T44 INT '$.t44', T45 INT '$.t45', T46 INT '$.t46', T47 INT '$.t47', T48 INT '$.t48',
  T49 INT '$.t49', T50 INT '$.t50', T_2XL INT '$.t_2xl', T_3XL INT '$.t_3xl',
  T_L INT '$.t_l', T_M INT '$.t_m', T_S INT '$.t_s', T_XL INT '$.t_xl', T_XS INT '$.t_xs',
  STOCK DECIMAL(19,4) '$.stock', DEPOSITO INT '$.deposito', NIVEL INT '$.nivel', TALLC VARCHAR(30) '$.tallc',
  DISCIPLINA VARCHAR(80) '$.disciplina', DTOESP DECIMAL(9,3) '$.dtoesp',
  P_BAS DECIMAL(19,4) '$.p_bas', ESTADIO VARCHAR(20) '$.estadio',
  COLORC VARCHAR(30) '$.colorc', COD_TEM VARCHAR(30) '$.cod_tem',
  COD_ANIO VARCHAR(30) '$.cod_anio', MODC VARCHAR(30) '$.modc', LICENCIA NVARCHAR(150) '$.licencia',
  MARCA NVARCHAR(150) '$.marca', LISTA NVARCHAR(30) '$.lista', VERSION NVARCHAR(30) '$.version'
`;

const stockColumns = `RUBRO,COD_ALFA,CODIGO,DMODC,DET_LINEA,DCOLORC,PARES,DTALLC,SEXO,EDAD,PRECIO,NOMBRE,
T01,T02,T03,T04,T05,T06,T07,T08,T10,T12,T14,T15,T16,T17,T18,T19,T20,T21,T22,T23,T24,T25,T26,T27,T28,T29,T30,T31,T32,T33,T34,T35,T36,T37,T38,T39,T40,T41,T42,T43,T44,T45,T46,T47,T48,T49,T50,T_2XL,T_3XL,T_L,T_M,T_S,T_XL,T_XS,
STOCK,DEPOSITO,NIVEL,TALLC,DISCIPLINA,DTOESP,P_BAS,ESTADIO,COLORC,COD_TEM,COD_ANIO,MODC,LICENCIA,MARCA,LISTA,VERSION`;

async function createImport(pool, metadata, triggeredBy, userId, company) {
  const result = await pool.request()
    .input('company', sql.Int, company.ID_EMPRESA)
    .input('source', sql.NVarChar(1000), company.SOURCE_FILE)
    .input('modified', sql.DateTime2, metadata?.mtime || null)
    .input('size', sql.BigInt, metadata?.size || null)
    .input('triggeredBy', sql.VarChar(20), triggeredBy)
    .input('userId', sql.Int, userId || null)
    .query(`INSERT dbo.STOCK_IMPORTS
      (ID_EMPRESA,STATUS,SOURCE_FILE,SOURCE_MODIFIED_AT,SOURCE_SIZE_BYTES,TRIGGERED_BY,ID_USER)
      OUTPUT INSERTED.ID_IMPORT VALUES (@company,'RUNNING',@source,@modified,@size,@triggeredBy,@userId)`);
  return result.recordset[0].ID_IMPORT;
}

async function markError(pool, importId, error) {
  await pool.request()
    .input('id', sql.BigInt, importId)
    .input('message', sql.NVarChar(2000), String(error.message || error).slice(0, 2000))
    .query(`UPDATE dbo.STOCK_IMPORTS SET STATUS='ERROR',FINISHED_AT=SYSDATETIME(),ERROR_MESSAGE=@message WHERE ID_IMPORT=@id`);
}

async function importStock({ companyId, triggeredBy = 'CRON', userId = null } = {}) {
  const company = await getCompany(companyId);
  if (!company.SOURCE_FILE) throw new Error('La empresa no tiene un archivo de stock asociado');
  if (running.has(companyId)) throw new Error('Ya existe una importacion de stock en curso para esta empresa');
  running.add(companyId);
  let importId;
  let pool;
  try {
    pool = await getPool();
    importId = await createImport(pool, null, triggeredBy, userId, company);
    const metadata = await fs.stat(company.SOURCE_FILE);
    await pool.request().input('id', sql.BigInt, importId)
      .input('modified', sql.DateTime2, metadata.mtime).input('size', sql.BigInt, metadata.size)
      .query('UPDATE dbo.STOCK_IMPORTS SET SOURCE_MODIFIED_AT=@modified,SOURCE_SIZE_BYTES=@size WHERE ID_IMPORT=@id');
    const { stock: rows, prices } = splitStockPrices(await parseStockFile(company.SOURCE_FILE));
    const stockTotal = rows.reduce((total, row) => total + row.stock * row.pares, 0);

    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const request = new sql.Request(transaction);
      request.input('company', sql.Int, companyId);
      request.input('payload', sql.NVarChar(sql.MAX), JSON.stringify(rows));
      request.input('prices', sql.NVarChar(sql.MAX), JSON.stringify(prices));
      request.input('importId', sql.BigInt, importId);
      request.input('retentionDays', sql.Int, company.RETENTION_DAYS);
      request.input('rowCount', sql.Int, rows.length);
      request.input('stockTotal', sql.Decimal(19, 4), stockTotal);
      request.input('snapshotDate', sql.Date, argentinaDate());
      await request.query(`
        SET XACT_ABORT ON;
        DELETE FROM dbo.STOCK_PRICES WHERE ID_EMPRESA=@company;
        DELETE FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company;
        INSERT dbo.STOCK_CURRENT (ID_EMPRESA,${stockColumns},IMPORTED_AT,ID_IMPORT)
        SELECT @company,${stockColumns},SYSDATETIME(),@importId
        FROM OPENJSON(@payload) WITH (${openJsonColumns});

        INSERT dbo.STOCK_PRICES(ID_EMPRESA,COD_ALFA,DEPOSITO,NIVEL,LISTA,VERSION,PRECIO,P_BAS,DTOESP)
        SELECT @company,COD_ALFA,DEPOSITO,NIVEL,LISTA,VERSION,PRECIO,P_BAS,DTOESP
        FROM OPENJSON(@prices) WITH (${openJsonColumns});

        DELETE FROM dbo.STOCK_HISTORY WHERE ID_EMPRESA=@company AND SNAPSHOT_DATE=@snapshotDate;
        INSERT dbo.STOCK_HISTORY (ID_EMPRESA,SNAPSHOT_DATE,COD_ALFA,CODIGO,DEPOSITO,NIVEL,STOCK,PRECIO,P_BAS,ID_IMPORT)
        SELECT @company,@snapshotDate,COD_ALFA,CODIGO,DEPOSITO,NIVEL,STOCK,PRECIO,P_BAS,@importId
        FROM dbo.STOCK_CURRENT WHERE ID_EMPRESA=@company;

        DELETE FROM dbo.STOCK_HISTORY
        WHERE ID_EMPRESA=@company AND SNAPSHOT_DATE < DATEADD(day,1-@retentionDays,@snapshotDate);

        UPDATE dbo.STOCK_IMPORTS SET STATUS='SUCCESS',FINISHED_AT=SYSDATETIME(),
          ROW_COUNT=@rowCount,STOCK_TOTAL=@stockTotal,EXCEL_STATUS=NULL WHERE ID_IMPORT=@importId;
      `);
      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => {});
      throw error;
    }

    logger.info({ importId, rows: rows.length, stockTotal }, 'Stock actualizado');
    return { companyId, importId, rowCount: rows.length, stockTotal };
  } catch (error) {
    if (pool && importId) await markError(pool, importId, error).catch(() => {});
    logger.error({ err: error, importId }, 'Fallo la importacion de stock');
    throw error;
  } finally {
    running.delete(companyId);
  }
}

module.exports = { importStock };
