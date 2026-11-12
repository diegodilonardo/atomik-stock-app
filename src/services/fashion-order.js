const { CATEGORIES } = require('./fashion-master');

function configureFashionOrder(workbook, counts) {
  const order = workbook.addWorksheet('PEDIDO', { properties:{tabColor:{argb:'FF1769AA'}} });
  const source = workbook.addWorksheet('CONSOLIDADO_MODA', { state:'veryHidden' });
  order.addRow(['CODIGO','COD_ALFA','CANTIDAD']);
  let index = 0;
  for (const entry of orderEntries(workbook,counts)) {
    index++;
    writeOrderSource(source,index,entry,{code:'P',alpha:'Q',order:'N'});
    source.getCell(index,4).value = {formula:(index===1?'0':'D'+(index-1))+'+IF(C'+index+'>0,1,0)',result:0};
    source.getCell(index,5).value = {formula:'IF(C'+index+'>0,D'+index+',0)',result:0};
  }
  // Compact positive orders without FILTER spill formulas, for older Excel versions.
  for (let n = 1; n <= index; n++) {
    const r=n+1;
    order.getCell(r,4).value = {formula:`IF(${n}<='CONSOLIDADO_MODA'!$D$${index},MATCH(${n},'CONSOLIDADO_MODA'!$E$1:$E$${index},0),"")`,result:''};
    for (const col of ['A','B','C']) order.getCell(`${col}${r}`).value = {
      formula:`IF($D${r}="","",INDEX('CONSOLIDADO_MODA'!$${col}$1:$${col}$${index},$D${r}))`,result:''
    };
  }
  [22,28,16].forEach((width,i)=>{order.getColumn(i+1).width=width;});
  order.getColumn(4).hidden=true;
  for(let r=1;r<=index+1;r++) {
    order.getRow(r).height=r===1?28:22;
    for(let c=1;c<=3;c++) {
      const cell=order.getCell(r,c);
      cell.font={name:'Calibri',size:11,bold:r===1,color:{argb:r===1?'FFFFFFFF':'FF000000'}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:r===1?'FF111111':'FFF2F2F2'}};
      cell.alignment={horizontal:'center',vertical:'middle'};
      cell.border=Object.fromEntries(['top','bottom','left','right'].map(side=>[side,{style:'thin',color:{argb:'FF666666'}}]));
      if(c===3 && r>1)cell.numFmt='0';
    }
  }
  order.views=[{state:'frozen',ySplit:1,showGridLines:false}];
  order.pageSetup={orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1',printArea:`A1:C${index+1}`};
}

function orderEntries(workbook,counts) {
  const entries=[];
  for(const category of CATEGORIES)for(let row=3;row<=counts[category]+2;row++){
    const parts=workbook.fashionRows?.[category]?.[row-3]?.VIRTUAL_PARTS;
    for(const part of parts || [null])entries.push({category,row,part});
  }
  return entries;
}
function writeOrderSource(sheet,index,{category,row,part},letters){
  sheet.getCell(index,1).value=part?part.code:{formula:"'"+category+"'!"+letters.code+row,result:''};
  sheet.getCell(index,2).value=part?part.alpha:{formula:"'"+category+"'!"+letters.alpha+row,result:''};
  sheet.getCell(index,3).value={formula:"'"+category+"'!"+letters.order+row+(part?'*'+part.quantity:''),result:0};
}
module.exports={configureFashionOrder,orderEntries,writeOrderSource};
