const test=require('node:test');
const assert=require('node:assert/strict');
const {compareSizes,create}=require('../public/js/fashion-sort');
test('ordena indumentaria XS a 3X y sus equivalencias',()=>{
 assert.deepEqual(['3X','M','XS','XL','2X','L','S'].sort(compareSizes),['XS','S','M','L','XL','2X','3X']);
 assert.equal(compareSizes('2XL','2X'),0);
 assert.equal(compareSizes('XXXL','3X'),0);
 assert.deepEqual(['40','34','5'].sort(compareSizes),['5','34','40']);
 const rows=['S','3X','XS','L','M','2X','XL'].map(DTALLC=>({DTALLC}));
 assert.deepEqual(rows.sort(create(null)).map(p=>p.DTALLC),['XS','S','M','L','XL','2X','3X']);
 assert.deepEqual(rows.sort(create([{field:'curve',direction:'desc'}])).map(p=>p.DTALLC),['3X','2X','XL','L','M','S','XS']);
});
