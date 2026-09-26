const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

test('aislamiento multiempresa con SQL Server y API real', { skip: process.env.MULTIEMPRESA_TEST_SQL !== '1', timeout: 120000 }, async () => {
  const config = require('../src/config/env');
  const { sql, getPool, connectionConfig } = require('../src/db/pool');
  const db = `GESTION_TEST_${crypto.randomBytes(6).toString('hex')}`;
  const master = await new sql.ConnectionPool(connectionConfig('master')).connect();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gestion-test-'));
  let pool, server, created = false;
  try {
    await master.request().query(`CREATE DATABASE [${db}]`);
    created = true;
    config.database.database = db;
    pool = await getPool();
    const schema = await fs.readFile(path.join(__dirname, '../sql/001_schema.sql'), 'utf8');
    const migration = await fs.readFile(path.join(__dirname, '../sql/002_multiempresa.sql'), 'utf8');
    await pool.request().batch(schema);
    await pool.request().query("INSERT dbo.USERS(USERNAME,FULL_NAME,PASSWORD_HASH,ROLE) VALUES('LEGACY','Legacy','unused','CONSULTA')");
    for (let repeat = 0; repeat < 2; repeat++) {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        for (const batch of migration.split(/^GO\s*$/mi)) if (batch.trim()) await new sql.Request(transaction).batch(batch);
        await transaction.commit();
      } catch (error) { await transaction.rollback().catch(() => {}); throw error; }
    }
    assert.equal((await pool.request().query("SELECT E.CODIGO FROM dbo.USERS U JOIN dbo.EMPRESAS E ON E.ID_EMPRESA=U.ID_EMPRESA WHERE U.USERNAME='LEGACY'")).recordset[0].CODIGO, '0');
    const imagesMigration = await fs.readFile(path.join(__dirname, '../sql/003_product_images.sql'), 'utf8');
    await pool.request().batch(imagesMigration);
    await pool.request().batch(imagesMigration);
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/004_optional_stock_fields.sql'), 'utf8'));
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/005_saved_grids.sql'), 'utf8'));
    const scheduleMigration = await fs.readFile(path.join(__dirname, '../sql/006_grid_schedule.sql'), 'utf8');
    for (let repeat = 0; repeat < 2; repeat++) for (const batch of scheduleMigration.split(/^GO\s*$/mi)) if (batch.trim()) await pool.request().batch(batch);
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/007_licenses.sql'), 'utf8'));
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/008_stock_brand.sql'), 'utf8'));
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/009_price_lists.sql'), 'utf8'));
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/010_unique_usernames.sql'), 'utf8'));
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/011_superadmin.sql'), 'utf8'));
    const codeMigration = await fs.readFile(path.join(__dirname, '../sql/012_atomik_company_code.sql'), 'utf8');
    await pool.request().query("UPDATE dbo.EMPRESAS SET CODIGO='ATOMIK' WHERE CODIGO='0'");
    await pool.request().batch(codeMigration);
    await pool.request().batch(codeMigration);
    assert.equal((await pool.request().query("SELECT E.CODIGO FROM dbo.USERS U JOIN dbo.EMPRESAS E ON E.ID_EMPRESA=U.ID_EMPRESA WHERE U.USERNAME='LEGACY'")).recordset[0].CODIGO, '0');
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/013_cross_company_actors.sql'), 'utf8'));
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/013_cross_company_actors.sql'), 'utf8'));
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/014_price_factors.sql'), 'utf8'));
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/015_factor_dimensions.sql'), 'utf8'));
    await pool.request().batch(await fs.readFile(path.join(__dirname, '../sql/016_factor_lists.sql'), 'utf8'));
    const { FIELDS } = require('../src/services/stock-parser');
    const line = (stock, name, overrides = {}) => {
      const row = Object.fromEntries(FIELDS.map(field => [field, '0']));
      Object.assign(row, { rubro: 'CALZADO', cod_alfa: 'SAME-SKU', codigo: '123', dmodc: name,
        dcolorc: 'AZUL', pares: '1', precio: '100', stock: String(stock), deposito: '8', nivel: '950', tallc: '40',
        licencia: name === 'TEST_A' ? 'SAN LORENZO' : '', edad: '', sexo: '', det_linea: '', dtallc: '',
        rubro: name === 'TEST_A' ? 'CALZADO' : 'INDUMENTARIA', cod_anio: name === 'TEST_A' ? '26' : '27', cod_tem: name === 'TEST_A' ? '1' : '2', ...overrides });
      return FIELDS.map(field => row[field]).join('|');
    };
    const bcrypt = require('bcryptjs');
    const password = crypto.randomBytes(18).toString('hex');
    const hash = await bcrypt.hash(password, 4);
    const companies = [];
    for (const [code, stock] of [['TEST_A', 10], ['TEST_B', 20]]) {
      const source = path.join(directory, `${code}.txt`), excel = path.join(directory, `${code}.xlsx`);
      await fs.writeFile(source, line(stock, code), 'latin1');
      const result = await pool.request().input('code', sql.VarChar(40), code)
        .input('source', sql.NVarChar(400), source).input('excel', sql.NVarChar(400), excel)
        .query('INSERT dbo.EMPRESAS(CODIGO,NOMBRE,SOURCE_FILE,EXCEL_PATH) OUTPUT INSERTED.* VALUES(@code,@code,@source,@excel)');
      const company = result.recordset[0];
      const user = await pool.request().input('id', sql.Int, company.ID_EMPRESA).input('hash', sql.VarChar(255), hash).input('username', sql.VarChar(80), code)
        .query("INSERT dbo.USERS(ID_EMPRESA,USERNAME,FULL_NAME,PASSWORD_HASH,ROLE) OUTPUT INSERTED.ID_USER VALUES(@id,@username,'Test',@hash,'ADMIN')");
      company.userId = user.recordset[0].ID_USER;
      companies.push(company);
    }
    const [a, b] = companies;
    const { runDailyJob, withCompanyLock } = require('../src/services/daily-job');
    await fs.writeFile(a.EXCEL_PATH, 'EXCEL EXISTENTE');
    await pool.request().input('b', sql.Int, b.ID_EMPRESA).query("UPDATE dbo.EMPRESAS SET EXCEL_PATH=NULL,IMAGE_DIRECTORY='Z:\\carpeta-inexistente' WHERE ID_EMPRESA=@b");
    await runDailyJob(a.ID_EMPRESA, 'MANUAL', a.userId);
    await runDailyJob(b.ID_EMPRESA, 'MANUAL', b.userId);
    assert.equal(await fs.readFile(a.EXCEL_PATH, 'utf8'), 'EXCEL EXISTENTE');
    await assert.rejects(fs.access(b.EXCEL_PATH), { code: 'ENOENT' });
    assert.equal((await pool.request().query('SELECT COUNT(*) AS N FROM dbo.STOCK_IMPORTS WHERE EXCEL_STATUS IS NOT NULL')).recordset[0].N, 0);
    await pool.request().input('b', sql.Int, b.ID_EMPRESA).input('excel', sql.NVarChar(400), b.EXCEL_PATH)
      .query('UPDATE dbo.EMPRESAS SET EXCEL_PATH=@excel,IMAGE_DIRECTORY=NULL WHERE ID_EMPRESA=@b');
    await withCompanyLock(a.ID_EMPRESA, async () => {
      await assert.rejects(runDailyJob(a.ID_EMPRESA), /en curso/);
    });
    const { createApp } = require('../src/app');
    server = createApp().listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    async function api(route, cookie, method = 'GET', body) {
      const response = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = response.status === 204 ? null : await response.json();
      return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    const loginA = await api('/api/auth/login', null, 'POST', { username: a.CODIGO, password });
    const loginB = await api('/api/auth/login', null, 'POST', { username: b.CODIGO, password });
    assert.equal(loginA.status, 200); assert.equal(loginB.status, 200);
    assert.equal(loginA.data.user.companyId, a.ID_EMPRESA);
    assert.equal(loginB.data.user.companyId, b.ID_EMPRESA);
    for (const filter of ['year=99', 'season=99', 'rubro=INEXISTENTE', 'license=INEXISTENTE', 'brand=INEXISTENTE']) {
      const filtered = await api('/api/stock/summary?' + filter, loginA.cookie);
      assert.equal(filtered.status, 200);
      assert.equal(filtered.data.stock.ROWS_COUNT, 0);
    }
    const matchingSummary = await api('/api/stock/summary?year=26&rubro=CALZADO&license=SAN%20LORENZO', loginA.cookie);
    assert.equal(matchingSummary.data.stock.ROWS_COUNT, 1);
    const spoofedCompany = await api('/api/auth/login', null, 'POST', { username: a.CODIGO.toLowerCase(), password, company: b.CODIGO, companyId: b.ID_EMPRESA });
    assert.equal(spoofedCompany.status, 200);
    assert.equal(spoofedCompany.data.user.companyId, a.ID_EMPRESA);
    const ca = loginA.cookie, cb = loginB.cookie;
    assert.equal((await api('/api/users', cb, 'POST', { username: a.CODIGO, fullName: 'Duplicado', password, role: 'CONSULTA' })).status, 409);
    assert.equal((await api('/api/stock?level=950', ca)).data.total, 1);
    assert.equal((await api('/api/stock?level=900', ca)).data.total, 0);
    assert.equal((await api('/api/stock?level=999', ca)).status, 400);
    assert.equal((await api('/api/stock/summary', ca)).data.stock.MODULE_STOCK, 10);
    assert.deepEqual((await api('/api/stock/filters', ca)).data, { brands: ['Sin marca'], priceLists: [], licenses: ['SAN LORENZO'], rubros: ['CALZADO'], years: ['26'], seasons: ['1'] });
    assert.deepEqual((await api('/api/stock/filters', cb)).data, { brands: ['Sin marca'], priceLists: [], licenses: ['Sin licencia'], rubros: ['INDUMENTARIA'], years: ['27'], seasons: ['2'] });
    for (const query of ['brand=Sin%20marca', 'license=SAN%20LORENZO', 'rubro=CALZADO', 'year=26', 'season=1', 'rubro=CALZADO&year=26&season=1&type=MODULOS&search=TEST_A']) {
      assert.equal((await api('/api/stock?' + query, ca)).data.total, 1);
    }
    for (const query of ['brand=OTRA', 'license=Sin%20licencia', 'license=OTRA', 'rubro=INDUMENTARIA', 'year=27', 'season=2', 'rubro=CALZADO&year=26&season=2', 'year=26&type=SUELTOS', "rubro='OR%201=1--"]) {
      assert.equal((await api('/api/stock?' + query, ca)).data.total, 0);
    }
    assert.equal((await api('/api/auth/login', null, 'POST', { company: 'UNKNOWN', username: 'ADMIN', password })).status, 401);
    for (const search of ['26 TEST_A azul', 'azul, test_a; 26', '2026 test_a AZÚL', 'SAME-SKU azul']) {
      assert.equal((await api('/api/stock?search=' + encodeURIComponent(search), ca)).data.total, 1);
    }
    for (const search of ['27 TEST_A azul', '26 TEST_A rojo', 'TEST%A', 'TEST[A', 'TEST~A']) {
      assert.equal((await api('/api/stock?search=' + encodeURIComponent(search), ca)).data.total, 0);
    }
    const jwt = require('jsonwebtoken');
    const legacy = jwt.sign({ id: a.userId, role: 'ADMIN' }, config.jwt.secret || 'test-secret');
    assert.equal((await api('/api/stock', `atomik_session=${legacy}`)).status, 401);
    for (const [cookie, stock, name] of [[ca, 10, 'TEST_A'], [cb, 20, 'TEST_B']]) {
      const result = await api('/api/stock?companyId=999', cookie);
      assert.equal(result.status, 200); assert.equal(result.data.total, 1);
      assert.equal(result.data.data[0].STOCK, stock); assert.equal(result.data.data[0].DMODC, name);
      assert.equal((await api('/api/stock/summary', cookie)).data.stock.STOCK_TOTAL, stock);
      assert.equal((await api('/api/users', cookie)).data.data.length, 1);
      assert.equal((await api('/api/imports', cookie)).data.data.length, 1);
    }
    assert.equal((await api(`/api/users/${b.userId}`, ca, 'PATCH', { active: false })).status, 404);
    const replacement = crypto.randomBytes(18).toString('hex');
    const changePassword = { password: replacement, confirmation: replacement };
    assert.equal((await api(`/api/users/${b.userId}/password`, ca, 'PUT', changePassword)).status, 404);
    assert.equal((await api(`/api/users/${a.userId}/password`, ca, 'PUT', { password: 'short', confirmation: 'short' })).status, 400);
    assert.equal((await api(`/api/users/${a.userId}/password`, ca, 'PUT', { ...changePassword, confirmation: 'different' })).status, 400);
    assert.equal((await api(`/api/users/${a.userId}/password`, ca, 'PUT', changePassword)).status, 200);
    assert.equal((await api('/api/auth/login', null, 'POST', { username: a.CODIGO, password })).status, 401);
    assert.equal((await api('/api/auth/login', null, 'POST', { username: a.CODIGO, password: replacement })).status, 200);
    assert.equal((await api(`/api/users/${a.userId}/password`, ca, 'PUT', { password, confirmation: password })).status, 200);
    for (const [price, pairs, expected] of [[80,2,true], [100,2,false], [120,2,false], [80,0,false]]) {
      await pool.request().input('company', sql.Int, a.ID_EMPRESA).input('price', sql.Decimal(19,4), price).input('pairs', sql.Int, pairs)
        .query('UPDATE dbo.STOCK_CURRENT SET PRECIO=@price,P_BAS=100,PARES=@pairs WHERE ID_EMPRESA=@company');
      const row = (await api('/api/stock', ca)).data.data[0];
      assert.equal(row.POSSIBLE_ACTIONED, expected);
      assert.equal((await api('/api/stock?actioned=possible', ca)).data.total, expected ? 1 : 0);
      assert.equal((await api('/api/stock?actioned=confirmed', ca)).data.total, 0);
      assert.equal(row.PRICE_BASE, pairs ? 50 : null);
      const totals = (await api('/api/stock/summary', ca)).data.stock;
      assert.equal(totals.STOCK_TOTAL, row.STOCK * pairs);
      assert.equal(totals.MODULE_STOCK, row.STOCK);
      assert.equal(row.PRICE_WHOLESALE, pairs ? price / pairs : null);
      assert.equal(row.CLASSIFICATION, 'MODULOS');
    }
    await pool.request().input('company', sql.Int, a.ID_EMPRESA)
      .query('UPDATE dbo.STOCK_CURRENT SET PRECIO=100,P_BAS=0,PARES=1 WHERE ID_EMPRESA=@company');
    assert.equal((await api('/api/auth/me', cb)).status, 200);
    assert.equal((await api('/api/stock/classification', ca, 'PATCH', { codAlfas: ['SAME-SKU'], classification: 'ACCIONADO', companyId: b.ID_EMPRESA })).status, 200);
    assert.equal((await api('/api/stock', ca)).data.data[0].CLASSIFICATION, 'ACCIONADO');
    assert.equal((await api('/api/stock?actioned=confirmed', ca)).data.total, 1);
    assert.equal((await api('/api/stock?actioned=unconfirmed', ca)).data.total, 0);
    assert.equal((await api('/api/stock?actioned=confirmed', cb)).data.total, 0);
    assert.equal((await api('/api/stock', cb)).data.data[0].CLASSIFICATION, 'MODULOS');
    assert.equal((await api('/api/company', ca)).data.SOURCE_FILE, a.SOURCE_FILE);
    assert.equal((await api('/api/company', ca, 'PUT', { sourceFile: b.SOURCE_FILE.toUpperCase(), excelPath: a.EXCEL_PATH, publicPriceFactor: 2, retentionDays: 30 })).status, 409);
    assert.equal((await api('/api/company', ca, 'PUT', { sourceFile: a.SOURCE_FILE, excelPath: b.EXCEL_PATH.toUpperCase(), publicPriceFactor: 2, retentionDays: 30 })).status, 409);
    assert.equal((await api('/api/company', ca, 'PUT', { sourceFile: a.SOURCE_FILE, excelPath: a.EXCEL_PATH, publicPriceFactor: 2, retentionDays: 30, companyId: b.ID_EMPRESA })).status, 200);
    assert.equal((await api('/api/company', cb)).data.PUBLIC_PRICE_FACTOR, 1.85);
    // A company can configure its coefficient before defining an export destination.
    assert.equal((await api('/api/company', cb, 'PUT', { sourceFile: b.SOURCE_FILE, excelPath: '', publicPriceFactor: 2.25, retentionDays: 30 })).status, 200);
    assert.equal((await api('/api/company', cb)).data.EXCEL_PATH, null);
    assert.equal((await api('/api/company', ca)).data.PUBLIC_PRICE_FACTOR, 2);
    assert.equal((await api('/api/stock', cb)).data.data[0].PRICE_PUBLIC, (await api('/api/stock', cb)).data.data[0].PRICE_WHOLESALE * 2.25);
    assert.equal((await api('/api/company', cb, 'PUT', { sourceFile: b.SOURCE_FILE, excelPath: b.EXCEL_PATH, publicPriceFactor: 1.85, retentionDays: 30 })).status, 200);
    const ExcelJS = require('exceljs');
    for (const [cookie, name, stock] of [[ca, 'TEST_A', 10], [cb, 'TEST_B', 20]]) {
      const response = await fetch(url + '/api/export/download', { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await response.arrayBuffer()));
      const sheet = book.getWorksheet(name === 'TEST_A' ? 'ACCIONADO' : 'MODULOS');
      assert.equal(sheet.getCell('D3').value, name); assert.equal(sheet.getCell('N3').value, stock);
      assert.ok(sheet.getCell('B1').value.includes(name));
    }
    await fs.writeFile(a.SOURCE_FILE, line(30, 'TEST_A'), 'latin1');
    assert.equal((await api('/api/imports/run', ca, 'POST')).status, 200);
    assert.equal((await api('/api/stock/summary', cb)).data.stock.STOCK_TOTAL, 20);
    assert.equal((await api('/api/stock/summary', ca)).data.stock.STOCK_TOTAL, 30);
    await fs.writeFile(a.SOURCE_FILE, 'INVALID');
    assert.equal((await api('/api/imports/run', ca, 'POST')).status, 500);
    assert.equal((await api('/api/stock/summary', ca)).data.stock.STOCK_TOTAL, 30);
    const history = await pool.request().input('b', sql.Int, b.ID_EMPRESA).query('SELECT STOCK FROM dbo.STOCK_HISTORY WHERE ID_EMPRESA=@b');
    assert.equal(history.recordset[0].STOCK, 20);
    const installer = (await fs.readFile(path.join(__dirname, '../sql/000_create_atomik_stock.sql'), 'utf8')).replaceAll('GESTION_STOCK', db);
    for (const batch of installer.split(/^GO\s*$/mi)) if (batch.trim()) await pool.request().batch(batch);
    assert.equal((await api('/api/stock/summary', ca)).data.stock.STOCK_TOTAL, 30);
    await assert.rejects(pool.request().input('a', sql.Int, a.ID_EMPRESA).input('userB', sql.Int, 2147483647)
      .query("INSERT dbo.CLASSIFICATION_AUDIT(ID_EMPRESA,COD_ALFA,NEW_CLASSIFICATION,ID_USER) VALUES(@a,'X','MODULOS',@userB)"), /FOREIGN KEY/);
    await pool.request().input('b', sql.Int, b.ID_EMPRESA).query('UPDATE dbo.STOCK_CURRENT SET NIVEL=900,DEPOSITO=7 WHERE ID_EMPRESA=@b');
    const singles = await api('/api/stock?level=900&type=SUELTOS', cb);
    assert.equal(singles.data.total, 1);
    assert.equal(singles.data.data[0].CLASSIFICATION, 'SUELTOS');
    assert.equal((await api('/api/stock?level=950', cb)).data.total, 0);
    const singleSummary = (await api('/api/stock/summary', cb)).data.stock;
    assert.equal(singleSummary.SINGLE_STOCK, 20);
    assert.equal(singleSummary.MODULE_STOCK, 0);
    const singleResponse = await fetch(url + '/api/export/download', { headers: { Cookie: cb } });
    const singleBook = new ExcelJS.Workbook();
    await singleBook.xlsx.load(Buffer.from(await singleResponse.arrayBuffer()));
    assert.match(singleBook.getWorksheet('SUELTOS').getCell('D3').value, /TEST_B/);
    assert.equal(singleBook.getWorksheet('MODULOS'), undefined);
    // Saved grids store rules, share the same filter engine as Excel, and isolate companies.
    await fs.writeFile(a.SOURCE_FILE, [line(30, 'TEST_A'),
      line(0, 'TEST_A', { cod_alfa: 'NO-STOCK', cod_anio: '25' }),
      line(5, 'TEST_A', { cod_alfa: 'CLOTHING', rubro: 'INDUMENTARIA', cod_anio: '27', cod_tem: '2', nivel: '900' })].join('\n'), 'latin1');
    await runDailyJob(a.ID_EMPRESA, 'MANUAL', a.userId);
    assert.equal((await api('/api/stock?rubro=CALZADO&rubro=INDUMENTARIA&year=26&year=27&level=900&level=950&positiveStock=true', ca)).data.total, 2);
    assert.equal((await api('/api/stock?rubro=CALZADO&positiveStock=true', ca)).data.total, 1);
    assert.equal((await api('/api/stock?rubro=CALZADO', ca)).data.total, 2);
    assert.equal((await api('/api/stock?positiveStock=maybe', ca)).status, 400);
    assert.equal((await api('/api/stock?rubro=CALZADO&page=3', ca)).data.total, 2);
    const rule = { excelColumns: ['model','color'], rubro: ['CALZADO'], year: [], season: [], level: ['950'], positiveStock: true };
    const createdGrid = await api('/api/grids', ca, 'POST', { name: 'Calzado con stock', rules: rule });
    assert.equal(createdGrid.status, 201);
    const grid = createdGrid.data;
    assert.equal((await api('/api/grids', ca)).data.data.length, 1);
    assert.equal((await api('/api/grids', cb)).data.data.length, 0);
    assert.equal((await api(`/api/grids/${grid.ID_GRID}`, cb)).status, 404);
    assert.equal((await api(`/api/stock?gridId=${grid.ID_GRID}`, cb)).status, 404);
    assert.equal((await fetch(url + `/api/export/download?gridId=${grid.ID_GRID}`, { headers: { Cookie: cb } })).status, 404);
    assert.equal((await api(`/api/grids/${grid.ID_GRID}`, cb, 'PUT', { name: 'Otro', rules: rule, version: grid.VERSION })).status, 404);
    assert.equal((await api('/api/grids', ca, 'POST', { name: 'Calzado con stock', rules: rule })).status, 409);
    assert.equal((await api('/api/grids', ca, 'POST', { name: 'Regla invalida', rules: { sql: '1=1' } })).status, 400);
    const view = await api(`/api/stock?gridId=${grid.ID_GRID}`, ca);
    assert.equal(view.data.total, 1); assert.equal(view.data.data[0].COD_ALFA, 'SAME-SKU');
    const response = await fetch(url + `/api/export/download?gridId=${grid.ID_GRID}`, { headers: { Cookie: ca } });
    assert.equal(response.status, 200);
    const gridBook = new ExcelJS.Workbook(); await gridBook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    assert.equal(grid.rules.excelColumns.length, 2);
    assert.equal(gridBook.getWorksheet('ACCIONADO').getColumn(3).hidden, true);
    assert.equal(gridBook.getWorksheet('ACCIONADO').getCell('L3').value, 'SAME-SKU');
    assert.equal(gridBook.getWorksheet('MODULOS'), undefined);
    assert.equal(gridBook.getWorksheet('SUELTOS'), undefined);
    // Existing sessions immediately lose mutation privileges when changed to CONSULTA.
    await pool.request().input('id', sql.Int, a.userId).query("UPDATE dbo.USERS SET ROLE='CONSULTA' WHERE ID_USER=@id");
    assert.equal((await api('/api/grids', ca)).status, 200);
    assert.equal((await api('/api/grids', ca, 'POST', { name: 'Denied', rules: rule })).status, 403);
    assert.equal((await api(`/api/grids/${grid.ID_GRID}`, ca, 'PUT', { name: 'Denied', rules: rule, version: 1 })).status, 403);
    assert.equal((await api(`/api/grids/${grid.ID_GRID}`, ca, 'DELETE', { version: 1 })).status, 403);
    assert.equal((await fetch(url + `/api/export/download?gridId=${grid.ID_GRID}`, { headers: { Cookie: ca } })).status, 200);
    await pool.request().input('id', sql.Int, a.userId).query("UPDATE dbo.USERS SET ROLE='ADMIN' WHERE ID_USER=@id");
    const edited = await api(`/api/grids/${grid.ID_GRID}`, ca, 'PUT', { name: 'Indumentaria con stock', rules: { rubro: ['INDUMENTARIA'], positiveStock: true }, version: 1 });
    assert.equal(edited.status, 200); assert.equal(edited.data.VERSION, 2);
    assert.equal((await api(`/api/grids/${grid.ID_GRID}`, ca, 'PUT', { name: 'Vieja', rules: rule, version: 1 })).status, 409);
    assert.equal((await api(`/api/stock?gridId=${grid.ID_GRID}`, ca)).data.data[0].COD_ALFA, 'CLOTHING');
    // A reimport updates grid results without changing saved rules.
    await fs.writeFile(a.SOURCE_FILE, line(0, 'TEST_A', { cod_alfa: 'CLOTHING', rubro: 'INDUMENTARIA' }), 'latin1');
    await runDailyJob(a.ID_EMPRESA, 'MANUAL', a.userId);
    assert.equal((await api(`/api/stock?gridId=${grid.ID_GRID}`, ca)).data.total, 0);
    assert.equal((await api(`/api/grids/${grid.ID_GRID}`, ca, 'DELETE', { version: 1 })).status, 409);
    assert.equal((await api(`/api/grids/${grid.ID_GRID}`, ca, 'DELETE', { version: 2 })).status, 204);
    assert.equal((await api(`/api/grids/${grid.ID_GRID}`, ca)).status, 404);
    assert.equal((await api(`/api/stock?gridId=${grid.ID_GRID}`, ca)).status, 404);
    assert.equal((await fetch(url + `/api/export/download?gridId=${grid.ID_GRID}`, { headers: { Cookie: ca } })).status, 404);
    assert.equal((await api('/api/grids', ca)).data.data.length, 0);
    const scheduled = (await api('/api/grids', ca, 'POST', { name: 'Diaria', rules: { rubro: ['CALZADO'], excelColumns: ['model','color'] } })).data;
    const output = path.join(directory, 'scheduled.xlsx');
    const scheduleBody = { enabled: true, time: '08:00', path: output, version: scheduled.VERSION };
    assert.equal((await api(`/api/grids/${scheduled.ID_GRID}/schedule`, cb, 'PUT', scheduleBody)).status, 404);
    assert.equal((await api(`/api/grids/${scheduled.ID_GRID}/schedule`, ca, 'PUT', { ...scheduleBody, time: '25:00' })).status, 400);
    assert.equal((await api(`/api/grids/${scheduled.ID_GRID}/schedule`, ca, 'PUT', scheduleBody)).status, 200);
    assert.equal((await api(`/api/grids/${scheduled.ID_GRID}/schedule`, ca, 'PUT', scheduleBody)).status, 409);
    const duplicate = (await api('/api/grids', ca, 'POST', { name: 'Duplicada', rules: {} })).data;
    assert.equal((await api(`/api/grids/${duplicate.ID_GRID}/schedule`, ca, 'PUT', { ...scheduleBody, version: duplicate.VERSION })).status, 409);
    const { runScheduledExports } = require('../src/services/grid-scheduler');
    await runScheduledExports(new Date('2030-01-01T10:59:00Z'));
    await assert.rejects(fs.access(output));
    await runScheduledExports(new Date('2030-01-01T11:00:00Z'));
    const firstExport = await fs.stat(output);
    const scheduledBook = new ExcelJS.Workbook(); await scheduledBook.xlsx.readFile(output);
    assert.equal(scheduledBook.getWorksheet('MODULOS'), undefined);
    assert.equal(scheduledBook.getWorksheet('ACCIONADO'), undefined);
    assert.equal(scheduledBook.getWorksheet('SUELTOS'), undefined);
    assert.ok(scheduledBook.getWorksheet('RESUMEN'));
    assert.equal((await api(`/api/grids/${scheduled.ID_GRID}`, ca)).data.EXPORT_STATUS, 'SUCCESS');
    await runScheduledExports(new Date('2030-01-01T12:00:00Z'));
    assert.equal((await fs.stat(output)).mtimeMs, firstExport.mtimeMs);
    assert.equal((await api(`/api/grids/${scheduled.ID_GRID}`, ca, 'DELETE', { version: 2 })).status, 204);
    await runScheduledExports(new Date('2030-01-02T12:00:00Z'));
    assert.equal((await fs.stat(output)).mtimeMs, firstExport.mtimeMs);
    // One inventory, two independently priced grids and exports.
    const priceLine = (price, list, version, stock = 10) => {
      const values = line(stock, 'TEST_B', { deposito: '21', precio: String(price), p_bas: '100', pares: '2' }).split('|');
      return [...values.slice(0, 75), values[78], ...values.slice(75, 78), 'MARCA', list, version].join('|');
    };
    await fs.writeFile(b.SOURCE_FILE, [priceLine(120, '93', '17'), priceLine(80, '94', '12')].join('\n'), 'latin1');
    const importedLists = await runDailyJob(b.ID_EMPRESA, 'MANUAL', b.userId);
    assert.equal(importedLists.rowCount, 1);
    assert.equal(importedLists.stockTotal, 20);
    assert.equal((await api('/api/stock/summary', cb)).data.stock.STOCK_TOTAL, 20);
    assert.equal((await api('/api/stock/filters', cb)).data.priceLists.length, 2);
    assert.equal((await api('/api/stock', cb)).status, 400);
    assert.equal((await api('/api/grids', cb, 'POST', { name: 'Sin lista', rules: {} })).status, 400);
    for (const [list, version, price, possible] of [['93', '17', 60, false], ['94', '12', 40, true]]) {
      const priceList = JSON.stringify([list, version]);
      const saved = await api('/api/grids', cb, 'POST', { name: `Lista ${list}`, rules: { priceList } });
      assert.equal(saved.status, 201);
      assert.equal(saved.data.rules.priceList, priceList);
      const result = await api(`/api/stock?gridId=${saved.data.ID_GRID}`, cb);
      assert.equal(result.data.total, 1);
      assert.equal(result.data.data[0].STOCK, 10);
      assert.equal(result.data.data[0].PRICE_WHOLESALE, price);
      assert.equal(result.data.data[0].POSSIBLE_ACTIONED, possible);
      const response = await fetch(url + `/api/export/download?gridId=${saved.data.ID_GRID}`, { headers: { Cookie: cb } });
      assert.equal(response.status, 200);
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
      assert.equal(workbook.getWorksheet('MODULOS').getCell('P3').value, price);
      assert.equal((await api('/api/stock?priceList=' + encodeURIComponent(priceList), ca)).status, 400);
    }
    await fs.writeFile(b.SOURCE_FILE, [priceLine(120, '93', '17'), priceLine(80, '94', '12', 11)].join('\n'), 'latin1');
    await assert.rejects(runDailyJob(b.ID_EMPRESA, 'MANUAL', b.userId), /incompatibles/);
    assert.equal((await api('/api/stock/summary', cb)).data.stock.STOCK_TOTAL, 20);
    await fs.writeFile(b.SOURCE_FILE, priceLine(120, '93', '18'), 'latin1');
    await runDailyJob(b.ID_EMPRESA, 'MANUAL', b.userId);
    assert.equal((await api('/api/stock?priceList=' + encodeURIComponent('["93","17"]'), cb)).status, 400);
    assert.equal((await api('/api/stock/filters', cb)).data.priceLists.length, 1);
    // Superadmin manages accounts across companies, but stock stays scoped.
    const newUser = { username: 'MIDING_USER', fullName: 'Usuario de otra empresa', password, role: 'ADMIN', companyId: b.ID_EMPRESA };
    assert.equal((await api('/api/users', ca, 'POST', newUser)).status, 403);
    assert.equal((await api('/api/users', ca, 'POST', { ...newUser, isSuperAdmin: true })).status, 403);
    assert.equal((await api('/api/users/companies', ca)).data.data.length, 1);
    await pool.request().input('id', sql.Int, a.userId).query('UPDATE dbo.USERS SET IS_SUPERADMIN=1 WHERE ID_USER=@id');
    assert.equal((await api('/api/auth/me', ca)).data.user.isSuperAdmin, true);
    const switched = await api(`/api/auth/me?viewCompanyId=${b.ID_EMPRESA}`, ca);
    assert.equal(switched.data.user.companyId, b.ID_EMPRESA);
    assert.equal(switched.data.user.homeCompanyId, a.ID_EMPRESA);
    assert.equal(switched.data.user.role, 'ADMIN');
    assert.equal((await api(`/api/stock?viewCompanyId=${b.ID_EMPRESA}`, ca)).data.data[0].ID_EMPRESA, b.ID_EMPRESA);
    assert.equal((await api(`/api/grids?viewCompanyId=${b.ID_EMPRESA}`, ca)).status, 200);
    assert.equal((await api(`/api/stock?viewCompanyId=${a.ID_EMPRESA}`, cb)).status, 403);
    assert.equal((await api(`/api/imports/run?viewCompanyId=${b.ID_EMPRESA}`, ca, 'POST', {})).status, 200);
    const companyQuery = `?viewCompanyId=${b.ID_EMPRESA}`;
    const foreignGrid = await api('/api/grids' + companyQuery, ca, 'POST', { name: 'Grilla superadmin', rules: {} });
    assert.equal(foreignGrid.status, 201);
    assert.equal(foreignGrid.data.ID_EMPRESA, b.ID_EMPRESA);
    assert.equal(foreignGrid.data.CREATED_BY, a.userId);
    assert.equal((await api(`/api/grids/${foreignGrid.data.ID_GRID}`, ca)).status, 404);
    assert.equal((await api(`/api/grids/${foreignGrid.data.ID_GRID}${companyQuery}`, ca, 'PUT', { name: 'Grilla editada', rules: {}, version: 1 })).status, 200);
    assert.equal((await api(`/api/grids/${foreignGrid.data.ID_GRID}/schedule${companyQuery}`, ca, 'PUT', { enabled: false, time: '09:00', path: path.join(directory, 'superadmin.xlsx'), version: 2 })).status, 200);
    assert.equal((await api('/api/stock/classification' + companyQuery, ca, 'PATCH', { codAlfas: ['SAME-SKU'], classification: 'ACCIONADO' })).status, 200);
    const actor = await pool.request().input('company', sql.Int, b.ID_EMPRESA).query('SELECT TOP 1 ID_USER FROM dbo.CLASSIFICATION_AUDIT WHERE ID_EMPRESA=@company ORDER BY ID_AUDIT DESC');
    assert.equal(actor.recordset[0].ID_USER, a.userId);
    assert.equal((await api(`/api/grids/${foreignGrid.data.ID_GRID}${companyQuery}`, ca, 'DELETE', { version: 3 })).status, 204);
    assert.equal((await api('/api/auth/companies', ca)).status, 200);
    assert.ok((await api('/api/users/companies', ca)).data.data.some(company => company.ID_EMPRESA === b.ID_EMPRESA));
    assert.equal((await api('/api/users', ca, 'POST', newUser)).status, 201);
    const newLogin = await api('/api/auth/login', null, 'POST', { username: newUser.username, password });
    assert.equal(newLogin.data.user.companyId, b.ID_EMPRESA);
    assert.equal(newLogin.data.user.isSuperAdmin, false);
    assert.equal((await api('/api/users', ca, 'POST', { ...newUser, username: 'INVALID_COMPANY', companyId: 2147483647 })).status, 400);
    assert.equal((await api('/api/users', ca, 'POST', { ...newUser, username: 'NO_SUPER_GRANT', isSuperAdmin: true })).status, 403);
    assert.ok((await api('/api/users', ca)).data.data.some(user => user.ID_USER === b.userId));
    assert.equal((await api(`/api/users/${newLogin.data.user.id}`, ca, 'PATCH', { active: false })).status, 200);
    assert.equal((await api('/api/auth/me', newLogin.cookie)).status, 401);
    assert.equal((await api(`/api/users/${a.userId}`, ca, 'PATCH', { role: 'CONSULTA' })).status, 404);
    assert.equal((await api(`/api/users/${b.userId}/password`, ca, 'PUT', { password, confirmation: password })).status, 200);
    assert.equal((await api(`/api/users/${a.userId}/password`, cb, 'PUT', { password, confirmation: password })).status, 404);
    assert.equal((await api('/api/stock', ca)).status, 200); // A still sees only its own stock (no list required).
    const editable = (await api('/api/users', ca)).data.data.find(user => user.USERNAME === 'MIDING_USER');
    assert.equal((await api(`/api/users/${editable.ID_USER}`, ca, 'PATCH', { active: true })).status, 200);
    const edit = { username: 'MIDING_EDITED', fullName: 'Nombre editado', role: 'CONSULTA', companyId: a.ID_EMPRESA };
    const priorSession = (await api('/api/auth/login', null, 'POST', { username: 'MIDING_USER', password })).cookie;
    assert.equal((await api(`/api/users/${editable.ID_USER}`, cb, 'PUT', edit)).status, 403);
    assert.equal((await api(`/api/users/${editable.ID_USER}`, ca, 'PUT', { ...edit, username: a.CODIGO })).status, 409);
    assert.equal((await api(`/api/users/${editable.ID_USER}`, ca, 'PUT', edit)).status, 200);
    const editedUser = (await api('/api/users', ca)).data.data.find(user => user.ID_USER === editable.ID_USER);
    assert.equal(editedUser.FULL_NAME, edit.fullName);
    assert.equal(editedUser.ID_EMPRESA, a.ID_EMPRESA);
    assert.equal(editedUser.ROLE, 'CONSULTA');
    assert.ok(priorSession);
    assert.equal((await api('/api/auth/me', priorSession)).status, 401);
    assert.equal((await api('/api/auth/login', null, 'POST', { username: edit.username, password })).status, 200);
    assert.equal((await api(`/api/users/${a.userId}`, ca, 'PUT', { ...edit, role: 'ADMIN' })).status, 404);
    await pool.request().input('id', sql.Int, a.userId).query('UPDATE dbo.USERS SET IS_SUPERADMIN=0 WHERE ID_USER=@id');
    assert.equal((await api('/api/auth/me', ca)).data.user.isSuperAdmin, false);
    assert.equal((await api(`/api/stock?viewCompanyId=${b.ID_EMPRESA}`, ca)).status, 403);
    assert.equal((await api(`/api/users/${b.userId}/password`, ca, 'PUT', { password, confirmation: password })).status, 404);
    const factorConfig = { sourceFile: b.SOURCE_FILE, excelPath: b.EXCEL_PATH, publicPriceFactor: 1.85, retentionDays: 30,
      priceFactors: [{ brand: 'MARCA', level: 950, factor: 2.1 }, { brand: 'MARCA', level: 900, factor: 3.2 }] };
    const otherPrice = (await api('/api/stock', ca)).data.data[0].PRICE_PUBLIC;
    assert.equal((await api('/api/company', cb, 'PUT', factorConfig)).status, 200);
    assert.equal((await api('/api/company', cb)).data.priceFactors.length, 2);
    assert.equal((await api('/api/stock', cb)).data.data[0].PRICE_PUBLIC, 126);
    const combination = (await api('/api/company', cb)).data.combinations[0];
    const exact = { brand: combination.MARCA, license: combination.LICENCIA, rubro: combination.RUBRO, specific: true, level: 950, factor: 2.5 };
    assert.equal((await api('/api/company', cb, 'PUT', { ...factorConfig, priceFactors: [...factorConfig.priceFactors, exact] })).status, 200);
    assert.equal((await api('/api/stock', cb)).data.data[0].PRICE_PUBLIC, 150);
    assert.equal((await api('/api/company', cb, 'PUT', { ...factorConfig, priceFactors: [...factorConfig.priceFactors, exact, exact] })).status, 400);
    assert.equal((await api('/api/stock', cb)).data.data[0].PRICE_PUBLIC, 150);
    assert.equal((await api('/api/company', cb, 'PUT', { ...factorConfig, priceFactors: [...factorConfig.priceFactors, { ...exact, license: 'OTRA LICENCIA' }] })).status, 200);
    assert.equal((await api('/api/stock', cb)).data.data[0].PRICE_PUBLIC, 126);
    assert.equal((await api('/api/company', cb, 'PUT', { ...factorConfig, priceFactors: [...factorConfig.priceFactors, { ...exact, rubro: 'OTRO RUBRO' }] })).status, 200);
    assert.equal((await api('/api/stock', cb)).data.data[0].PRICE_PUBLIC, 126);
    assert.equal((await api('/api/company', cb, 'PUT', factorConfig)).status, 200);
    const listRule = { ...exact, list: '93', factor: 2.8 };
    assert.equal((await api('/api/company', cb, 'PUT', { ...factorConfig, priceFactors: [...factorConfig.priceFactors, listRule] })).status, 200);
    assert.equal((await api('/api/stock', cb)).data.data[0].PRICE_PUBLIC, 168);
    assert.ok((await api('/api/company', cb)).data.priceLists.includes('93'));
    assert.equal((await api('/api/company', cb, 'PUT', { ...factorConfig, priceFactors: [...factorConfig.priceFactors, { ...listRule, list: '94' }] })).status, 200);
    assert.equal((await api('/api/stock', cb)).data.data[0].PRICE_PUBLIC, 126);
    assert.equal((await api('/api/company', cb, 'PUT', factorConfig)).status, 200);
    const moduleResponse = await fetch(url + '/api/export/download', { headers: { Cookie: cb } });
    assert.equal(moduleResponse.status, 200);
    const factorBook = new ExcelJS.Workbook(); await factorBook.xlsx.load(Buffer.from(await moduleResponse.arrayBuffer()));
    assert.equal(factorBook.getWorksheet('ACCIONADO').getCell('Q3').value, 126);
    await pool.request().input('b', sql.Int, b.ID_EMPRESA).query('UPDATE dbo.STOCK_CURRENT SET NIVEL=900 WHERE ID_EMPRESA=@b; UPDATE dbo.STOCK_PRICES SET NIVEL=900 WHERE ID_EMPRESA=@b');
    assert.equal((await api('/api/stock', cb)).data.data[0].PRICE_PUBLIC, 192);
    const looseResponse = await fetch(url + '/api/export/download', { headers: { Cookie: cb } });
    assert.equal(looseResponse.status, 200);
    const looseBook = new ExcelJS.Workbook(); await looseBook.xlsx.load(Buffer.from(await looseResponse.arrayBuffer()));
    assert.equal(looseBook.getWorksheet('SUELTOS').getCell('J3').value, 192);
    assert.equal((await api('/api/stock', ca)).data.data[0].PRICE_PUBLIC, otherPrice);
    assert.equal((await api('/api/company', cb, 'PUT', { ...factorConfig, priceFactors: [{ brand: 'MARCA', level: 900, factor: -1 }] })).status, 400);
    assert.equal((await api('/api/stock', cb)).data.data[0].PRICE_PUBLIC, 192);
    assert.equal((await api('/api/company', cb, 'PUT', { ...factorConfig, priceFactors: [{ brand: 'OTRA', level: 900, factor: 4 }] })).status, 200);
    assert.equal((await api('/api/stock', cb)).data.data[0].PRICE_PUBLIC, 111);
    await pool.request().input('b', sql.Int, b.ID_EMPRESA).query('UPDATE dbo.EMPRESAS SET ACTIVE=0 WHERE ID_EMPRESA=@b');
    assert.equal((await api('/api/stock', cb)).status, 401);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (pool) await pool.close();
    if (created && /^GESTION_TEST_[0-9a-f]{12}$/.test(db)) await master.request().query(`ALTER DATABASE [${db}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${db}]`);
    await master.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
