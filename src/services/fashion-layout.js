const {fields,normalize,normalizeExcluded,normalizeOrder}=require('../../public/js/fashion-columns');

// Move values, styles and validation together, then rebuild all dependent formulas.
// Omitted fields remain hidden to support the summary and order interchange sheet.
function applyFashionLayout(workbook, columns, counts, excludedColumns, columnOrder) {
  const categories=(counts.tabOrder || Object.keys(counts)).filter(category=>counts[category] > 0);
  const visible=normalize(columns);
  const excluded=normalizeExcluded(excludedColumns,visible);
  const ordered=normalizeOrder(columnOrder,visible).filter(key=>!excluded.includes(key));
  const positions=Object.fromEntries(ordered.map((key,i)=>[key,i+2]));
  const visiblePositions=ordered.filter(key=>visible.includes(key)).map(key=>positions[key]);
  const start=Math.min(...visiblePositions), end=Math.max(...visiblePositions);
  const first=workbook.getWorksheet(categories[0]);
  const letters=Object.fromEntries(ordered.map(key=>[key,first.getColumn(positions[key]).letter]));
  for(const category of categories) {
    const sheet=workbook.getWorksheet(category);
    const title=structuredClone({value:sheet.getCell('B1').value,style:sheet.getCell('B1').style});
    const widths=Object.fromEntries(fields.map((f,i)=>[f.key,sheet.getColumn(i+2).width]));
    const snapshots=[];
    for(let r=2;r<=sheet.rowCount;r++) snapshots.push({r,cells:fields.map((field,i)=>{
      const cell=sheet.getCell(r,i+2);
      return {key:field.key,value:structuredClone(cell.value),style:structuredClone(cell.style),validation:structuredClone(cell.dataValidation)};
    })});
    for(const merge of [...sheet.model.merges])sheet.unMergeCells(merge);
    sheet.dataValidations.model={};
    for(let c=2;c<=fields.length+1;c++){sheet.getCell(1,c).value=null;sheet.getCell(1,c).style={};}
    for(let r=2;r<=sheet.rowCount;r++) for(let c=2;c<=fields.length+1;c++) { sheet.getCell(r,c).value=null; sheet.getCell(r,c).style={}; }
    for(const {r,cells} of snapshots) for(const cell of cells) {
      if(excluded.includes(cell.key)) continue;
      const target=sheet.getCell(r,positions[cell.key]);
      target.value=cell.value;target.style=cell.style;
      if(cell.validation)target.dataValidation=cell.validation;
    }
    if(excluded.length) sheet.spliceColumns(ordered.length+2,excluded.length);
    for(const key of ordered){const col=sheet.getColumn(positions[key]);col.width=widths[key];col.hidden=!visible.includes(key);}
    if(end>start)sheet.mergeCells(1,start,1,end);
    sheet.getCell(1,start).value=title.value;sheet.getCell(1,start).style=title.style;
    for(let r=3;r<=counts[category]+2;r++)sheet.getCell(r,positions.subtotal).value={
      formula:`ROUND(${letters.wholesale}${r}*${letters.pairs}${r}*${letters.order}${r},2)`,result:0
    };
    if(positions.totalPairs) for(let r=3;r<=counts[category]+2;r++) sheet.getCell(r,positions.totalPairs).value={formula:`${letters.order}${r}*${letters.pairs}${r}`,result:0};
    if(counts[category]) {
      const total=counts[category]+3;
      for(const key of ordered)sheet.getCell(total,positions[key]).value=null;
      const label=visible.find(key=>!['order','subtotal','totalPairs'].includes(key));
      if(label)sheet.getCell(total,positions[label]).value='TOTAL';
      for(const key of ['order','subtotal','totalPairs'].filter(key=>positions[key]))sheet.getCell(total,positions[key]).value={formula:`SUM(${letters[key]}3:${letters[key]}${total-1})`,result:0};
      sheet.autoFilter={from:`${sheet.getColumn(start).letter}2`,to:`${sheet.getColumn(end).letter}${counts[category]+2}`};
    } else {
      for(const key of ordered)sheet.getCell(3,positions[key]).value=null;
      sheet.getCell('B3').value='Sin productos asignados';
    }
    for(const image of sheet.getImages()) image.range.tl.nativeCol=positions.image-1;
    sheet.pageSetup.printArea=`${sheet.getColumn(start).letter}1:${sheet.getColumn(end).letter}${counts[category]?counts[category]+3:3}`;
    // Templates may leave blank cells styled as inputs; enforce the one editable column.
    sheet.eachRow(row=>row.eachCell(cell=>{cell.protection={locked:true};}));
    for(let r=3;r<=counts[category]+2;r++)sheet.getCell(r,positions.order).protection={locked:false};
  }
  const summary=workbook.getWorksheet('RESUMEN'),consolidated=workbook.getWorksheet('CONSOLIDADO_MODA');
  let index=0;
  categories.forEach((category,i)=>{
    const end=counts[category]+2;
    const range=key=>`'${category.replace(/'/g,"''")}'!${letters[key]}3:${letters[key]}${end}`;
    const formulas=[`COUNTIF(${range('order')},">0")`,`SUM(${range('order')})`,
      `SUMPRODUCT(${range('pairs')},${range('order')})`,`SUM(${range('subtotal')})`];
    formulas.forEach((formula,j)=>{summary.getCell(i+6,j+4).value=counts[category]?{formula,result:0}:0;});

  });
  const {orderEntries,writeOrderSource}=require('./fashion-order');
  for(const entry of orderEntries(workbook,counts))writeOrderSource(consolidated,++index,entry,letters);
}
module.exports={applyFashionLayout};
