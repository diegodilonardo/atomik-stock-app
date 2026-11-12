const ExcelJS = require('exceljs');
const { create } = require('../../public/js/fashion-sort');
const { CATEGORIES, validateSelection } = require('./fashion-master');
const { loadImageIndex, embedProductImages } = require('./product-images');

async function buildFashionWorkbook(company, selection, products) {
  const valid = validateSelection(selection, products);
  const compare = create(valid.sort);
  const byId = new Map(products.map(p => [p.id, p]));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gestión Stock';
  workbook.calcProperties.fullCalcOnLoad = true;
  let index = new Map();
  if (company.IMAGE_DIRECTORY && valid.columns.includes('image')) index = await loadImageIndex(company.IMAGE_DIRECTORY);
  const cache = new Map();
  const counts = {};
  for (const category of CATEGORIES) {
    const rows = valid.items.filter(item => item.category === category).map(item => byId.get(item.id)).sort(compare);
    counts[category] = rows.length;
    if (!rows.length) continue;
    const sheet = workbook.addWorksheet(category, { properties: { tabColor: { argb: 'FF111111' } } });
    sheet.columns = [3,16,9,13,26,22,28,10,14,20,12,19,19,13,19,18,22,12,16].map(width => ({ width }));
    sheet.mergeCells('B1:S1');
    sheet.getCell('B1').value = `${valid.name} · ${category}`;
    sheet.getCell('B1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('B1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };
    sheet.getCell('B1').alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 32;
    const headers = ['IMAGEN','AÑO','TEMPORADA','MODELO','COLOR','CURVA / TALLE','SEXO','EDAD','DISCIPLINA','PARES','PRECIO MAYORISTA','PRECIO PÚBLICO','PEDIDO','SUBTOTAL','CODIGO','COD_ALFA','STOCK','TOTAL DE PARES'];
    headers.forEach((title, i) => {
      const cell = sheet.getCell(2, i + 2); cell.value = title;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    sheet.getRow(2).height = 30;
    rows.forEach((product, i) => {
      const r = i + 3;
      const values = ['Sin imagen',product.COD_ANIO,product.DCOD_TEM,product.DMODC,product.DCOLORC,product.DTALLC || product.TALLC,
        product.SEXO,product.EDAD,product.DISCIPLINA,product.PARES,product.PRICE_WHOLESALE,product.PRICE_PUBLIC,0,{ formula: `ROUND(L${r}*K${r}*N${r},2)`, result: 0 },product.CODIGO,product.COD_ALFA,product.STOCK ?? null,{ formula: `N${r}*K${r}`, result:0 }];
      sheet.getRow(r).height = 69;
      values.forEach((value, c) => {
        const cell = sheet.getCell(r, c + 2); cell.value = value;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = Object.fromEntries(['top','bottom','left','right'].map(side => [side,{ style:'thin',color:{argb:'FFD6DEE6'} }]));
      });
      sheet.getCell(r, 14).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEFD5' } };
      sheet.getCell(r, 14).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: true,
        showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Pedido inválido', error: 'Ingrese una cantidad entera mayor o igual a cero.' };
      for (const col of [12,13,15]) sheet.getCell(r, col).numFmt = '$ #,##0.00';
    });
    sheet.getColumn(16).hidden = false; sheet.getColumn(17).hidden = false;
    sheet.views = [{ state: 'frozen', ySplit: 2 }];
    if (rows.length) {
      sheet.autoFilter = { from: 'B2', to: `S${rows.length + 2}` };
      const total = rows.length + 3;
      sheet.getCell(total, 13).value = 'TOTAL';
      sheet.getCell(total, 15).value = { formula: `SUM(O3:O${total - 1})`, result: 0 };
      sheet.getCell(total, 19).value = { formula: `SUM(S3:S${total - 1})`, result:0 };
      sheet.getCell(total, 15).numFmt = '$ #,##0.00';
      sheet.getRow(total).font = { bold: true };
      await embedProductImages(workbook, sheet, rows.map((row, i) => ({ ...row, EXCEL_IMAGE_ROW: i + 3 })), company.IMAGE_DIRECTORY, index, cache, company, { optimize:true, padding:10 });
    } else sheet.getCell('B3').value = 'Sin productos asignados';
  }
  await require('./fashion-excel-format').formatAndProtectFashion(workbook, counts, valid.protectExcel);
  const defaultColumns = require('../../public/js/fashion-columns').defaults;
  if (valid.columnOrder.some((key,i)=>key!==defaultColumns[i]) || valid.excludedColumns.length || valid.columns.length !== defaultColumns.length || valid.columns.some((key,i)=>key!==defaultColumns[i])) {
    require('./fashion-layout').applyFashionLayout(workbook, valid.columns, counts, valid.excludedColumns, valid.columnOrder);
  }
  return workbook;
}
module.exports = { buildFashionWorkbook };
