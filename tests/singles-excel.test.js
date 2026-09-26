const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { configureSingles } = require('../src/services/singles-excel');

test('sueltos horizontal mantiene stock, pedido, precios variables y codigos por talle', async () => {
  const workbook = new ExcelJS.Workbook();
  const base = { ID_EMPRESA: 1, MODC: '001', COLORC: '02', DMODC: 'SOFT', DCOLORC: 'VERDE', COD_ANIO: '26', COD_TEM: '1', DEPOSITO: 7, PARES: 1, P_BAS: 120, PRECIO: 100 };
  const { refs, photos } = configureSingles(workbook, [
    { ...base, TALLC: 'M', STOCK: 4, CODIGO: '02', COD_ALFA: '000M', PRECIO: 90 },
    { ...base, TALLC: 'S', STOCK: 5, CODIGO: '01', COD_ALFA: '000S' },
    { ...base, TALLC: 'XL', STOCK: 0, CODIGO: '03', COD_ALFA: '000XL' }
  ], { NOMBRE: 'Test', PUBLIC_PRICE_FACTOR: 2 });
  assert.equal(photos.length, 1);
  assert.deepEqual(refs.map(r => [r.alfa, r.address, r.price]), [['000S', 'L5', 100], ['000M', 'M5', 90]]);
  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = reloaded.getWorksheet('SUELTOS');
  assert.equal(sheet.getCell('C2').value, 'AÑO');
  assert.equal(sheet.getCell('G2').value, 'EDAD');
  assert.equal(sheet.getCell('H2').value, 'DISCIPLINA');
  assert.equal(sheet.getCell('C3').value, '26');
  assert.equal(sheet.getCell('D3').value, 'SOFT');
  assert.equal(sheet.getCell('E3').value, 'VERDE');
  assert.ok(!sheet.model.merges.includes('D3:D7'));
  assert.equal(sheet.autoFilter, 'C2:J7');
  for (let r = 3; r <= 7; r++) {
    assert.equal(sheet.getCell(`D${r}`).value, 'SOFT');
    assert.equal(sheet.getCell(`E${r}`).value, 'VERDE');
    assert.equal(sheet.getCell(`C${r}`).value, '26');
    if (r > 3) {
      assert.notEqual(sheet.getCell(`D${r}`).numFmt, ';;;');
      assert.deepEqual(sheet.getCell(`D${r}`).font.color, sheet.getCell(`D${r}`).fill.fgColor);
    }
  }
  assert.equal(photos[0].EXCEL_IMAGE_SPAN, 5);
  assert.ok(sheet.model.merges.includes('B1:N1'));
  assert.equal(sheet.getCell('L3').value, 'S'); assert.equal(sheet.getCell('M3').value, 'M');
  assert.equal(sheet.getCell('L4').value, 5); assert.equal(sheet.getCell('M4').value, 4);
  assert.equal(sheet.getCell('L5').value, 0); assert.equal(sheet.getCell('M5').protection.locked, false);
  assert.equal(sheet.getCell('M6').value, 90); assert.equal(sheet.getCell('M7').value, 180);
  assert.match(sheet.getCell('M5').dataValidation.formulae[0], /M5<=M4/);
  assert.equal(sheet.getCell('O3').value, '01');
  assert.equal(sheet.getCell('P3').value, '000S');
  assert.equal(sheet.getCell('Q3').value, '02');
  assert.equal(sheet.getCell('R3').value, '000M');
  for (const col of ['O', 'P', 'Q', 'R']) assert.equal(sheet.getColumn(col).hidden, true);
  assert.equal(sheet.getCell('N2').value, 'SUBTOTAL');
  assert.equal(sheet.getCell('N3').formula, 'SUMPRODUCT(L5:M5,L6:M6)');
  assert.notEqual(sheet.getCell('N3').protection?.locked, false);
  assert.equal(sheet.getColumn('N').hidden, false);
  assert.equal(sheet.getCell('L3').fill.fgColor.argb, 'FFD9EAF7');
  assert.equal(sheet.getCell('L3').font.color.argb, 'FF17365D');
  assert.notDeepEqual(sheet.getCell('L3').fill, sheet.getCell('L4').fill);
  assert.notDeepEqual(sheet.getCell('L3').fill, sheet.getCell('L5').fill);
  assert.equal(sheet.sheetProtection.sheet, true);
});
