const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildWorkbook } = require('../src/services/excel-service');

test('ACCIONADO se omite sin productos y resumen y pedido conservan referencias validas', async () => {
  const company = { ID_EMPRESA: 1, NOMBRE: 'Test', PUBLIC_PRICE_FACTOR: 1.85 };
  const row = { ID_EMPRESA: 1, NIVEL: 950, CODIGO: '001', COD_ALFA: '26001', DMODC: 'Modelo',
    DCOLORC: 'Azul', STOCK: 5, PARES: 12, PRECIO: 120, TALLC: '40', WEB_CLASSIFICATION: 'MODULOS' };
  for (const rows of [[], [row], [row, { ...row, NIVEL: 900, COD_ALFA: '26002' }]]) {
    const book = await buildWorkbook(company, rows, ['model', 'public', 'license']);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await book.xlsx.writeBuffer());
    assert.equal(loaded.getWorksheet('ACCIONADO'), undefined);
    const summary = loaded.getWorksheet('RESUMEN');
    assert.equal(summary.getRow(7).hidden, true);
    for (const col of ['D', 'E', 'F', 'G']) assert.equal(summary.getCell(`${col}7`).value, 0);
    assert.equal(summary.getCell('G9').formula, 'SUM(G6:G8)');
    for (const sheet of loaded.worksheets) sheet.eachRow(r => r.eachCell(cell => {
      if (cell.formula) assert.doesNotMatch(cell.formula, /ACCIONADO|#REF!/);
    }));
    if (rows.length) assert.match(loaded.getWorksheet('PEDIDO').getCell('A2').formula, /CONSOLIDADO/);
  }
  const populated = await buildWorkbook(company, [{ ...row, WEB_CLASSIFICATION: 'ACCIONADO' }]);
  assert.ok(populated.getWorksheet('ACCIONADO'));
  assert.equal(Boolean(populated.getWorksheet('RESUMEN').getRow(7).hidden), false);
  assert.match(populated.getWorksheet('RESUMEN').getCell('G7').formula, /ACCIONADO/);
});
