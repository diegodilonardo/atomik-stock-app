const test=require('node:test');
const assert=require('node:assert/strict');
const ExcelJS=require('exceljs');
const {buildFashionWorkbook}=require('../src/services/fashion-excel');
const {normalize,defaults}=require('../public/js/fashion-columns');
const {applyFashionLayout}=require('../src/services/fashion-layout');
const product={id:'one',CODIGO:'000001',COD_ALFA:'27ABC',COD_ANIO:'27',COD_TEM:'2',DMODC:'Modelo',DCOLORC:'Negro',
  PARES:12,PRICE_WHOLESALE:100,PRICE_PUBLIC:185};
const selection={name:'Orden de columnas',filters:{years:['27'],seasons:['2']},items:[{id:'one',category:'DAMA'}]};

test('valida campos y exige Pedido sin modificar las grillas antiguas',()=>{
  assert.deepEqual(normalize(undefined),defaults);
  for(const columns of [[],['model'],['order','order'],['order','unknown'],null])assert.throws(()=>normalize(columns),/Columnas inválidas/);
});

test('campos reordenados conservan importes, resumen, códigos, bordes y protección',async()=>{
  const columns=['order','model','subtotal','wholesale'];
  // No se consulta la carpeta cuando Imagen está oculta.
  const book=await buildFashionWorkbook({IMAGE_DIRECTORY:'Z:\\ruta-inexistente'}, {...selection,columns},[product]);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
  const sheet=loaded.getWorksheet('DAMA');
  assert.deepEqual([2,3,4,5].map(c=>sheet.getCell(2,c).value),['PEDIDO','MODELO','SUBTOTAL','PRECIO MAYORISTA']);
  const location=key=>{
    const all=[...columns,...defaults.filter(k=>!columns.includes(k))];return sheet.getColumn(all.indexOf(key)+2).letter;
  };
  const pairs=location('pairs'),code=location('code'),alpha=location('alpha');
  assert.equal(sheet.getCell('D3').formula,`ROUND(E3*${pairs}3*B3,2)`);
  assert.equal(sheet.getCell('D4').formula,'SUM(D3:D3)');
  assert.equal(sheet.getCell('B4').formula,'SUM(B3:B3)');
  assert.equal(sheet.getCell(`${code}3`).value,'000001');
  assert.equal(sheet.getColumn(code).hidden,true);
  assert.equal(sheet.getCell('B3').protection.locked,false);
  assert.equal(sheet.getCell('B3').dataValidation.type,'whole');
  sheet.eachRow((row,r)=>row.eachCell((cell,c)=>{if(cell.protection?.locked===false)assert.ok(r===3&&c===2);}));
  assert.equal(sheet.sheetProtection.sheet,true);
  assert.equal(sheet.getCell('D3').border.left.style,'thin');
  assert.equal(sheet.autoFilter,'B2:E3');
  assert.equal(sheet.pageSetup.printArea,'B1:E4');
  const summary=loaded.getWorksheet('RESUMEN');
  assert.equal(summary.getCell('F6').formula,`SUMPRODUCT('DAMA'!${pairs}3:${pairs}3,'DAMA'!B3:B3)`);
  assert.equal(summary.getCell('G6').formula,"SUM('DAMA'!D3:D3)");
  const consolidated=loaded.getWorksheet('CONSOLIDADO_MODA');
  assert.equal(consolidated.getCell('A1').formula,`'DAMA'!${code}3`);
  assert.equal(consolidated.getCell('B1').formula,`'DAMA'!${alpha}3`);
  assert.equal(consolidated.getCell('C1').formula,"'DAMA'!B3");
  assert.equal(loaded.getWorksheet('HOMBRE'),undefined);
});

test('permite solo Pedido y mueve las fotos con su columna sin cambiar tamaño',async()=>{
  const minimal=await buildFashionWorkbook({}, {...selection,columns:['order']},[product]);
  assert.equal(minimal.getWorksheet('DAMA').getCell('B3').protection.locked,false);
  assert.equal(minimal.getWorksheet('DAMA').pageSetup.printArea,'B1:B4');
  const book=await buildFashionWorkbook({},selection,[product]);
  const sheet=book.getWorksheet('DAMA');
  const id=book.addImage({buffer:Buffer.from('unused'),extension:'png'});
  sheet.addImage(id,{tl:{nativeCol:1,nativeRow:2,nativeColOff:95250,nativeRowOff:95250},ext:{width:80,height:60}});
  applyFashionLayout(book,['model','order','image','subtotal'],{DISCIPLINA:0,HOMBRE:0,DAMA:1,KIDS:0,SUELTOS:0,ACCESORIOS:0});
  const photo=sheet.getImages()[0];
  assert.equal(photo.range.tl.nativeCol,3);
  assert.equal(photo.range.tl.nativeColOff,95250);
  assert.deepEqual(photo.range.ext,{width:80,height:60});
});

test('nueva categoría participa en resumen y pedido con columnas personalizadas',async()=>{
  const category='SUELTOS';
  const book=await buildFashionWorkbook({}, {...selection,columns:['order','model','subtotal'],
    items:[{id:product.id,category}]},[product]);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
  const sheet=loaded.getWorksheet(category), summary=loaded.getWorksheet('RESUMEN');
  assert.equal(sheet.getCell('C3').value,'Modelo');
  assert.equal(sheet.getCell('B3').protection.locked,false);
  assert.equal(sheet.sheetProtection.sheet,true);
  assert.equal(summary.getCell('C6').value,category);
  assert.equal(summary.getCell('G6').formula,"SUM('SUELTOS'!D3:D3)");
  assert.equal(summary.getCell('G7').formula,'SUM(G6:G6)');
  assert.equal(summary.getCell('C7').value,'TOTAL');
  assert.equal(summary.pageSetup.printArea,'C2:H7');
  assert.equal(loaded.getWorksheet('CONSOLIDADO_MODA').getCell('C1').formula,"'SUELTOS'!B3");
  assert.equal(loaded.getWorksheet('PEDIDO').sheetProtection.sheet,true);
});

test('ordena cada solapa por modelo, color y curva con números naturales',async()=>{
  const products=[
    {...product,id:'a',DMODC:'Zeta',DCOLORC:'Azul',DTALLC:'2'},
    {...product,id:'b',DMODC:'Alfa',DCOLORC:'Negro',DTALLC:'2'},
    {...product,id:'c',DMODC:'Alfa',DCOLORC:'Azul',DTALLC:'10'},
    {...product,id:'d',DMODC:'Alfa',DCOLORC:'Azul',DTALLC:'2'}
  ].map(p=>({...p,CODIGO:p.id}));
  const book=await buildFashionWorkbook({}, {...selection,items:products.map(p=>({id:p.id,category:'DAMA'}))},products);
  const sheet=book.getWorksheet('DAMA');
  assert.deepEqual([3,4,5,6].map(r=>sheet.getCell(r,16).value),['d','c','b','a']);
});

test('orden personalizado se valida, persiste y aplica en el Excel',async()=>{
  const {normalize,create}=require('../public/js/fashion-sort');
  const {validateSelection}=require('../src/services/fashion-master');
  assert.equal(normalize(undefined),null);
  assert.throws(()=>normalize([{field:'model',direction:'asc'},{field:'model',direction:'desc'}]),/inválido/);
  assert.throws(()=>normalize([{field:'unknown',direction:'asc'}]),/inválido/);
  const sort=[{field:'category',direction:'asc'},{field:'color',direction:'desc'},{field:'curve',direction:'asc'},{field:'model',direction:'asc'}];
  const products=[
    {...product,id:'a',CODIGO:'a',DMODC:'Alfa',DCOLORC:'Azul',DTALLC:'10'},
    {...product,id:'b',CODIGO:'b',DMODC:'Zeta',DCOLORC:'Negro',DTALLC:'2'},
    {...product,id:'c',CODIGO:'c',DMODC:'Beta',DCOLORC:'Azul',DTALLC:'2'}
  ];
  const input={...selection,sort,items:products.map(p=>({id:p.id,category:'DAMA'}))};
  const saved=JSON.parse(JSON.stringify(validateSelection(input,products)));
  assert.deepEqual(saved.sort,sort);
  const book=await buildFashionWorkbook({},saved,products);
  assert.deepEqual([3,4,5].map(r=>book.getWorksheet('DAMA').getCell(r,16).value),['b','c','a']);
  assert.equal(book.getWorksheet('RESUMEN').getCell('G6').formula,"SUM('DAMA'!O3:O5)");
  const compare=create(sort,p=>p.category);
  assert.ok(compare({...product,category:'DAMA'},{...product,category:'HOMBRE'})<0);
  assert.ok(create([{field:'category',direction:'desc'}])({category:'DAMA'},{category:'HOMBRE'})>0);
});

test('SUELTOS y ACCESORIOS tienen solapas, resumen y pedido independientes',async()=>{
  const products=[product,{...product,id:'two',CODIGO:'000002'}];
  const input={...selection,items:[{id:'one',category:'SUELTOS'},{id:'two',category:'ACCESORIOS'}]};
  const book=await buildFashionWorkbook({},input,products);
  assert.equal(book.getWorksheet('SUELTOS').getCell('P3').value,'000001');
  assert.equal(book.getWorksheet('ACCESORIOS').getCell('P3').value,'000002');
  assert.equal(book.getWorksheet('RESUMEN').getCell('C7').value,'ACCESORIOS');
  assert.equal(book.getWorksheet('RESUMEN').getCell('G7').formula,"SUM('ACCESORIOS'!O3:O3)");
  assert.equal(book.getWorksheet('CONSOLIDADO_MODA').getCell('C2').formula,"'ACCESORIOS'!N3");
  const legacy=require('../src/services/fashion-master').validateSelection({...selection,items:[{id:'one',category:'SUELTOS Y ACCESORIOS'}]},products);
  assert.deepEqual(legacy.items,[{id:'one',category:'SUELTOS'}]);
});

test('No incluir elimina columnas opcionales y conserva los cálculos ocultos',async()=>{
  const {normalizeExcluded,required}=require('../public/js/fashion-columns');
  for(const key of required)assert.throws(()=>normalizeExcluded([key],['order']),/No se pueden/);
  const excludedColumns=defaults.filter(key=>!required.includes(key));
  const input={...selection,columns:['order'],excludedColumns};
  const normalized=require('../src/services/fashion-master').validateSelection(input,[product]);
  assert.deepEqual(normalized.excludedColumns,excludedColumns);
  const book=await buildFashionWorkbook({},normalized,[product]);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
  const sheet=loaded.getWorksheet('DAMA');
  assert.deepEqual(sheet.getRow(2).values.slice(2),['PEDIDO','PARES','PRECIO MAYORISTA','SUBTOTAL','CODIGO','COD_ALFA']);
  assert.equal(sheet.getCell('E3').formula,'ROUND(D3*C3*B3,2)');
  assert.equal(sheet.getColumn('C').hidden,true);
  assert.equal(sheet.getCell('B3').protection.locked,false);
  assert.equal(loaded.getWorksheet('CONSOLIDADO_MODA').getCell('A1').formula,"'DAMA'!F3");
  assert.equal(loaded.getWorksheet('RESUMEN').getCell('G6').formula,"SUM('DAMA'!E3:E3)");
});

test('Stock se muestra, oculta o excluye conservando valores y fórmulas',async()=>{
  for(const state of ['visible','hidden','excluded']) {
    const columns=['order',...(state==='visible'?['stock']:[])];
    const book=await buildFashionWorkbook({}, {...selection,columns,excludedColumns:state==='excluded'?['stock']:[]},[{...product,STOCK:0}]);
    const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
    const sheet=loaded.getWorksheet('DAMA');
    const col=sheet.getRow(2).values.indexOf('STOCK');
    if(state==='excluded')assert.equal(col,-1);
    else {
      assert.equal(sheet.getCell(3,col).value,0);
      assert.equal(sheet.getColumn(col).hidden,state==='hidden');
      assert.notEqual(sheet.getCell(3,col).protection?.locked,false);
      assert.equal(sheet.getCell(3,col).border.bottom.style,'thin');
    }
    assert.equal(sheet.getCell('B3').protection.locked,false);
    assert.ok(loaded.getWorksheet('RESUMEN').getCell('G6').formula);
  }
});

test('columnas ocultas conservan su posición al guardar y exportar',async()=>{
  const columnOrder=['code','model','pairs','order','wholesale','subtotal','alpha',...defaults.filter(k=>!['code','model','pairs','order','wholesale','subtotal','alpha'].includes(k))];
  const input={...selection,columns:['model','order','subtotal'],columnOrder};
  const saved=JSON.parse(JSON.stringify(require('../src/services/fashion-master').validateSelection(input,[product])));
  assert.deepEqual(saved.columnOrder,columnOrder);
  const book=await buildFashionWorkbook({},saved,[product]);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
  const sheet=loaded.getWorksheet('DAMA');
  assert.deepEqual([2,3,4,5,6,7,8].map(c=>sheet.getCell(2,c).value),['CODIGO','MODELO','PARES','PEDIDO','PRECIO MAYORISTA','SUBTOTAL','COD_ALFA']);
  assert.equal(sheet.getColumn('B').hidden,true);
  assert.equal(sheet.getColumn('D').hidden,true);
  assert.equal(sheet.getColumn('F').hidden,true);
  assert.equal(sheet.getCell('G3').formula,'ROUND(F3*D3*E3,2)');
  assert.equal(sheet.getCell('E3').protection.locked,false);
  assert.equal(sheet.pageSetup.printArea,'C1:G4');
  assert.equal(sheet.autoFilter,'C2:G3');
  assert.equal(loaded.getWorksheet('CONSOLIDADO_MODA').getCell('A1').formula,"'DAMA'!B3");
  assert.equal(loaded.getWorksheet('RESUMEN').getCell('G6').formula,"SUM('DAMA'!G3:G3)");
});

test('Total de pares multiplica pedido por pares y sigue el orden personalizado',async()=>{
  const book=await buildFashionWorkbook({}, {...selection,columns:['totalPairs','order'],columnOrder:['totalPairs','pairs','order',...defaults.filter(k=>!['totalPairs','pairs','order'].includes(k))]},[product]);
  const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
  const sheet=loaded.getWorksheet('DAMA');
  assert.equal(sheet.getCell('B2').value,'TOTAL DE PARES');
  assert.equal(sheet.getCell('B3').formula,'D3*C3');
  assert.equal(sheet.getCell('B4').formula,'SUM(B3:B3)');
  assert.equal(sheet.getColumn('C').hidden,true);
  assert.notEqual(sheet.getCell('B3').protection?.locked,false);
  assert.equal(sheet.getCell('D3').protection.locked,false);
  const normal=await buildFashionWorkbook({},selection,[product]);
  assert.equal(normal.getWorksheet('DAMA').getCell('S3').formula,'N3*K3');
  assert.equal(normal.getWorksheet('DAMA').getCell('S4').formula,'SUM(S3:S3)');
});
