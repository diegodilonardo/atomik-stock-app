(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FashionTabs=factory();})(this,function(){
const defaults=['DISCIPLINA','HOMBRE','DAMA','KIDS','SUELTOS','ACCESORIOS'];
function normalize(value){
 if(value===undefined)return [...defaults];
 if(!Array.isArray(value)||!value.length||value.length>50)throw Object.assign(new Error('Definí entre 1 y 50 solapas'),{status:400});
 const seen=new Set(['RESUMEN','PEDIDO','CONSOLIDADO_MODA','HISTORY','ALL','ASSIGNED','UNASSIGNED','__PROTO__','CONSTRUCTOR','PROTOTYPE','TABORDER']);
 return value.map(name=>{
 if(typeof name!=='string'||!name.trim()||name.trim().length>31||/[\\/?:*\[\]\x00-\x1f]/.test(name)||/^'|'$/.test(name.trim()))throw Object.assign(new Error('Nombre de solapa inválido: máximo 31 caracteres, sin / \\ ? * : [ ]'),{status:400});
 name=name.trim();const key=name.toUpperCase();if(seen.has(key))throw Object.assign(new Error('Nombre de solapa repetido o reservado: '+name),{status:400});seen.add(key);return name;
 });
}
return {defaults,normalize};
});
