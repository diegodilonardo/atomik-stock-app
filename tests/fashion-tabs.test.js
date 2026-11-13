const test=require('node:test'),assert=require('node:assert/strict');
const tabs=require('../public/js/fashion-tabs');
const {validateSelection}=require('../src/services/fashion-master');
const {buildFashionWorkbook}=require('../src/services/fashion-excel');
test('solapas heredadas y validación de nombres',()=>{
 assert.deepEqual(tabs.normalize(),tabs.defaults);
 for(const value of [[],['PEDIDO'],['Resumen'],['A','a'],['Mal/nombre'],["'Inicio"],['x'.repeat(32)]])assert.throws(()=>tabs.normalize(value));
 assert.deepEqual(tabs.normalize([" Niños ","D'Autor"]),['Niños',"D'Autor"]);
});
test('solapas personalizadas ordenan Excel, resumen y pedido sin incluir vacías',async()=>{
 const products=[{id:'a',CODIGO:'01',COD_ALFA:'A',PARES:2,PRICE_WHOLESALE:100,PRICE_PUBLIC:185},{id:'b',CODIGO:'02',COD_ALFA:'B',PARES:1,PRICE_WHOLESALE:50,PRICE_PUBLIC:95}];
 const body={name:'Personalizada',filters:{years:[],seasons:[]},tabs:["D'Autor",'Niños','Vacía'],items:[{id:'a',category:'Niños'},{id:'b',category:"D'Autor"}],protectExcel:false};
 assert.deepEqual(validateSelection(body,products).tabs,body.tabs);
 assert.throws(()=>validateSelection({...body,tabs:['Otra']},products),/Categoría/);
 for(const columns of [undefined,['order','model','subtotal']]){
  const book=await buildFashionWorkbook({}, {...body,columns},products);
  assert.deepEqual(book.worksheets.filter(s=>s.state!=='veryHidden').map(s=>s.name),["D'Autor",'Niños','RESUMEN','PEDIDO']);
  assert.equal(book.getWorksheet('RESUMEN').getCell('C6').value,"D'Autor");
  assert.match(book.getWorksheet('RESUMEN').getCell('D6').formula,/'D''Autor'!/);
  assert.match(book.getWorksheet('CONSOLIDADO_MODA').getCell('C1').formula,/'D''Autor'!/);
  assert.match(book.getWorksheet('CONSOLIDADO_MODA').getCell('C2').formula,/'Niños'!/);
  assert.equal(book.getWorksheet('Vacía'),undefined);
 }
});
