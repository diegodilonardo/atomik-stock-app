const fs = require('node:fs/promises');
const path = require('node:path');
const { imageSize } = require('image-size');

function imagePlacement(sheet, rowNumber, dimensions, rowSpan = 1, padding = 4) {
  // Excel column widths are character units; drawing extents use pixels at 96 dpi.
  const width = sheet.getColumn(2).width || 8.43;
  const cellWidth = width < 1 ? Math.floor(width * 12) : Math.floor(width * 7 + 5);
  const cellHeight = Array.from({ length: rowSpan }, (_, i) => (sheet.getRow(rowNumber + i).height || 15) * 96 / 72).reduce((sum, height) => sum + height, 0);
  const scale = Math.min((cellWidth - padding * 2) / dimensions.width, (cellHeight - padding * 2) / dimensions.height);
  const imageWidth = dimensions.width * scale;
  const imageHeight = dimensions.height * scale;
  return {
    tl: { nativeCol: 1, nativeRow: rowNumber - 1,
      nativeColOff: Math.round((cellWidth - imageWidth) / 2 * 9525),
      nativeRowOff: Math.round((cellHeight - imageHeight) / 2 * 9525) },
    ext: { width: imageWidth, height: imageHeight }, editAs: 'oneCell'
  };
}

function imageCandidates(row, company = {}) {
  const values = [row.COD_ANIO, row.COD_TEM, row.MODC, row.COLORC].map(value => String(value ?? '').trim());
  const [year, season, model, color] = values;
  if (!model || !color || values.some(value => value && !/^[A-Za-z0-9_-]{1,30}$/.test(value))) return [];
  // Prefer the more specific season variant when both names exist.
  return [...new Set([
    ...(year && season ? [year + season + model + color] : []),
    ...(year ? [year + model + color] : []),
    ...(['3000','70000'].includes(String(company.CODIGO)) ? [model + color] : [])
  ])];
}

async function loadImageIndex(directory) {
  const index = new Map();
  if (!directory) return index;
  const pending = [''];
  for (let i = 0; i < pending.length; i++) {
    const relative = pending[i];
    const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for (const entry of entries) {
      const filename = path.join(relative, entry.name);
      if (entry.isDirectory()) pending.push(filename);
      else if (entry.isFile() && /\.(jpg|jpeg|png)$/i.test(entry.name) && !index.has(entry.name.toLowerCase()))
        index.set(entry.name.toLowerCase(), filename);
    }
  }
  return index;
}

function findImage(row, index, company = {}) {
  for (const name of imageCandidates(row, company)) {
    for (const extension of ['.jpg', '.jpeg', '.png']) {
      const filename = index.get((name + extension).toLowerCase());
      if (filename) return filename;
    }
  }
  return null;
}

async function embedProductImages(workbook, sheet, rows, directory, index, cache, company = {}, options = {}) {
  for (const [position, row] of rows.entries()) {
    const filename = findImage(row, index, company);
    if (!filename) continue;
    if (!cache.has(filename)) {
      const buffer = await fs.readFile(path.join(directory, filename));
      const extension = /\.png$/i.test(filename) ? 'png' : 'jpeg';
      const embedded = options.optimize
        ? await require('./excel-image-optimizer').optimizeExcelImage(buffer, extension)
        : { buffer, extension };
      // Keep original dimensions for identical cell placement, including padding.
      cache.set(filename, { id: workbook.addImage(embedded), dimensions: imageSize(buffer) });
    }
    const excelRow = row.EXCEL_IMAGE_ROW || position + 3;
    sheet.getCell(excelRow, 2).value = null;
    if (!row.EXCEL_IMAGE_ROW) sheet.getCell(excelRow, 20).value = filename;
    const cached = cache.get(filename);
    sheet.addImage(cached.id, imagePlacement(sheet, excelRow, cached.dimensions, row.EXCEL_IMAGE_SPAN || 1, options.padding ?? 4));
  }
}

module.exports = { imageCandidates, findImage, loadImageIndex, embedProductImages, imagePlacement };
