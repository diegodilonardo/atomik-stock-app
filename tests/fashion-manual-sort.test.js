const test=require('node:test'),assert=require('node:assert/strict');
const Manual=require('../public/js/fashion-manual-sort');
const {validateSelection}=require('../src/services/fashion-master');
const {buildFashionWorkbook}=require('../src/services/fashion-excel');
const products=[
 {id:'1',DMODC:'A',DCOLORC:'Negro',DTALLC:'S'},
 {id:'2',DMODC:'A',DCOLORC:'Negro',DTALLC:'L'},
 {id:'3',DMODC:'B',DCOLORC:'Azul',DTALLC:'M'},
 {id:'4',DMODC:'A',DCOLORC:'Azul',DTALLC:'S'}
].map(p=>({...p,CODIGO:p.id,COD_ALFA:'ALFA'+p.id,PARES:1,PRICE_WHOLESALE:10,PRICE_PUBLIC:18}));
const items=products.map(p=>({id:p.id,category:'DAMA'}));
function state(){
 const value=Manual.sync({enabled:true,orders:[]},items,products);
 value.orders.find(r=>r.model===null).values=['B','A'];
 value.orders.find(r=>r.model==='A'&&r.color===null).values=['Negro','Azul'];
 value.orders.find(r=>r.model==='A'&&r.color==='Negro').values=['L','S'];
 return value;
}
test('ordena modelos completos, colores y curvas; nuevas opciones al final',()=>{
 const manual=state(),cmp=Manual.create(manual,['DAMA'],()=> 'DAMA');
 assert.deepEqual([...products].sort(cmp).map(p=>p.id),['3','2','1','4']);
 const added={...products[0],id:'5',DMODC:'AA'};
 Manual.sync(manual,[...items,{id:'5',category:'DAMA'}],[...products,added]);
 assert.deepEqual([...products,added].sort(Manual.create(manual,['DAMA'],()=> 'DAMA')).map(p=>p.id),['3','2','1','4','5']);
 assert.throws(()=>Manual.normalize({enabled:true,orders:[{category:'A',model:null,color:null,values:['a','a']}]}),/inválido/);
});
test('persiste por grilla y respeta filas y referencias de PEDIDO en Excel',async()=>{
 const input={name:'Manual',filters:{years:[],seasons:[]},tabs:['DAMA'],items,manualSort:state(),protectExcel:false,columns:['model','color','curve','order']};
 const valid=validateSelection(JSON.parse(JSON.stringify(input)),products);
 assert.deepEqual(valid.manualSort,input.manualSort);
 const book=await buildFashionWorkbook({},valid,products);
 assert.deepEqual(book.fashionRows.DAMA.map(p=>p.id),['3','2','1','4']);
 const source=book.getWorksheet('CONSOLIDADO_MODA');
 assert.match(source.getCell('C1').formula,/'DAMA'!E3/);
 assert.match(source.getCell('C4').formula,/'DAMA'!E6/);
 const normal=await buildFashionWorkbook({},{...input,manualSort:{...input.manualSort,enabled:false}},products);
 assert.deepEqual(normal.fashionRows.DAMA.map(p=>p.id),['4','1','2','3']);
});
test('el orden de las solapas tiene prioridad y es independiente por categoría',()=>{
 const manual=state();manual.orders.push({category:'HOMBRE',model:null,color:null,values:['A','B']});
 const rows=[{...products[0],category:'DAMA'},{...products[2],category:'HOMBRE'},{...products[0],category:'HOMBRE'}];
 assert.deepEqual(rows.sort(Manual.create(manual,['HOMBRE','DAMA'],p=>p.category)).map(p=>p.category+p.DMODC),['HOMBREA','HOMBREB','DAMAA']);
});
