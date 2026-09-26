const HELP = `Exportar grillas guardadas con el stock vigente.

  node scripts/export-grid.js --empresa 0 --listar
  node scripts/export-grid.js --empresa 0 --id 7
  node scripts/export-grid.js --empresa 0 --nombre "Nombre de la grilla" --salida "C:\\Grillas\\grilla.xlsx"
  node scripts/export-grid.js --empresa 0 --todas

--id o --nombre: selecciona una grilla activa de esa empresa.
--salida: ruta completa .xlsx; si se omite, usa el destino guardado de la grilla.
--todas: exporta todas las grillas activas; todas deben tener destino guardado.
Reemplaza el archivo de destino. No importa stock ni cambia la programacion diaria.
No requiere que el servidor web este iniciado. Usa la conexion de .env.
`;

function parseArgs(args) {
  const options = {};
  const flags = new Set(['--listar', '--todas', '--help']);
  const values = new Set(['--empresa', '--id', '--nombre', '--salida']);
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if ((!flags.has(key) && !values.has(key)) || key in options) throw new Error(`Opcion invalida o repetida: ${key}`);
    if (flags.has(key)) options[key] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Falta el valor de ${key}`);
      options[key] = value;
    }
  }
  if (options['--help']) return options;
  if (!options['--empresa']) throw new Error('Indique --empresa');
  if (['--listar', '--todas', '--id', '--nombre'].filter(k => options[k]).length !== 1) throw new Error('Elija --listar, --todas, --id o --nombre');
  if (options['--salida'] && (options['--listar'] || options['--todas'])) throw new Error('--salida requiere --id o --nombre');
  if (options['--id'] && (!/^\d+$/.test(options['--id']) || Number(options['--id']) < 1 || Number(options['--id']) > 2147483647)) throw new Error('ID invalido');
  return options;
}

async function main(args = process.argv.slice(2)) {
  if (!args.length) { console.log(HELP); return; }
  const options = parseArgs(args);
  if (options['--help']) { console.log(HELP); return; }
  const { sql, getPool } = require('../src/db/pool');
  const { getCompanyByCode, getCompany, normalizeFile } = require('../src/services/company-service');
  const { getGrid } = require('../src/services/grid-service');
  const { queryStock } = require('../src/services/stock-rules');
  const { withCompanyLock } = require('../src/services/daily-job');
  const { replaceSharedExcel } = require('../src/services/excel-service');
  const pool = await getPool();
  try {
    const company = await getCompanyByCode(options['--empresa']);
    const grids = (await pool.request().input('company', sql.Int, company.ID_EMPRESA)
      .query('SELECT ID_GRID,NAME,EXPORT_PATH FROM dbo.STOCK_GRIDS WHERE ID_EMPRESA=@company AND ACTIVE=1 ORDER BY NAME')).recordset;
    if (options['--listar']) { console.table(grids); return; }
    const selected = grids.filter(grid => options['--todas'] || (options['--id'] ? grid.ID_GRID === Number(options['--id']) : grid.NAME.toLocaleLowerCase() === options['--nombre'].toLocaleLowerCase()));
    if (!selected.length) throw new Error('No se encontraron grillas activas para esa seleccion');
    if (!options['--todas'] && selected.length !== 1) throw new Error('Nombre ambiguo; seleccione la grilla por --id');
    const destinations = new Set();
    for (const grid of selected) {
      const value = options['--salida'] || grid.EXPORT_PATH;
      if (!value) throw new Error(`La grilla "${grid.NAME}" no tiene destino guardado. Indique --salida o configure su programacion.`);
      grid.destination = normalizeFile(value);
      if (!/\.xlsx$/i.test(grid.destination)) throw new Error('La salida debe terminar en .xlsx');
      if (destinations.has(grid.destination.toLowerCase())) throw new Error('Hay grillas con el mismo destino; configure archivos distintos');
      destinations.add(grid.destination.toLowerCase());
    }
    let failures = 0;
    for (const grid of selected) {
      try {
        console.log(`Generando ${grid.NAME}...`);
        await withCompanyLock(company.ID_EMPRESA, async () => {
          const current = await getGrid(company.ID_EMPRESA, grid.ID_GRID);
          const currentCompany = await getCompany(company.ID_EMPRESA);
          const { data } = await queryStock(currentCompany, current.rules);
          await replaceSharedExcel({ ...currentCompany, EXCEL_PATH: grid.destination }, data, current.rules.excelColumns);
        });
        console.log(`Exportada: ${grid.destination}`);
      } catch (error) { failures++; console.error(`${grid.NAME}: ${error.message}`); }
    }
    if (failures) throw new Error(`${failures} exportacion(es) no se completaron`);
  } finally { await pool.close(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parseArgs, main };
