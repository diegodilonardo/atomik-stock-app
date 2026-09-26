const { sql, getPool } = require('../src/db/pool');
const { normalizeFile } = require('../src/services/company-service');

async function main() {
  const [codeArg, name, sourceArg, excelArg] = process.argv.slice(2);
  const code = String(codeArg || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,40}$/.test(code) || !name?.trim() || name.length > 150) {
    throw new Error('Uso: npm run company:save -- CODIGO "Nombre" "ruta completa del TXT" "ruta completa del Excel de salida"');
  }
  const source = normalizeFile(sourceArg);
  const excel = normalizeFile(excelArg);
  if (!/\.txt$/i.test(source) || !/\.xlsx$/i.test(excel)) throw new Error('El origen debe ser .TXT y la salida .xlsx');
  const pool = await getPool();
  try {
    await pool.request().input('code', sql.VarChar(40), code).input('name', sql.NVarChar(150), name.trim())
      .input('source', sql.NVarChar(400), source).input('excel', sql.NVarChar(400), excel)
      .query(`MERGE dbo.EMPRESAS WITH(HOLDLOCK) T USING(SELECT @code CODIGO) S ON T.CODIGO=S.CODIGO
        WHEN MATCHED THEN UPDATE SET NOMBRE=@name,SOURCE_FILE=@source,EXCEL_PATH=@excel
        WHEN NOT MATCHED THEN INSERT(CODIGO,NOMBRE,SOURCE_FILE,EXCEL_PATH) VALUES(@code,@name,@source,@excel);`);
    console.log(`Empresa ${code} configurada. Archivo asociado: ${source}`);
  } catch (error) {
    if ([2601,2627].includes(error.number)) throw new Error('El archivo de origen o el Excel de salida ya esta asociado a otra empresa');
    throw error;
  } finally { await pool.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
