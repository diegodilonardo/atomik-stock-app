(function(root){
  const text=value=>String(value ?? '').trim();
  const size=p=>text(p.TALLC || p.DTALLC);
  const identity=p=>JSON.stringify(['COD_ANIO','COD_TEM','MARCA','DMARCA','MODC','DMODC','COLORC','DCOLORC','RUBRO','LICENCIAS','SEXO','EDAD','DISCIPLINA'].map(k=>text(p[k])));
  const eligible=p=>Number(p.NIVEL)===900 && Number(p.PARES)===1 && p.STOCK!==null && p.STOCK!==undefined && text(p.STOCK)!=='' && Number(p.STOCK)===0;
  function fail(message){throw Object.assign(new Error(message),{status:400});}
  function validate(curves,products,items){
    if(curves===undefined)return [];
    if(!Array.isArray(curves)||curves.length>1000)fail('Curvas virtuales inválidas');
    const byId=new Map(products.map(p=>[p.id,p])), assigned=new Map(items.map(i=>[i.id,i.category])),used=new Set(),ids=new Set();
    return curves.map(curve=>{
      if(!curve || typeof curve.id!=='string'||!curve.id||curve.id.length>100||ids.has(curve.id)||typeof curve.name!=='string'||!curve.name.trim()||curve.name.length>100||!Array.isArray(curve.parts)||!curve.parts.length||curve.parts.length>100)fail('Indicá un nombre y los talles de la curva virtual');
      ids.add(curve.id);let group,category;const sizes=new Set();
      const parts=curve.parts.map(part=>{
        const p=byId.get(part?.id);
        if(!p||!eligible(p))fail('La curva '+curve.name+' requiere sueltos con un par y stock exactamente 0. Revisá sus productos.');
        if(used.has(p.id))fail('Un producto no puede pertenecer a más de una curva virtual');
        if(!assigned.has(p.id))fail('Todos los talles de la curva deben estar asignados a la grilla');
        if(!Number.isInteger(part.quantity)||part.quantity<1||part.quantity>1000)fail('La cantidad por talle debe ser un entero entre 1 y 1000');
        if(!size(p)||sizes.has(size(p).toUpperCase()))fail('La curva debe tener un único producto por talle');
        sizes.add(size(p).toUpperCase());
        if(group!==undefined&&(group!==identity(p)||category!==assigned.get(p.id)))fail('La curva debe reunir el mismo modelo, color, año, temporada y categoría');
        group=identity(p);category=assigned.get(p.id);used.add(p.id);
        return {id:p.id,quantity:part.quantity};
      });
      return {id:curve.id,name:curve.name.trim(),parts};
    });
  }
  function materialize(selection,products){
    const byId=new Map(products.map(p=>[p.id,p])),items=selection.items,consumed=new Set(),virtual=[];
    for(const curve of selection.curves || []){
      const parts=curve.parts.map(part=>({...part,product:byId.get(part.id)}));
      parts.sort((a,b)=>{const sort=typeof module==='object'&&module.exports?require('./fashion-sort'):root.FashionSort;return sort.compareSizes(size(a.product),size(b.product));});
      const first=parts[0].product,pairs=parts.reduce((n,p)=>n+p.quantity,0);
      const sum=key=>parts.reduce((n,p)=>n+Number(p.product[key])*p.quantity,0);
      const id='virtual:'+curve.id;
      const product={...first,id,CODIGO:'',COD_ALFA:'',NIVEL:950,PARES:pairs,STOCK:0,
        DTALLC:parts.map(p=>size(p.product)+' × '+p.quantity).join(' / '),TALLC:'',
        PRECIO:sum('PRICE_WHOLESALE'),PRICE_WHOLESALE:sum('PRICE_WHOLESALE')/pairs,PRICE_PUBLIC:sum('PRICE_PUBLIC')/pairs,
        VIRTUAL_NAME:curve.name,VIRTUAL_PARTS:parts.map(p=>({code:p.product.CODIGO,alpha:p.product.COD_ALFA,quantity:p.quantity}))};
      virtual.push({product,item:{id,category:items.find(i=>i.id===first.id).category}});
      parts.forEach(p=>consumed.add(p.id));
    }
    return {products:[...products,...virtual.map(v=>v.product)],items:[...items.filter(i=>!consumed.has(i.id)),...virtual.map(v=>v.item)]};
  }
  function validateTemplates(value){
    if(value===undefined)return [];
    if(!Array.isArray(value)||value.length>1000)fail('Plantillas de curvas inválidas');
    const ids=new Set(),sort=typeof module==='object'&&module.exports?require('./fashion-sort'):root.FashionSort;
    return value.map(t=>{
      if(!t||typeof t.id!=='string'||!t.id||t.id.length>100||ids.has(t.id)||typeof t.name!=='string'||!t.name.trim()||t.name.length>100||!Array.isArray(t.distribution)||!t.distribution.length||t.distribution.length>100)fail('Indicá nombre y talles de la curva');
      ids.add(t.id);const sizes=[];
      const distribution=t.distribution.map(p=>{
        if(!p||typeof p.size!=='string'||!p.size.trim()||p.size.length>60||sizes.some(s=>sort.compareSizes(s,p.size)===0)||!Number.isInteger(p.quantity)||p.quantity<1||p.quantity>1000)fail('Cada talle debe ser único y su cantidad un entero entre 1 y 1000');
        sizes.push(p.size.trim());return {size:p.size.trim(),quantity:p.quantity};
      });
      distribution.sort((a,b)=>sort.compareSizes(a.size,b.size));
      return {id:t.id,name:t.name.trim(),distribution};
    });
  }
  function planBatch(template,products,groupKeys,existing){
    const sort=typeof module==='object'&&module.exports?require('./fashion-sort'):root.FashionSort;
    const byId=new Map(products.map(p=>[p.id,p]));
    const distribution=template.distribution || template.parts.map(part=>({size:size(byId.get(part.id)||{}),quantity:part.quantity}));
    if(distribution.some(p=>!p.size))fail('La curva de origen tiene productos ausentes. Revisala antes de reutilizarla.');
    const grouped=new Map();
    for(const p of products){const key=identity(p);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(p);}
    const used=new Set(existing.flatMap(c=>c.parts.map(p=>p.id)));
    return [...new Set(groupKeys)].map(key=>{
      const group=grouped.get(key)||[],parts=[],reasons=[];
      for(const entry of distribution){
        const matches=group.filter(p=>Number(p.NIVEL)===900&&Number(p.PARES)===1&&sort.compareSizes(size(p),entry.size)===0);
        if(matches.length!==1){reasons.push(entry.size+': '+(matches.length?'más de un código':'falta el talle'));continue;}
        const p=matches[0];
        if(!eligible(p)){reasons.push(entry.size+': stock distinto de cero o sin informar');continue;}
        if(used.has(p.id)){reasons.push(entry.size+': ya pertenece a una curva');continue;}
        parts.push({id:p.id,quantity:entry.quantity});
      }
      return {key,product:group[0],parts,reasons};
    });
  }
  function reusableTemplates(templates,curves,products){
    const byId=new Map(products.map(p=>[p.id,p])),seen=new Set(),result=[];
    const sort=typeof module==='object'&&module.exports?require('./fashion-sort'):root.FashionSort;
    const normalizeSize=value=>text(value).toUpperCase().replace(/^XXL$/,'2X').replace(/^XXXL$/,'3X').replace(/^([2-5])XL$/,'$1X');
    for(const candidate of [...templates,...curves.map(c=>({...c,id:'applied:'+c.id}))]){
      const distribution=candidate.distribution || candidate.parts.map(part=>({size:size(byId.get(part.id)||{}),quantity:part.quantity}));
      if(distribution.some(p=>!p.size))continue;
      const normalized=distribution.map(p=>({size:normalizeSize(p.size),quantity:p.quantity})).sort((a,b)=>sort.compareSizes(a.size,b.size));
      const key=JSON.stringify([text(candidate.name).toUpperCase(),normalized]);
      if(seen.has(key))continue;
      seen.add(key);result.push({...candidate,distribution:normalized});
    }
    return result.map(c=>({...c,label:result.filter(other=>text(other.name).toUpperCase()===text(c.name).toUpperCase()).length>1
      ? c.name+' — '+c.distribution.map(p=>p.size+'×'+p.quantity).join(' / ') : c.name}));
  }
  const api={eligible,size,identity,validate,materialize,planBatch,validateTemplates,reusableTemplates};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.FashionCurves=api;
})(typeof globalThis!=='undefined'?globalThis:this);
