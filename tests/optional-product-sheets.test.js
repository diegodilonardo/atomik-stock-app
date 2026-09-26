const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildWorkbook } = require('../src/services/excel-service');

test('solo exporta solapas con productos y ajusta resumen y referencias en todas las combinaciones', async () => {
  const company = { ID_EMPRESA: 1, NOMBRE: 'Test', PUBLIC_PRICE_FACTOR: 1.85 };
  const names = ['MODULOS', 'ACCIONADO', 'SUELTOS'];
  for (let mask = 0; mask < 8; mask++) {
    const rows = names.flatMap((name, i) => mask & (1 << i) ? [{
      ID_EMPRESA: 1, NIVEL: i === 2 ? 900 : 950, WEB_CLASSIFICATION: name,
      CODIGO: String(i), COD_ALFA: `26${i}`, DMODC: 'Modelo', DCOLORC: 'Azul',
      STOCK: 4, PARES: 1, PRECIO: 100, TALLC: '40'
    }] : []);
    const book = await buildWorkbook(company, rows, ['model', 'public', 'license']);
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await book.xlsx.writeBuffer());
    const absent = names.filter((name, i) => !(mask & (1 << i)));
    names.forEach((name, i) => {
      assert.equal(Boolean(loaded.getWorksheet(name)), !absent.includes(name));
      assert.equal(Boolean(loaded.getWorksheet('RESUMEN').getRow(i + 6).hidden), absent.includes(name));
    });
    assert.ok(loaded.getWorksheet('PEDIDO'));
    assert.equal(loaded.getWorksheet('RESUMEN').getCell('G9').formula, 'SUM(G6:G8)');
    loaded.worksheets.forEach(sheet => sheet.eachRow(row => row.eachCell(cell => {
      if (!cell.formula) return;
      assert.ok(!cell.formula.includes('#REF!'));
      for (const name of absent) assert.ok(!cell.formula.includes(name), cell.formula);
    })));
  }
  const noStock = await buildWorkbook(company, [{ ID_EMPRESA: 1, NIVEL: 900, STOCK: 0 }]);
  assert.equal(noStock.getWorksheet('SUELTOS'), undefined);
});
