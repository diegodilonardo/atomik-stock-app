(function(root){
 const sort=typeof module==='object'&&module.exports?require('./fashion-sort'):root.FashionSort;
 const text=v=>String(v??'');
 const key=(category,model=null,color=null)=>JSON.stringify([category,model,color]);
 function normalize(value){
  if(value==null)return null;
  const fail=()=>{throw Object.assign(new Error('Orden manual inválido'),{status:400});};
  if(typeof value.enabled!=='boolean'||!Array.isArray(value.orders)||value.orders.length>30000)fail();
  const seen=new Set();
  const orders=value.orders.map(r=>{
   if(!r||typeof r.category!=='string'||!(r.model===null||typeof r.model==='string')||!(r.color===null||typeof r.color==='string')||(r.model===null&&r.color!==null)||!Array.isArray(r.values)||r.values.length>10000||r.values.some(v=>typeof v!=='string'||v.length>1000)||new Set(r.values).size!==r.values.length)fail();
   const k=key(r.category,r.model,r.color);if(seen.has(k))fail();seen.add(k);
   return {category:r.category,model:r.model,color:r.color,values:[...r.values]};
  });return {enabled:value.enabled,orders};
 }
 function sync(state,items,products){
  const byId=new Map(products.map(p=>[p.id,p])),groups=new Map();
  for(const item of items){const p=byId.get(item.id);if(!p)continue;const m=text(p.DMODC),c=text(p.DCOLORC),v=text(p.DTALLC||p.TALLC);
   for(const [model,color,value] of [[null,null,m],[m,null,c],[m,c,v]]){const k=key(item.category,model,color);if(!groups.has(k))groups.set(k,{category:item.category,model,color,values:[]});const g=groups.get(k);if(!g.values.includes(value))g.values.push(value);}
  }
  for(const [k,g] of groups){let old=state.orders.find(r=>key(r.category,r.model,r.color)===k);if(!old){old={...g,values:[]};state.orders.push(old);}const extra=g.values.filter(v=>!old.values.includes(v));extra.sort(g.color===null?(a,b)=>a.localeCompare(b,'es',{numeric:true}):sort.compareSizes);old.values.push(...extra);}
  return state;
 }
 function create(state,tabs,category){
  const fallback=sort.create(null),index=new Map((state?.orders||[]).map(r=>[key(r.category,r.model,r.color),new Map(r.values.map((v,i)=>[v,i]))]));
  return (a,b)=>{
   const ca=category(a),cb=category(b);if(ca!==cb)return (tabs.indexOf(ca)<0?tabs.length:tabs.indexOf(ca))-(tabs.indexOf(cb)<0?tabs.length:tabs.indexOf(cb))||text(ca).localeCompare(text(cb));
   for(const [model,color,av,bv] of [[null,null,text(a.DMODC),text(b.DMODC)],[text(a.DMODC),null,text(a.DCOLORC),text(b.DCOLORC)],[text(a.DMODC),text(a.DCOLORC),text(a.DTALLC||a.TALLC),text(b.DTALLC||b.TALLC)]]){
    if(av===bv)continue;const ranks=index.get(key(ca,model,color));const diff=(ranks?.get(av)??Infinity)-(ranks?.get(bv)??Infinity);if(diff&&!Number.isNaN(diff))return diff;
    return color!==null?sort.compareSizes(av,bv):av.localeCompare(bv,'es',{numeric:true});
   }return fallback(a,b);
  };
 }
 const api={normalize,sync,create,key};if(typeof module==='object'&&module.exports)module.exports=api;else root.FashionManualSort=api;
})(typeof globalThis!=='undefined'?globalThis:this);
