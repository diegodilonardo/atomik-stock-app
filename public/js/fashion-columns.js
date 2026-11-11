(function(root) {
  const fields = [
    ['image','Imagen'],['year','Año'],['season','Temporada'],['model','Modelo'],
    ['color','Color'],['curve','Curva / talle'],['sex','Sexo'],['age','Edad'],
    ['discipline','Disciplina'],['pairs','Pares por módulo'],['wholesale','Precio mayorista'],
    ['public','Precio público'],['order','Pedido'],['subtotal','Subtotal'],['code','Código'],['alpha','Código alfa'],['stock','Stock'],['totalPairs','Total de pares']
  ].map(([key,label])=>({key,label}));
  const defaults=fields.map(f=>f.key);
  function normalize(value) {
    if(value===undefined) return [...defaults];
    if(!Array.isArray(value) || value.length>fields.length || value.some(key=>!defaults.includes(key)) ||
        new Set(value).size!==value.length || !value.includes('order')) {
      throw Object.assign(new Error('Columnas inválidas: elegí campos sin repetir y conservá Pedido.'),{status:400});
    }
    return [...value];
  }
  const required=['pairs','wholesale','order','subtotal','code','alpha'];
  function normalizeExcluded(value, visible) {
    if(value===undefined) return [];
    if(!Array.isArray(value) || new Set(value).size!==value.length ||
      value.some(key=>!defaults.includes(key)||required.includes(key)||visible.includes(key)))
      throw Object.assign(new Error('No se pueden excluir campos visibles o necesarios para cálculos y PEDIDO.'),{status:400});
    return [...value];
  }
  function normalizeOrder(value, visible) {
    if(value===undefined) return [...visible,...defaults.filter(key=>!visible.includes(key))];
    if(!Array.isArray(value)||value.some(key=>!defaults.includes(key))||new Set(value).size!==value.length)
      throw Object.assign(new Error('Orden de columnas inválido.'),{status:400});
    return [...value,...defaults.filter(key=>!value.includes(key))];
  }
  const api={fields,defaults,normalize,required,normalizeExcluded,normalizeOrder};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.FashionColumns=api;
})(typeof window!=='undefined'?window:globalThis);
