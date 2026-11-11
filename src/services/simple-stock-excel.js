const ExcelJS = require('exceljs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { imageSize } = require('image-size');
const { loadImageIndex, findImage } = require('./product-images');

async function buildSimpleStock(company, rows) {
  if (!Number.isInteger(company?.ID_EMPRESA) || rows.some(row => row.ID_EMPRESA !== company.ID_EMPRESA)) throw new Error('Empresa invalida');
  const book = new ExcelJS.Workbook();
  book.creator = 'Gestion Stock';
  const sheet = book.addWorksheet('STOCK');
  const border = () => Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side =>
    [side, { style: 'thin', color: { argb: 'FFBCCAD6' } }]));
  sheet.columns = [
    { header: 'IMAGEN', width: 16 }, { header: 'MODELO', width: 32 },
    { header: 'COLOR', width: 25 }, { header: 'CURVA / TALLE', width: 35 },
    { header: 'STOCK', width: 14 }, { header: 'PRECIO MAYORISTA', width: 24 }
  ];
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).height = 30;
  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = border();
  });
  sheet.getCell('E1').note = 'Módulos: cantidad de módulos disponibles. Sueltos: cantidad de pares disponibles.';
  sheet.getCell('F1').note = 'Precio mayorista por par de la lista seleccionada.';
  const index = await loadImageIndex(company.IMAGE_DIRECTORY);
  const images = new Map();
  for (const item of rows) {
    const row = sheet.addRow(['Sin imagen', item.DMODC || '', item.DCOLORC || '',
      (item.NIVEL === 950 ? item.DTALLC : item.TALLC) || '', Number(item.STOCK || 0),
      item.PRICE_WHOLESALE ?? (Number(item.PARES) > 0 ? Number(item.PRECIO) / Number(item.PARES) : null)]);
    row.height = 66;
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: 'Calibri', size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = border();
    });
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).numFmt = '$#,##0.00';
    const filename = findImage(item, index, company);
    if (!filename) continue;
    if (!images.has(filename)) {
      const buffer = await fs.readFile(path.join(company.IMAGE_DIRECTORY, filename));
      images.set(filename, { id: book.addImage({ buffer, extension: /\.png$/i.test(filename) ? 'png' : 'jpeg' }), dimensions: imageSize(buffer) });
    }
    const { id, dimensions } = images.get(filename);
    const cellWidth = 117, cellHeight = 88, padding = 12;
    const scale = Math.min((cellWidth - padding * 2) / dimensions.width, (cellHeight - padding * 2) / dimensions.height);
    const width = dimensions.width * scale, height = dimensions.height * scale;
    row.getCell(1).value = null;
    sheet.addImage(id, { tl: { nativeCol: 0, nativeRow: row.number - 1,
      nativeColOff: Math.round((cellWidth - width) / 2 * 9525), nativeRowOff: Math.round((cellHeight - height) / 2 * 9525) },
      ext: { width, height }, editAs: 'oneCell' });
  }
  sheet.autoFilter = `A1:F${Math.max(1, sheet.rowCount)}`;
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
  return book;
}
module.exports = { buildSimpleStock };
