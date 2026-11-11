(function(root) {
  const collator = new Intl.Collator('es', { numeric:true, sensitivity:'base' });
  const text = value => String(value ?? '').trim();
  const fields = [{key:'category',label:'Categoría'},{key:'model',label:'Modelo'},{key:'color',label:'Color'},{key:'curve',label:'Curva'}];
  function normalize(value) {
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value) || !value.length || value.length > 4 ||
      value.some(rule => !rule || !fields.some(f=>f.key===rule.field) || !['asc','desc'].includes(rule.direction)) ||
      new Set(value.map(rule=>rule.field)).size !== value.length)
      throw Object.assign(new Error('Orden personalizado inválido: elegí campos sin repetir.'),{status:400});
    return value.map(({field,direction})=>({field,direction}));
  }
  function create(value, category = p=>p.category || '') {
    const rules=normalize(value) || ['model','color','curve'].map(field=>({field,direction:'asc'}));
    const get=(p,key)=>key==='category'?category(p):key==='model'?p.DMODC:key==='color'?p.DCOLORC:p.DTALLC || p.TALLC;
    return (a,b)=>{
      for(const rule of rules) {
        const result=collator.compare(text(get(a,rule.field)),text(get(b,rule.field)));
        if(result) return rule.direction==='desc'?-result:result;
      }
      return collator.compare(text(a.COD_ALFA),text(b.COD_ALFA)) || collator.compare(text(a.CODIGO),text(b.CODIGO));
    };
  }
  const api={fields,normalize,create,compare:create(null)};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FashionSort = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
