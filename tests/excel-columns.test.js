const test=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {buildWorkbook}=require('../src/services/excel-service');
const {normalizeRules}=require('../src/services/stock-rules');
test('seleccion de columnas conserva formulas, bloqueos y pedidos en todas las solapas',async()=>{
 const company={ID_EMPRESA:1,NOMBRE:'Test',PUBLIC_PRICE_FACTOR:1.85};
 const row={ID_EMPRESA:1,NIVEL:950,CODIGO:'001',COD_ALFA:'A01',COD_ANIO:'26',MODC:'01',COLORC:'02',DMODC:'Modelo',DCOLORC:'Azul',STOCK:5,PARES:1,PRECIO:100,P_BAS:90,MARCA:'Marca',LICENCIA:'Licencia',TALLC:'40',WEB_CLASSIFICATION:'MODULOS'};
 const rows=[row,{...row,COD_ALFA:'A02',WEB_CLASSIFICATION:'ACCIONADO'},{...row,NIVEL:900,COD_ALFA:'A03',WEB_CLASSIFICATION:'SUELTOS'}];
 const original=await buildWorkbook(company,rows);
 const book=await buildWorkbook({...company,IMAGE_DIRECTORY:'Z:\\inexistente'},rows,['model','color','base','brand','license']);
 const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
 for(const name of ['MODULOS','ACCIONADO','SUELTOS']){
  const sheet=loaded.getWorksheet(name);
  assert.equal(sheet.getColumn(2).hidden,true);assert.equal(sheet.getColumn(4).hidden,false);
  assert.equal(sheet.getImages().length,0);
  for(const label of ['PRECIO BASE','MARCA','LICENCIA']) assert.ok(sheet.getRow(2).values.includes(label));
  assert.equal(sheet.sheetProtection.sheet,true);
 }
 const sheet=loaded.getWorksheet('MODULOS');
 assert.equal(sheet.getColumn(11).hidden,true);assert.equal(sheet.getColumn(12).hidden,true);
 assert.equal(sheet.getCell('M3').protection.locked,false);
 assert.deepEqual(sheet.getCell('M3').dataValidation,original.getWorksheet('MODULOS').getCell('M3').dataValidation);
 assert.equal(sheet.getCell('R3').formula,original.getWorksheet('MODULOS').getCell('R3').formula);
 assert.equal(loaded.getWorksheet('PEDIDO').getCell('A2').formula,original.getWorksheet('PEDIDO').getCell('A2').formula);
 assert.equal(loaded.getWorksheet('SUELTOS').getCell('L5').protection.locked,false);
 assert.equal(normalizeRules({excelColumns:['brand','model']},true).excelColumns.length,2);
 assert.throws(()=>normalizeRules({excelColumns:['codigo']},true),/invalidas/);
});
