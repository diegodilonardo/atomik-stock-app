const ExcelJS = require('exceljs');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { requireFiles } = require('./company-service');
const { loadImageIndex, embedProductImages } = require('./product-images');
const { applyOriginalFormat } = require('./excel-format');

const COLORS = {
  navy: 'FF17365D', blue: 'FF1F4E78', lightBlue: 'FFD9EAF7',
  white: 'FFFFFFFF', gray: 'FFF2F2F2', border: 'FFB7C9D6'
};

function pairDistribution(row) {
  const sizes = ['01','02','03','04','05','06','07','08','10','12','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46','47','48','49','50','_2XL','_3XL','_L','_M','_S','_XL','_XS'];
  return sizes.map((size) => Number(row[`T${size}`] || 0)).filter((qty) => qty > 0).join(',');
}

function curveLabel(row) {
  const text = String(row.DTALLC || '');
  const numbers = text.match(/\d+/g) || [];
  return numbers.length >= 2 ? `${numbers[0]}-${numbers[1]}` : (row.TALLC || text);
}

function baseRow(row, isModule, factor) {
  const pairs = Number(row.PARES || 1);
  const wholesale = Number(row.PRECIO || 0) / pairs;
  return [
    'No Existe la Imagen', String(row.COD_ALFA || '').slice(0, 2), row.DMODC, row.DCOLORC,
    isModule ? curveLabel(row) : row.TALLC,
    isModule ? pairDistribution(row) : '1', row.SEXO, row.EDAD, row.DISCIPLINA || '',
    row.CODIGO, row.COD_ALFA, 0, Number(row.STOCK), null,
    wholesale, row.PRICE_PUBLIC ?? wholesale * factor, null,
    Number(row.PRECIO), '', pairs
  ];
}

function configureSheet(sheet, title, tableName, rows, isModule, includeDiscount, factor) {
  const headers = ['IMAGEN','AÑO','MODELO','COLOR',isModule ? 'CURVA' : 'TALLE','PARES POR TALLE',
    'SEXO','EDAD','DISCIPLINA','CODIGO','CODIGO ALFA','PEDIDO','STOCK','TOTAL PARES',
    'PRECIO MAYORISTA','PRECIO PUBLICO','SUBTOTAL','PRECIO','NOMBRE IMAGEN','PARES'];
  if (includeDiscount) headers.push('DESCUENTO_ESPECIAL');

  sheet.mergeCells(1, 2, 1, includeDiscount ? 22 : 21);
  const titleCell = sheet.getCell('B1');
  titleCell.value = title;
  titleCell.font = { bold: true, color: { argb: COLORS.white }, size: 16 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  sheet.getRow(1).height = 30;

  const tableRows = rows.map((row) => {
    const values = baseRow(row, isModule, factor);
    if (includeDiscount) values.push(Number(row.DTOESP || 0));
    return values;
  });
  if (tableRows.length === 0) tableRows.push(new Array(headers.length).fill(null));

  sheet.addTable({
    name: tableName,
    ref: 'B2',
    headerRow: true,
    totalsRow: false,
    style: { theme: 'TableStyleLight15', showRowStripes: true },
    columns: headers.map((name) => ({ name })),
    rows: tableRows
  });

  const endRow = 2 + tableRows.length;
  for (let rowNumber = 3; rowNumber <= endRow; rowNumber += 1) {
    sheet.getRow(rowNumber).height = 69;
    sheet.getCell(rowNumber, 15).value = { formula: `M${rowNumber}*U${rowNumber}`, result: 0 };
    sheet.getCell(rowNumber, 18).value = { formula: `M${rowNumber}*U${rowNumber}*P${rowNumber}`, result: 0 };
    sheet.getCell(rowNumber, 13).dataValidation = {
      type: 'custom', allowBlank: true,
      formulae: [`AND(ISNUMBER(M${rowNumber}),M${rowNumber}=INT(M${rowNumber}),M${rowNumber}>=0,M${rowNumber}<=MAX(0,$N${rowNumber}))`],
      errorStyle: 'stop', showErrorMessage: true, errorTitle: 'Pedido invalido',
      error: 'Ingrese un numero entero entre cero y el stock disponible de esta fila.',
      showInputMessage: true, promptTitle: 'Cantidad a pedir',
      prompt: 'El pedido no puede superar el stock. Para modulos, ingrese cantidad de modulos.'
    };
    for (let col = 2; col <= (includeDiscount ? 22 : 21); col += 1) {
      const cell = sheet.getCell(rowNumber, col);
      cell.alignment = { vertical: 'middle', horizontal: col === 4 ? 'left' : 'center', wrapText: true };
      cell.border = {
        bottom: { style: 'thin', color: { argb: COLORS.border } }
      };
    }
    for (const col of [14, 15, 21]) sheet.getCell(rowNumber, col).numFmt = '#,##0';
    for (const col of [16, 17, 18, 19]) sheet.getCell(rowNumber, col).numFmt = '$#,##0.00';
  }

  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 2, topLeftCell: 'B3', activeCell: 'B3' }];
  const widths = [3.7,13.9,10.9,22.3,16.7,16.6,15.7,11,16,16.3,15.7,15.7,12.3,12.2,18.2,22.7,22.7,22.7,19.4,12,21,16];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getColumn(11).hidden = true;
  sheet.getColumn(12).hidden = true;
  sheet.getColumn(19).hidden = true;
  sheet.getColumn(20).hidden = true;
  sheet.getColumn(21).hidden = true;
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function configureSummary(sheet) {
  sheet.getColumn('C').width = 18.3; sheet.getColumn('D').width = 11;
  sheet.getColumn('E').width = 34; sheet.getColumn('F').width = 14.5; sheet.getColumn('G').width = 47.5;
  sheet.mergeCells('D2:E2'); sheet.mergeCells('D3:E3');
  sheet.getCell('C2').value = 'CLIENTE'; sheet.getCell('F2').value = 'SUCURSAL';
  sheet.getCell('C3').value = 'OBSERVACION'; sheet.getCell('F3').value = 'CODIGO SUCURSAL';
  for (const cell of ['C2','F2','C3','F3']) {
    sheet.getCell(cell).font = { bold: true, color: { argb: COLORS.white } };
    sheet.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blue } };
    sheet.getCell(cell).alignment = { vertical: 'middle', horizontal: 'center' };
  }
  for (const cell of ['D2','G2','D3','G3']) {
    sheet.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightBlue } };
    sheet.getCell(cell).border = { bottom: { style: 'thin', color: { argb: COLORS.blue } } };
  }
  const summary = [
    ['LÍNEA','SKU ','CANTIDAD DE MODULOS ','PARES','IMPORTE'],
    ['MODULOS','=COUNTIF(MODULOS!M:M,">0")','=SUM(MODULOS!M:M)','=SUM(MODULOS!O:O)','=SUM(MODULOS!R:R)'],
    ['ACCIONADO','=COUNTIF(ACCIONADO!M:M,">0")','=SUM(ACCIONADO!M:M)','=SUM(ACCIONADO!O:O)','=SUM(ACCIONADO!R:R)'],
    ['SUELTOS','=COUNTIF(SUELTOS!M:M,">0")','NO APLICA','=SUM(SUELTOS!O:O)','=SUM(SUELTOS!R:R)'],
    ['TOTAL ','=SUM(D6:D8)','=SUM(E6:E8)','=SUM(F6:F8)','=SUM(G6:G8)']
  ];
  summary.forEach((values, index) => {
    const row = 5 + index;
    values.forEach((value, colIndex) => {
      const cell = sheet.getCell(row, 3 + colIndex);
      if (typeof value === 'string' && value.startsWith('=')) cell.value = { formula: value.slice(1), result: 0 };
      else cell.value = value;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: COLORS.border } }, bottom: { style: 'thin', color: { argb: COLORS.border } } };
    });
  });
  for (const cell of sheet.getRow(5).eachCell ? ['C5','D5','E5','F5','G5'] : []) {
    sheet.getCell(cell).font = { bold: true, color: { argb: COLORS.white } };
    sheet.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  }
  for (const cell of ['C9','D9','E9','F9','G9']) sheet.getCell(cell).font = { bold: true };
  for (const cell of ['G6','G7','G8','G9']) sheet.getCell(cell).numFmt = '$#,##0.00';
  sheet.getCell('H9').value = '+ IVA';
  sheet.getCell('H9').font = { bold: true };
}

async function buildWorkbook(company, rows = null, excelColumns) {
  if (!Number.isInteger(company?.ID_EMPRESA)) throw new Error('Empresa invalida');
  const data = rows || (await require('./stock-rules').queryStock(company, {})).data;
  if (data.some(row => row.ID_EMPRESA !== company.ID_EMPRESA)) throw new Error('El Excel contiene datos de otra empresa');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `Gestion Stock - ${company.NOMBRE}`;
  workbook.created = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const modules = data.filter((row) => row.NIVEL === 950 && row.WEB_CLASSIFICATION !== 'ACCIONADO');
  const actioned = data.filter((row) => row.NIVEL === 950 && row.WEB_CLASSIFICATION === 'ACCIONADO');
  const singles = data.filter((row) => row.NIVEL === 900 && Number(row.STOCK) > 0);
  if (modules.length) configureSheet(workbook.addWorksheet('MODULOS'), `GRILLA ${company.NOMBRE} MODULOS - STOCK`, 'MODULOS', modules, true, false, company.PUBLIC_PRICE_FACTOR);
  if (actioned.length) configureSheet(workbook.addWorksheet('ACCIONADO'), `GRILLA ${company.NOMBRE} ACCIONADO - STOCK`, 'FUERA_DE_LINEA', actioned, true, false, company.PUBLIC_PRICE_FACTOR);
  const horizontal = singles.length
    ? require('./singles-excel').configureSingles(workbook, singles, company)
    : { refs: [], photos: [] };
  configureSummary(workbook.addWorksheet('RESUMEN'));
  const order = workbook.addWorksheet('PEDIDO');
  order.addRow(['CODIGO', 'COD_ALFA', 'CANTIDAD']);
  const consolidated = workbook.addWorksheet('CONSOLIDADO', { state: 'hidden' });
  let targetRow = 1;
  for (const [name, products] of [['MODULOS', modules], ['ACCIONADO', actioned]]) {
    for (let i = 0; i < products.length; i++, targetRow++) {
      for (const [col, sourceCol] of [[1, 'K'], [2, 'L'], [3, 'M']]) {
        consolidated.getCell(targetRow, col).value = {
          formula: `IF('${name}'!M${i + 3}>0,'${name}'!${sourceCol}${i + 3},0)`, result: 0
        };
      }
    }
  }
  const singlesStart = targetRow;
  for (const ref of horizontal.refs) {
    consolidated.getCell(targetRow, 1).value = ref.code;
    consolidated.getCell(targetRow, 2).value = ref.alfa;
    consolidated.getCell(targetRow, 3).value = { formula: "'SUELTOS'!" + ref.address, result: 0 };
    consolidated.getCell(targetRow, 4).value = { formula: 'C' + targetRow + '*' + ref.price, result: 0 };
    targetRow++;
  }
  const lastOrderRow = Math.max(1, targetRow - 1);
  const summary = workbook.getWorksheet('RESUMEN');
  for (const [address, expression] of [['D8', 'COUNTIF(CONSOLIDADO!C' + singlesStart + ':C' + Math.max(singlesStart, targetRow - 1) + ',">0")'], ['F8', 'SUM(CONSOLIDADO!C' + singlesStart + ':C' + Math.max(singlesStart, targetRow - 1) + ')'], ['G8', 'SUM(CONSOLIDADO!D' + singlesStart + ':D' + Math.max(singlesStart, targetRow - 1) + ')']]) {
    summary.getCell(address).value = { formula: horizontal.refs.length ? expression : '0', result: 0 };
  }
  // Use ordinary formulas: a FILTER spill is not reliably preserved by all
  // Excel versions/readers. Rank requested items and look up each complete row.
  for (let row = 1; row < targetRow; row++) {
    consolidated.getCell(row, 5).value = { formula: `${row === 1 ? '0' : `E${row - 1}`}+IF(C${row}>0,1,0)`, result: 0 };
    consolidated.getCell(row, 6).value = { formula: `IF(C${row}>0,E${row},0)`, result: 0 };
    const outputRow = row + 1;
    order.getCell(outputRow, 4).value = {
      formula: `IF(${row}<='CONSOLIDADO'!$E$${lastOrderRow},MATCH(${row},'CONSOLIDADO'!$F$1:$F$${lastOrderRow},0),"")`, result: ''
    };
    for (const col of ['A', 'B', 'C']) order.getCell(`${col}${outputRow}`).value = {
      formula: `IF($D${outputRow}="","",INDEX('CONSOLIDADO'!$${col}$1:$${col}$${lastOrderRow},$D${outputRow}))`, result: ''
    };
  }
  applyOriginalFormat(workbook);
  for (const [name, rowNumber] of [['MODULOS', 6], ['ACCIONADO', 7], ['SUELTOS', 8]]) {
    if (workbook.getWorksheet(name)) continue;
    // Keep the original summary coordinates and total ranges, without dangling
    // sheet references. Hide the unused category and contribute zero to totals.
    for (const column of ['C', 'D', 'E', 'F', 'G']) {
      summary.getCell(`${column}${rowNumber}`).value = column === 'C' ? null : 0;
    }
    summary.getRow(rowNumber).hidden = true;
  }
  workbook.getWorksheet('PEDIDO').getColumn(4).hidden = true;
  const index = excelColumns && !excelColumns.includes('image') ? new Map() : await loadImageIndex(company.IMAGE_DIRECTORY);
  const imageCache = new Map();
  for (const [sheet, rows] of [['MODULOS', modules], ['ACCIONADO', actioned], ['SUELTOS', horizontal.photos]]) {
    if (!workbook.getWorksheet(sheet) || (excelColumns && !excelColumns.includes('image'))) continue;
    await embedProductImages(workbook, workbook.getWorksheet(sheet), rows, company.IMAGE_DIRECTORY, index, imageCache, company);
  }
  require('./excel-columns').applyColumns(workbook, excelColumns, { MODULOS: modules, ACCIONADO: actioned, SUELTOS: horizontal.photos });
  return workbook;
}

async function replaceSharedExcel(company, rows = null, excelColumns) {
  requireFiles(company);
  const outputDirectory = path.win32.dirname(company.EXCEL_PATH);
  await fs.mkdir(outputDirectory, { recursive: true });
  const target = company.EXCEL_PATH;
  const suffix = crypto.randomUUID();
  const temp = path.join(outputDirectory, `.~atomik-${suffix}.xlsx`);
  const backup = `${target}.bak`;
  const workbook = await buildWorkbook(company, rows, excelColumns);
  await workbook.xlsx.writeFile(temp);
  let hadTarget = false;
  try {
    await fs.access(target);
    hadTarget = true;
    await fs.rm(backup, { force: true });
    await fs.rename(target, backup);
    await fs.rename(temp, target);
    await fs.rm(backup, { force: true });
  } catch (error) {
    if (!hadTarget && error.code === 'ENOENT') await fs.rename(temp, target);
    else {
      try { await fs.access(backup); await fs.rename(backup, target); } catch {}
      try { await fs.rm(temp, { force: true }); } catch {}
      throw error;
    }
  }
  return target;
}

module.exports = { buildWorkbook, replaceSharedExcel, pairDistribution, curveLabel };
