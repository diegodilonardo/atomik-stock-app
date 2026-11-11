const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMaster, validateSelection, CATEGORIES } = require('../src/services/fashion-master');
const { buildFashionWorkbook } = require('../src/services/fashion-excel');

function dbf(rows) {
  const fields = [['CODIGO',8],['COD_ALFA',15],['COD_AÑO',2],['COD_TEM',1],['DMODC',20],['DCOLORC',20],['PRECIO',15],['PARES',2],['STOCK',12]];
  const header = 33 + fields.length * 32, size = 1 + fields.reduce((s,f)=>s+f[1],0);
  const buffer = Buffer.alloc(header + size * rows.length,32);
  buffer[0]=3;buffer.writeUInt32LE(rows.length,4);buffer.writeUInt16LE(header,8);buffer.writeUInt16LE(size,10);
  fields.forEach(([name,length],i)=>{const p=32+i*32;buffer.fill(0,p,p+32);buffer.write(name,p,'latin1');buffer[p+11]=67;buffer[p+16]=length;});
  buffer[header-1]=13;
  rows.forEach((row,i)=>{let offset=header+i*size+1;fields.forEach(([name,length])=>{buffer.write(String(row[name]??'').padEnd(length),offset,length,'latin1');offset+=length;});});
  return buffer;
}
const source={CODIGO:'001',COD_ALFA:'27ABC', 'COD_AÑO':'27',COD_TEM:'2',DMODC:'Modelo',DCOLORC:'Negro',PRECIO:'0.0000',PARES:'12'};
test('DBI conserva códigos y precios cero; valida archivos y duplicados',()=>{
  const data=dbf([source]);const [p]=parseMaster(data);
  assert.equal(p.CODIGO,'001');assert.equal(p.COD_ANIO,'27');assert.equal(p.PRECIO,0);
  assert.throws(()=>parseMaster(data.subarray(0,data.length-1)),/incompleto/);
  assert.throws(()=>parseMaster(dbf([source,source])),/duplicado/);
  assert.throws(()=>parseMaster(dbf([{...source,PRECIO:'error'}])),/precio/);
  const deleted=Buffer.from(data);deleted[deleted.readUInt16LE(8)]=42;assert.equal(parseMaster(deleted).length,0);
});
test('asignaciones válidas requieren filtros, categorías y productos existentes',()=>{
  const products=parseMaster(dbf([source]));const valid={name:'Moda',filters:{years:['27'],seasons:['2']},items:[{id:products[0].id,category:'DAMA'}]};
  assert.equal(validateSelection(valid,products).items.length,1);
  assert.equal(validateSelection({...valid,filters:{years:['26'],seasons:['1']}},products).items.length,1);
  assert.equal(validateSelection({...valid,filters:{years:[],seasons:[]}},products).items.length,1);
  assert.throws(()=>validateSelection({...valid,items:[{id:'missing',category:'DAMA'}]},products),/ya no/);
  assert.throws(()=>validateSelection({...valid,items:[{id:products[0].id,category:'OTRO'}]},products),/Categoría/);
  assert.throws(()=>validateSelection({...valid,items:[...valid.items,...valid.items]},products),/repetido/);
});
test('Excel de moda contiene solo categorías con productos, precios por par y códigos y stock opcional',async()=>{
  const products=parseMaster(dbf([source,{...source,CODIGO:'002',COD_ALFA:'27DEF',PRECIO:'1500.2500'}]));
  const selection={name:'Moda verano',filters:{years:['27'],seasons:['2']},items:products.map((p,i)=>({id:p.id,category:i?'HOMBRE':'DAMA'}))};
  const priced=require('../src/services/fashion-prices').applyFashionPrices(products,{PUBLIC_PRICE_FACTOR:1.85},[]);
  const previousPassword=process.env.FASHION_EXCEL_PASSWORD;
  process.env.FASHION_EXCEL_PASSWORD='fashion-test-key';
  let workbook;
  try { workbook=await buildFashionWorkbook({},selection,priced); }
  finally {
    if(previousPassword===undefined) delete process.env.FASHION_EXCEL_PASSWORD;
    else process.env.FASHION_EXCEL_PASSWORD=previousPassword;
  }
  assert.deepEqual(workbook.worksheets.filter(s=>s.state==='visible').map(s=>s.name),['HOMBRE','DAMA','RESUMEN','PEDIDO']);
  assert.equal(workbook.getWorksheet('DAMA').getCell('L3').value,0);
  assert.equal(workbook.getWorksheet('HOMBRE').getCell('L3').value,1500.25/12);
  assert.equal(workbook.getWorksheet('HOMBRE').getCell('M3').value,231.2885);
  assert.equal(workbook.getWorksheet('DAMA').getCell('M3').value,0);
  assert.equal(workbook.getWorksheet('HOMBRE').getCell('O3').value.formula,'ROUND(L3*K3*N3,2)');
  for(const category of ['HOMBRE','DAMA']){const sheet=workbook.getWorksheet(category);assert.equal(sheet.getColumn(17).hidden,false);assert.equal(sheet.getColumn(16).hidden,false);assert.ok(sheet.getRow(2).values.includes('STOCK'));}
  assert.equal(workbook.getWorksheet('KIDS'),undefined);
  const loaded=new (require('exceljs').Workbook)();await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.equal(loaded.getWorksheet('DAMA').getCell('P3').value,'001');
  const order=loaded.getWorksheet('PEDIDO'), consolidated=loaded.getWorksheet('CONSOLIDADO_MODA');
  assert.deepEqual(order.getRow(1).values.slice(1),['CODIGO','COD_ALFA','CANTIDAD']);
  assert.equal(order.getColumn(4).hidden,true);
  assert.equal(consolidated.state,'veryHidden');
  assert.equal(consolidated.getCell('A1').formula,"'HOMBRE'!P3");
  assert.equal(consolidated.getCell('B2').formula,"'DAMA'!Q3");
  assert.equal(consolidated.getCell('C2').formula,"'DAMA'!N3");
  assert.equal(consolidated.getCell('D2').formula,'D1+IF(C2>0,1,0)');
  assert.equal(consolidated.getCell('E2').formula,'IF(C2>0,D2,0)');
  assert.equal(order.getCell('D2').formula,`IF(1<='CONSOLIDADO_MODA'!$D$2,MATCH(1,'CONSOLIDADO_MODA'!$E$1:$E$2,0),"")`);
  assert.equal(order.getCell('C2').formula,`IF($D2="","",INDEX('CONSOLIDADO_MODA'!$C$1:$C$2,$D2))`);
  for(const sheet of loaded.worksheets) {
    assert.equal(sheet.sheetProtection.sheet,true);
    assert.ok(sheet.sheetProtection.hashValue);
    const protection=sheet.sheetProtection;
    assert.equal(require('exceljs/lib/utils/encryptor').convertPasswordToHash('fashion-test-key',
      protection.algorithmName.replace('-',''),protection.saltValue,protection.spinCount),protection.hashValue);
    assert.equal(sheet.sheetProtection.objects,false);
    sheet.eachRow((row,r)=>row.eachCell((cell,c)=>{
      if(cell.protection?.locked===false) assert.ok(['DAMA','HOMBRE'].includes(sheet.name) && r===3 && c===14);
    }));
  }
  assert.equal(loaded.getWorksheet('DAMA').getCell('N3').protection.locked,false);
  assert.notEqual(loaded.getWorksheet('DAMA').getCell('L3').protection?.locked,false);
  assert.notEqual(loaded.getWorksheet('DAMA').getCell('M3').protection?.locked,false);
  assert.notEqual(loaded.getWorksheet('DAMA').getCell('O3').protection?.locked,false);
  const summary=loaded.getWorksheet('RESUMEN');
  assert.equal(summary.getCell('C6').value,'HOMBRE');
  assert.equal(summary.getCell('F6').formula,"SUMPRODUCT('HOMBRE'!K3:K3,'HOMBRE'!N3:N3)");
  assert.equal(summary.getCell('G6').formula,"SUM('HOMBRE'!O3:O3)");
  assert.equal(summary.getCell('G9').value,null);
  assert.equal(summary.getCell('G8').formula,'SUM(G6:G7)');
  for(const category of ['HOMBRE','DAMA']) {
    const sheet=loaded.getWorksheet(category);
    for(const address of ['B2','F3','M3','N3']) for(const side of ['top','bottom','left','right']) {
      assert.equal(sheet.getCell(address).border[side].style,'thin');
    }
  }
  for(const side of ['top','bottom','left','right']) assert.equal(summary.getCell('G8').border[side].style,'thin');
  const profile=require('../src/services/excel-format.json');
  assert.deepEqual(workbook.getWorksheet('DAMA').getCell('B2').fill,profile.sheets.MODULOS.rows[1].styles[1].fill);
  assert.deepEqual(workbook.getWorksheet('DAMA').getCell('N3').fill,profile.sheets.MODULOS.rows[2].styles[12].fill);
  assert.deepEqual(workbook.getWorksheet('RESUMEN').getCell('G8').fill,profile.sheets.RESUMEN.rows[8].styles[6].fill);
});

test('guarda y exporta productos de años y temporadas diferentes a los filtros actuales',async()=>{
  const products=parseMaster(dbf([source,{...source,CODIGO:'002',COD_ALFA:'26DEF','COD_AÑO':'26',COD_TEM:'1'}]));
  const selection={name:'Grilla mixta',filters:{years:['27'],seasons:['2']},
    items:products.map(p=>({id:p.id,category:'DAMA'}))};
  const saved=JSON.parse(JSON.stringify(validateSelection(selection,products)));
  assert.equal(saved.items.length,2);
  const priced=require('../src/services/fashion-prices').applyFashionPrices(products,{PUBLIC_PRICE_FACTOR:1.85},[]);
  const book=await buildFashionWorkbook({},saved,priced);
  const sheet=book.getWorksheet('DAMA');
  assert.deepEqual([sheet.getCell('C3').value,sheet.getCell('C4').value],['26','27']);
  assert.deepEqual([sheet.getCell('P3').value,sheet.getCell('P4').value],['002','001']);
  assert.equal(book.getWorksheet('RESUMEN').getCell('G6').formula,"SUM('DAMA'!O3:O4)");
  assert.equal(book.getWorksheet('CONSOLIDADO_MODA').getCell('C2').formula,"'DAMA'!N4");
});

test('lee STOCK del DBI como número y diferencia cero de dato ausente',()=>{
  assert.equal(parseMaster(dbf([{...source,STOCK:'125'}]))[0].STOCK,125);
  assert.equal(parseMaster(dbf([{...source,STOCK:0}]))[0].STOCK,0);
  assert.equal(parseMaster(dbf([source]))[0].STOCK,null);
  assert.throws(()=>parseMaster(dbf([{...source,STOCK:'error'}])),/stock inválido/);
});
