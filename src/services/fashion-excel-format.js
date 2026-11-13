const crypto = require('node:crypto');
const profile = require('./excel-format.json');
const clone = value => structuredClone(value);
function borderRange(sheet, firstRow, lastRow, firstCol, lastCol) {
  for (let r = firstRow; r <= lastRow; r++) for (let c = firstCol; c <= lastCol; c++) {
    sheet.getCell(r,c).border = Object.fromEntries(['top','bottom','left','right'].map(side =>
      [side, { style:'thin', color:{argb:'FF666666'} }]));
  }
}

function configureFashionSummary(workbook, counts) {
  const sheet = workbook.addWorksheet('RESUMEN');
  const reference = profile.sheets.RESUMEN;
  sheet.properties = clone(reference.properties);
  reference.columns.forEach((column, i) => Object.assign(sheet.getColumn(i + 1), clone(column)));
  for (const merge of reference.merges) sheet.mergeCells(merge);
  // Allocate one summary row per category.
  const categories = (counts.tabOrder || Object.keys(counts)).filter(category=>counts[category] > 0);
  const totalRow = 6 + categories.length;
  for (let row = 1; row <= totalRow; row++) {
    const source = reference.rows[row === totalRow ? 8 : Math.min(row - 1, 7)];
    sheet.getRow(row).height = source.height;
    source.styles.forEach((style, i) => { sheet.getCell(row, i + 1).style = clone(style); });
  }
  for (const [address, value] of Object.entries({C2:'CLIENTE',F2:'SUCURSAL',C3:'OBSERVACION',F3:'CODIGO SUCURSAL',
    C5:'LÍNEA',D5:'SKU',E5:'CANTIDAD DE MÓDULOS',F5:'PARES',G5:'IMPORTE'})) sheet.getCell(address).value = value;
  sheet.getCell(totalRow, 3).value = 'TOTAL';
  sheet.getCell(totalRow, 8).value = '+ IVA';
  categories.forEach((category, i) => {
    const row = i + 6, end = counts[category] + 2;
    sheet.getCell(row, 3).value = category;
    sheet.getCell(row, 3).alignment = { ...sheet.getCell(row, 3).alignment, wrapText:true };
    if (category.length > 16) sheet.getRow(row).height = Math.max(sheet.getRow(row).height || 0, 42);
    const formulas = [
      `COUNTIF('${category.replace(/'/g,"''")}'!N3:N${end},">0")`,
      `SUM('${category.replace(/'/g,"''")}'!N3:N${end})`,
      `SUMPRODUCT('${category.replace(/'/g,"''")}'!K3:K${end},'${category.replace(/'/g,"''")}'!N3:N${end})`,
      `SUM('${category.replace(/'/g,"''")}'!O3:O${end})`
    ];
    formulas.forEach((formula, j) => {
      sheet.getCell(row, j + 4).value = counts[category] ? { formula, result: 0 } : 0;
    });
  });
  for (const col of ['D','E','F','G']) sheet.getCell(`${col}${totalRow}`).value = { formula: `SUM(${col}6:${col}${totalRow - 1})`, result: 0 };
  sheet.views = [{ showGridLines: false }];
  sheet.pageSetup = { orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:1, printArea:`C2:H${totalRow}` };
  borderRange(sheet,2,3,3,7);
  borderRange(sheet,5,totalRow,3,7);
  return sheet;
}

async function formatAndProtectFashion(workbook, counts, protectExcel = true) {
  workbook._themes = clone(profile.themes);
  const reference = profile.sheets.MODULOS;
  // Map each Moda column to its equivalent style in the stock grid.
  const columns = [1,2,2,3,4,5,7,8,9,20,15,16,12,17,10,11,20,20];
  for (const category of (counts.tabOrder || Object.keys(counts))) {
    const sheet = workbook.getWorksheet(category);
    if (!sheet) continue;
    for (let row = 1; row <= counts[category] + 2; row++) {
      const source = reference.rows[Math.min(row - 1, 2)];
      sheet.getRow(row).height = source.height;
      columns.forEach((sourceColumn, i) => {
        sheet.getCell(row, i + 2).style = clone(source.styles[sourceColumn]);
      });
    }
    if (counts[category]) {
      const total = counts[category] + 3;
      sheet.getCell(total, 14).value = { formula:`SUM(N3:N${total - 1})`, result:0 };
      for (let col = 2; col <= 15; col++) {
        sheet.getCell(total, col).style = clone(profile.sheets.RESUMEN.rows[8].styles[col === 15 ? 6 : 3]);
      }
      sheet.getCell(total,19).style = clone(profile.sheets.RESUMEN.rows[8].styles[3]);
      sheet.getCell(total,19).numFmt = '0';
      sheet.getRow(total).height = 32;
    }
    for (let r=3; r<=counts[category]+2; r++) sheet.getCell(r,19).numFmt='0';
    sheet.pageSetup = { orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0,
      printTitlesRow:'1:2', printArea:`B1:S${counts[category] ? counts[category] + 3 : 3}` };
    sheet.views = [{ state:'frozen', ySplit:2, showGridLines:false }];
    // Apply after the reference styles, which otherwise remove product borders.
    borderRange(sheet,2,counts[category] ? counts[category]+3 : 3,2,19);
  }
  configureFashionSummary(workbook, counts);
  require('./fashion-order').configureFashionOrder(workbook, counts);
  const password = process.env.FASHION_EXCEL_PASSWORD || crypto.randomBytes(24).toString('hex');
  for (const sheet of workbook.worksheets) {
    sheet.eachRow(row => row.eachCell(cell => { cell.protection = { locked:true }; }));
    if (Object.hasOwn(counts,sheet.name)) {
      for (let row = 3; row <= counts[sheet.name] + 2; row++) sheet.getCell(row, 14).protection = { locked:false };
    }
    if (protectExcel) await sheet.protect(password, { selectLockedCells:true, selectUnlockedCells:true,
      autoFilter:true, formatCells:false, formatColumns:false, formatRows:false,
      insertColumns:false, insertRows:false, deleteColumns:false, deleteRows:false,
      sort:false, objects:false, scenarios:false });
  }
}

module.exports = { formatAndProtectFashion };
