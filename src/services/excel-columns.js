const KEYS = ['image','year','model','color','curve','pairs','sex','age','discipline','wholesale','public','base','brand','license'];
const DEFAULTS = KEYS.filter(key => !['base','brand','license'].includes(key));
function normalizeColumns(value) {
  if (!Array.isArray(value) || value.some(key => !KEYS.includes(key))) throw Object.assign(new Error('Columnas de Excel invalidas'), {status:400});
  return [...new Set(value)];
}
function applyColumns(book, selection, products) {
  if (selection === undefined) return;
  const selected = new Set(normalizeColumns(selection));
  const maps = { MODULOS: {image:2,year:3,model:4,color:5,curve:6,pairs:7,sex:8,age:9,discipline:10,wholesale:16,public:17},
    ACCIONADO: {image:2,year:3,model:4,color:5,curve:6,pairs:7,sex:8,age:9,discipline:10,wholesale:16,public:17},
    SUELTOS: {image:2,year:3,model:4,color:5,sex:6,age:7,discipline:8,wholesale:9,public:10} };
  for (const [name,map] of Object.entries(maps)) {
    const sheet=book.getWorksheet(name);
    if (!sheet) continue;
    for(const [key,col] of Object.entries(map)) sheet.getColumn(col).hidden=!selected.has(key);
    let col=sheet.getRow(2).cellCount+1;
    if (name !== 'SUELTOS' && ['base','brand','license'].some(key=>selected.has(key))) {
      for(let c=19;c<col;c++) sheet.getColumn(c).hidden=true;
    }
    for(const [key,label,field] of [['base','PRECIO BASE','PRICE_BASE'],['brand','MARCA','MARCA'],['license','LICENCIA','LICENCIA']]) {
      if(!selected.has(key)) continue;
      const c=col++; sheet.getColumn(c).width=key==='base'?19:22;
      const header=sheet.getCell(2,c);header.style=structuredClone(sheet.getCell(2,map.model).style);header.value=label;
      for(const [i,row] of products[name].entries()) {
        const start=row.EXCEL_IMAGE_ROW || i+3, span=row.EXCEL_IMAGE_SPAN || 1;
        for(let offset=0;offset<span;offset++) {
          const cell=sheet.getCell(start+offset,c);cell.style=structuredClone(sheet.getCell(start+offset,map.model).style);
          cell.protection={locked:true};
          cell.value=key==='base' ? (row.EXCEL_BASE_PRICE ?? row.PRICE_BASE ?? Number(row.P_BAS||0)/Number(row.PARES||1)) : (row[field]||'');
          if(key==='base') cell.numFmt='$#,##0.00';
        }
      }
    }
    if(['base','brand','license'].some(key=>selected.has(key))) {
      sheet.unMergeCells('B1');sheet.mergeCells(1,2,1,col-1);
      sheet.pageSetup.printArea='B1:'+sheet.getColumn(col-1).letter+Math.max(3,sheet.rowCount);
    }
  }
}
module.exports={KEYS,DEFAULTS,normalizeColumns,applyColumns};
