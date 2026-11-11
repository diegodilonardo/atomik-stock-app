const test=require('node:test');
const assert=require('node:assert/strict');
const {applyFashionPrices}=require('../src/services/fashion-prices');
test('precios de moda usan combinación, marca y empresa; respetan nivel, lista y ceros',()=>{
  const product={DMARCA:'ATOMIK',LICENCIAS:'SAN LORENZO',RUBRO:'INDUMENTARIA',NIVEL:950,PARES:1,PRECIO:100};
  const company={PUBLIC_PRICE_FACTOR:1.85};
  const brand={MARCA:'ATOMIK',NIVEL:950,ESPECIFICO:false,LISTA:'',FACTOR:1.87};
  const exact={...brand,ESPECIFICO:true,LICENCIA:'SAN LORENZO',RUBRO:'INDUMENTARIA',FACTOR:1.9};
  const price=(p,rules)=>applyFashionPrices([p],company,rules)[0].PRICE_PUBLIC;
  assert.equal(price(product,[]),185);
  assert.equal(price(product,[brand]),187);
  assert.equal(price(product,[brand,exact]),190);
  assert.equal(price({...product,PRECIO:0},[exact]),0);
  assert.equal(price({...product,NIVEL:900},[exact]),185);
  assert.equal(price({...product,LICENCIAS:''},[brand,exact]),187);
  assert.equal(price({...product,LICENCIAS:'SIN LICENCIA'},[{...exact,LICENCIA:'',FACTOR:2}]),200);
  assert.equal(price(product,[{...exact,LISTA:'03',FACTOR:2}]),185);
  assert.equal(price({...product,LISTA:'03'},[exact,{...brand,LISTA:'03',FACTOR:2}]),200);
  assert.equal(price({...product,LISTA:'03'},[brand,{...exact,LISTA:'03',FACTOR:2.1}]),210);
  assert.equal(product.PRICE_PUBLIC,undefined,'no modifica la copia compartida del maestro');
});

test('precios por par y subtotal por módulos conservan el importe del maestro',()=>{
  const p=applyFashionPrices([{PARES:12,PRECIO:1200}],{PUBLIC_PRICE_FACTOR:1.85},[])[0];
  assert.equal(p.PRICE_WHOLESALE,100);assert.equal(p.PRICE_PUBLIC,185);
  assert.equal(p.PRICE_WHOLESALE*p.PARES*3,3600);
  assert.equal(p.PRECIO,1200);
  for(const pairs of [0,-1,null,undefined]) assert.throws(()=>applyFashionPrices([{PARES:pairs,PRECIO:100}],{PUBLIC_PRICE_FACTOR:1.85},[]),/pares por módulo/);
});
