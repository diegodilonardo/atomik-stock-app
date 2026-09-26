const test = require('node:test');
const assert = require('node:assert/strict');
const { imageCandidates, findImage } = require('../src/services/product-images');
const row = { COD_ANIO: '26', COD_TEM: '2', MODC: '00345', COLORC: '01' };
test('centra fotos horizontales, verticales y cuadradas dentro de la celda sin deformar', () => {
  const ExcelJS = require('exceljs');
  const { imagePlacement } = require('../src/services/product-images');
  const sheet = new ExcelJS.Workbook().addWorksheet('Fotos');
  sheet.getColumn(2).width = 13.85546875;
  sheet.getRow(3).height = 69;
  for (const dimensions of [{ width: 1200, height: 600 }, { width: 600, height: 1200 }, { width: 800, height: 800 }]) {
    const { tl, ext } = imagePlacement(sheet, 3, dimensions);
    assert.equal(tl.nativeCol, 1); assert.equal(tl.nativeRow, 2);
    assert.ok(Math.abs(ext.width / ext.height - dimensions.width / dimensions.height) < 0.0001);
    assert.ok(ext.width <= 93.001 && ext.height <= 84.001);
    assert.ok(ext.width > 40 && ext.height > 40);
    assert.ok(Math.abs(tl.nativeColOff / 9525 * 2 + ext.width - 101) < 0.001);
    assert.ok(Math.abs(tl.nativeRowOff / 9525 * 2 + ext.height - 92) < 0.001);
  }
});
test('busca las dos variantes conservando ceros y prioriza temporada', () => {
  assert.deepEqual(imageCandidates(row), ['2620034501', '260034501']);
  assert.equal(findImage(row, new Map([['260034501.jpg', '260034501.JPG']])), '260034501.JPG');
  assert.equal(findImage(row, new Map([['2620034501.png', '2620034501.png'], ['260034501.jpg', '260034501.jpg']])), '2620034501.png');
});
test('no arma nombres incompletos ni permite rutas en los codigos', () => {
  assert.deepEqual(imageCandidates({ ...row, MODC: null }), []);
  assert.deepEqual(imageCandidates({ ...row, COLORC: '../x' }), []);
  assert.deepEqual(imageCandidates({ ...row, COD_TEM: null }), ['260034501']);
  assert.equal(findImage(row, new Map()), null);
});

test('MIDING busca modelo mas color como alternativa sin modificar Atomik', () => {
  const company = { CODIGO: '3000' };
  assert.deepEqual(imageCandidates(row, company), ['2620034501', '260034501', '0034501']);
  const index = new Map([['0034501.jpg', '0034501.JPG']]);
  assert.equal(findImage(row, index, company), '0034501.JPG');
  assert.equal(findImage(row, index, { CODIGO: '0' }), null);
  index.set('260034501.png', '260034501.png');
  assert.equal(findImage(row, index, company), '260034501.png');
  assert.deepEqual(imageCandidates({ ...row, COD_ANIO: null }, company), ['0034501']);
  assert.deepEqual(imageCandidates({ ...row, COLORC: '../x' }, company), []);
});
test('incrusta fotos en el Excel, reutiliza la imagen y conserva el nombre', async () => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { buildWorkbook } = require('../src/services/excel-service');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stock-images-'));
  try {
    await fs.writeFile(path.join(dir, '2620034501.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO7sAAAAASUVORK5CYII=', 'base64'));
    const product = { ...row, ID_EMPRESA: 1, DEPOSITO: 8, NIVEL: 950, STOCK: 1, PRECIO: 100, PARES: 1 };
    const book = await buildWorkbook({ ID_EMPRESA: 1, NOMBRE: 'Test', PUBLIC_PRICE_FACTOR: 1.85, IMAGE_DIRECTORY: dir }, [product, product, { ...product, MODC: 'MISSING' },
      { ...product, WEB_CLASSIFICATION: 'ACCIONADO', CODIGO: 'ACC-01', COD_ALFA: '0001' },
      { ...product, NIVEL: 900, CODIGO: 'SUE-01', COD_ALFA: '0002' }]);
    const sheet = book.getWorksheet('MODULOS');
    book.eachSheet(worksheet => worksheet.eachRow(row => {
      assert.ok(row.cellCount <= 24, 'El fondo no debe crear celdas hasta XFD en cada fila');
    }));
    assert.equal(sheet.getImages().length, 2);
    assert.equal(sheet.getImages()[0].imageId, sheet.getImages()[1].imageId);
    assert.equal(sheet.getCell('T3').value, '2620034501.png');
    assert.equal(sheet.getCell('B5').value, 'No Existe la Imagen');
    const ExcelJS = require('exceljs');
    const loaded = new ExcelJS.Workbook();
    await loaded.xlsx.load(await book.xlsx.writeBuffer());
    assert.equal(loaded.getWorksheet('MODULOS').getImages().length, 2);
    const profile = require('../src/services/excel-format.json');
    for (const name of ['MODULOS', 'ACCIONADO', 'RESUMEN']) {
      const actual = loaded.getWorksheet(name), expected = profile.sheets[name];
      assert.equal(actual.sheetProtection.sheet, true);
      assert.equal(actual.sheetProtection.hashValue, expected.protection.hashValue);
      for (let col = 1; col <= expected.columns.length; col++) {
        assert.equal(actual.getColumn(col).width, expected.columns[col - 1].width);
        assert.equal(actual.getColumn(col).hidden, expected.columns[col - 1].hidden);
        for (let row = 1; row <= 3; row++) {
          assert.deepEqual(actual.getCell(row, col).style, expected.rows[row - 1].styles[col - 1]);
          assert.equal(actual.getRow(row).height, expected.rows[row - 1].height);
        }
      }
    }
    assert.equal(loaded.getWorksheet('MODULOS').getCell('M3').protection.locked, false);
    const background = profile.sheets.MODULOS.rows[2].styles[2].fill;
    for (const name of ['MODULOS', 'ACCIONADO', 'SUELTOS', 'RESUMEN', 'PEDIDO']) {
      const worksheet = loaded.getWorksheet(name);
      assert.deepEqual(worksheet.getCell('Y5').fill, background);
      assert.deepEqual(worksheet.getCell('XFD100').fill, background);
    }
    for (const [name, last] of [['MODULOS', 5], ['ACCIONADO', 3]]) {
      const worksheet = loaded.getWorksheet(name);
      assert.equal(worksheet.getCell(`M${last}`).protection.locked, false);
      assert.notDeepEqual(worksheet.getCell(`M${last}`).fill, background);
      assert.deepEqual(worksheet.getCell(`M${last + 1}`).fill, background);
      assert.notEqual(worksheet.getCell(`M${last + 1}`).protection?.locked, false);
    }
    assert.notEqual(loaded.getWorksheet('MODULOS').getCell('N3').protection?.locked, false);
    assert.equal(loaded.getWorksheet('CONSOLIDADO').state, 'hidden');
    assert.match(loaded.getWorksheet('PEDIDO').getCell('A2').formula, /INDEX/);
    assert.equal(loaded.getWorksheet('PEDIDO').getColumn(4).hidden, true);
    const requested = loaded.getWorksheet('PEDIDO');
    assert.equal(requested.getCell('D2').formula, `IF(1<='CONSOLIDADO'!$E$5,MATCH(1,'CONSOLIDADO'!$F$1:$F$5,0),"")`);
    assert.equal(requested.getCell('B6').formula, `IF($D6="","",INDEX('CONSOLIDADO'!$B$1:$B$5,$D6))`);
    assert.equal(requested.getCell('C6').formula, `IF($D6="","",INDEX('CONSOLIDADO'!$C$1:$C$5,$D6))`);
    assert.equal(loaded.getWorksheet('CONSOLIDADO').getCell('E1').formula, '0+IF(C1>0,1,0)');
    assert.equal(loaded.getWorksheet('CONSOLIDADO').getCell('E5').formula, 'E4+IF(C5>0,1,0)');
    assert.equal(loaded.getWorksheet('CONSOLIDADO').getCell('F5').formula, 'IF(C5>0,E5,0)');
    assert.equal(loaded.getWorksheet('RUTA_IMAGEN'), undefined);
    assert.equal(loaded.getWorksheet('CONSOLIDADO').getCell('A5').value, 'SUE-01');
    assert.equal(loaded.getWorksheet('CONSOLIDADO').getCell('B5').value, '0002');
    assert.equal(loaded.getWorksheet('CONSOLIDADO').getCell('C5').formula, "'SUELTOS'!L5");
    assert.equal(loaded.getWorksheet('SUELTOS').getCell('L5').protection.locked, false);
    assert.match(loaded.getWorksheet('SUELTOS').getCell('L5').dataValidation.formulae[0], /L5<=L4/);
    assert.equal(loaded.getWorksheet('PEDIDO').getCell('A2').formula,
      `IF($D2="","",INDEX('CONSOLIDADO'!$A$1:$A$5,$D2))`);
    for (const [row, sheetName, sourceRow] of [[1, 'MODULOS', 3], [3, 'MODULOS', 5], [4, 'ACCIONADO', 3]]) {
      for (const [col, sourceCol] of [['A', 'K'], ['B', 'L'], ['C', 'M']]) {
        assert.equal(loaded.getWorksheet('CONSOLIDADO').getCell(`${col}${row}`).formula,
          `IF('${sheetName}'!M${sourceRow}>0,'${sheetName}'!${sourceCol}${sourceRow},0)`);
      }
    }
    for (const sheetName of ['MODULOS', 'ACCIONADO']) {
      const validation = loaded.getWorksheet(sheetName).getCell('M3').dataValidation;
      assert.equal(validation.type, 'custom');
      assert.equal(validation.errorStyle, 'stop');
      assert.equal(validation.showErrorMessage, true);
      assert.deepEqual(validation.formulae, ['AND(ISNUMBER(M3),M3=INT(M3),M3>=0,M3<=MAX(0,$N3))']);
    }
    assert.deepEqual(loaded.getWorksheet('MODULOS').getCell('M4').dataValidation.formulae, ['AND(ISNUMBER(M4),M4=INT(M4),M4>=0,M4<=MAX(0,$N4))']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

