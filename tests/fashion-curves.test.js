const test=require('node:test'),assert=require('node:assert/strict');
const {validateSelection}=require('../src/services/fashion-master');
const {buildFashionWorkbook}=require('../src/services/fashion-excel');
const ExcelJS=require('exceljs');
const sizes=['S','M','L','XL'],qty=[1,2,2,1];
const products=sizes.map((TALLC,i)=>({id:'p'+i,CODIGO:'00'+i,COD_ALFA:'A'+i,COD_ANIO:'27',COD_TEM:'1',MODC:'SHIRT',DMODC:'Remera',COLORC:'01',DCOLORC:'Negro',TALLC,DTALLC:TALLC,NIVEL:900,PARES:1,STOCK:0,PRICE_WHOLESALE:100+i*10,PRICE_PUBLIC:200+i*20}));
const selection={name:'Curvas',filters:{years:['27'],seasons:['1']},items:products.map(p=>({id:p.id,category:'HOMBRE'})),curves:[{id:'curve1',name:'S a XL',parts:products.map((p,i)=>({id:p.id,quantity:qty[i]}))}]};
test('valida sueltos sin stock y evita mezclas, faltantes y duplicados',()=>{
 assert.equal(validateSelection(selection,products).curves[0].parts.length,4);
 for(const change of [{STOCK:1},{STOCK:null},{STOCK:undefined},{STOCK:-1},{NIVEL:950},{PARES:12},{COLORC:'02'},{COD_TEM:'2'},{TALLC:'M'}])assert.throws(()=>validateSelection(selection,[{...products[0],...change},...products.slice(1)]));
 assert.throws(()=>validateSelection(selection,products.slice(1)),/maestro/);
 assert.throws(()=>validateSelection({...selection,curves:[...selection.curves,{...selection.curves[0],id:'curve2'}]},products),/más de una/);
 for(const quantity of [0,-1,1.5,1001])assert.throws(()=>validateSelection({...selection,curves:[{...selection.curves[0],parts:[{id:'p0',quantity}]}]},products),/entero/);
});
test('una fila virtual con 6 pares genera cuatro códigos de pedido y respeta columnas',async()=>{
 for(const custom of [false,true]){
 const extra={...products[0],id:'stock',CODIGO:'009',COD_ALFA:'STOCK',STOCK:5,TALLC:'2X'};
 const input={...selection,items:[...selection.items,{id:'stock',category:'HOMBRE'}],...(custom?{columns:['order','model','pairs','subtotal'],excludedColumns:['image']}: {})};
 const saved=JSON.parse(JSON.stringify(validateSelection(input,[...products,extra])));
 const book=await buildFashionWorkbook({},saved,[...products,extra]);
 const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());
 const sheet=loaded.getWorksheet('HOMBRE'),helper=loaded.getWorksheet('CONSOLIDADO_MODA');
 const headers=sheet.getRow(2).values;
 const col=name=>headers.indexOf(name);
 const virtualRow=[3,4].find(r=>sheet.getCell(r,col('PARES')).value===6);
 assert.ok(virtualRow);
 assert.equal(sheet.getCell(virtualRow,col('PRECIO MAYORISTA')).value,115);
 assert.equal(sheet.getCell(virtualRow,col('PRECIO PÚBLICO')).value,230);
 assert.equal(sheet.getCell(virtualRow,col('CURVA / TALLE')).value,'S × 1 / M × 2 / L × 2 / XL × 1');
 for(const ws of loaded.worksheets)ws.eachRow(row=>row.eachCell(cell=>assert.equal(cell.note,undefined)));
 assert.equal(sheet.getCell(virtualRow,col('TOTAL DE PARES')).formula,sheet.getColumn(col('PEDIDO')).letter+virtualRow+'*'+sheet.getColumn(col('PARES')).letter+virtualRow);
 assert.equal(sheet.rowCount,5);
 const orderLetter=sheet.getColumn(col('PEDIDO')).letter;
 const actual=[];helper.eachRow(row=>{if(typeof row.getCell(1).value==='string')actual.push([row.getCell(1).value,row.getCell(2).value,row.getCell(3).formula]);});
 assert.deepEqual(actual,products.map((p,i)=>[p.CODIGO,p.COD_ALFA,"'HOMBRE'!"+orderLetter+virtualRow+'*'+qty[i]]));
 assert.equal(helper.rowCount,5);
 assert.equal(loaded.getWorksheet('PEDIDO').rowCount,6);
 assert.equal(sheet.getCell(virtualRow,col('PEDIDO')).protection.locked,false);
 assert.equal(loaded.getWorksheet('PEDIDO').sheetProtection.sheet,true);
 assert.ok(loaded.getWorksheet('RESUMEN').getCell('F6').formula.includes('SUMPRODUCT'));
 }
});

test('aplica distribución por modelo/color sin mezclar temporadas ni productos con stock',()=>{
 const {planBatch,identity,validate}=require('../public/js/fashion-curves');
 const make=(suffix,change={})=>products.map(p=>({...p,id:p.id+suffix,CODIGO:p.CODIGO+suffix,COD_ALFA:p.COD_ALFA+suffix,MODC:suffix,DMODC:suffix,...change}));
 const ready=make('ready'),stock=make('stock'),missing=make('missing').slice(0,3),duplicate=make('duplicate');
 stock[1].STOCK=4;
 duplicate.push({...duplicate[0],id:'duplicate-code'});
 const otherSeason=make('ready',{COD_TEM:'2'}).map(p=>({...p,id:p.id+'season',CODIGO:p.CODIGO+'season',COD_ALFA:p.COD_ALFA+'season'}));
 const all=[...products,...ready,...stock,...missing,...duplicate,...otherSeason];
 const keys=[products[0],ready[0],stock[0],missing[0],duplicate[0],otherSeason[0]].map(identity);
 const plan=planBatch(selection.curves[0],all,keys,selection.curves);
 assert.equal(plan.length,6);
 assert.match(plan[0].reasons[0],/ya pertenece/);
 assert.equal(plan[1].reasons.length,0);
 assert.match(plan[2].reasons.join(' '),/stock/);
 assert.match(plan[3].reasons.join(' '),/falta el talle/);
 assert.match(plan[4].reasons.join(' '),/más de un código/);
 assert.equal(plan[5].reasons.length,0);
 const additions=plan.filter(r=>!r.reasons.length).map((r,i)=>({id:'batch'+i,name:'Curva',parts:r.parts}));
 const assigned=[...selection.items,...additions.flatMap(c=>c.parts.map(p=>({id:p.id,category:'DAMA'})))];
 assert.equal(validate([...selection.curves,...additions],all,assigned).length,3);
 assert.deepEqual(additions[0].parts.map(p=>p.quantity),[1,2,2,1]);
 assert.ok(additions[0].parts.every(p=>ready.some(product=>product.id===p.id)));
 assert.ok(additions[1].parts.every(p=>otherSeason.some(product=>product.id===p.id)));
});

test('define y guarda plantillas sin productos y las aplica solo a los asignados',async()=>{
 const {validateTemplates,planBatch,identity}=require('../public/js/fashion-curves');
 const template={id:'free',name:'Curva libre',distribution:[{size:'XL',quantity:1},{size:'S',quantity:1},{size:'M',quantity:2},{size:'L',quantity:2}]};
 const saved=JSON.parse(JSON.stringify(validateSelection({name:'Plantillas',filters:{years:[],seasons:[]},items:[],curveTemplates:[template]},[])));
 assert.deepEqual(saved.curveTemplates[0].distribution.map(p=>p.size),['S','M','L','XL']);
 assert.equal(saved.items.length,0);
 await assert.rejects(buildFashionWorkbook({},saved,[]),/Asigná productos/);
 const complete=planBatch(saved.curveTemplates[0],products,[identity(products[0])],[]);
 assert.equal(complete[0].reasons.length,0);
 assert.deepEqual(complete[0].parts.map(p=>p.quantity),[1,2,2,1]);
 const incomplete=planBatch(saved.curveTemplates[0],products.slice(0,3),[identity(products[0])],[]);
 assert.match(incomplete[0].reasons.join(' '),/XL: falta el talle/);
 for(const distribution of [[{size:'S',quantity:0}],[{size:'S',quantity:1},{size:'s',quantity:2}],[{size:'2X',quantity:1},{size:'XXL',quantity:1}]])assert.throws(()=>validateTemplates([{...template,distribution}]),/único/);
});

test('permite guardar la eliminación de la última plantilla sin productos',async()=>{
 const input={name:'Grilla vacía',filters:{years:[],seasons:[]},items:[],curveTemplates:[],curves:[]};
 const saved=validateSelection(input,[]);
 assert.deepEqual(saved.curveTemplates,[]);
 assert.deepEqual(saved.items,[]);
 await assert.rejects(buildFashionWorkbook({},saved,[]),/Asigná productos/);
});

test('selector deduplica aplicaciones y distingue distribuciones con el mismo nombre',()=>{
 const {reusableTemplates}=require('../public/js/fashion-curves');
 const template={id:'template',name:'CURVA MUJER',distribution:sizes.map((size,i)=>({size,quantity:qty[i]}))};
 const applied={...selection.curves[0],name:'CURVA MUJER'};
 const list=reusableTemplates([template],[applied,{...applied,id:'other'}],products);
 assert.equal(list.length,1);assert.equal(list[0].id,'template');assert.equal(list[0].label,'CURVA MUJER');
 const distinct=reusableTemplates([template,{...template,id:'different',distribution:[{size:'S',quantity:2}]}],[applied],products);
 assert.equal(distinct.length,2);assert.notEqual(distinct[0].label,distinct[1].label);
 assert.equal(reusableTemplates([],[applied,{...applied,id:'other'}],products).length,1);
});
