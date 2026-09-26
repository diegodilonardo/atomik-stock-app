const profile = require('./excel-format.json');
const clone = value => value == null ? value : structuredClone(value);

// Formatting extracted from the user's original workbook, without its stock data.
function applyOriginalFormat(workbook) {
  // Preserve worksheet merges and drawing anchors when applying the reference theme.
  workbook._themes = clone(profile.themes);
  for (const sheet of workbook.worksheets) {
    const source = profile.sheets[sheet.name];
    if (!source || sheet.name === 'SUELTOS') continue;
    sheet.properties = clone(source.properties);
    sheet.pageSetup = clone(source.pageSetup);
    sheet.headerFooter = clone(source.headerFooter);
    sheet.views = clone(source.views);
    sheet.sheetProtection = clone(source.protection);
    const end = sheet.rowCount;
    for (const merge of [...sheet.model.merges]) sheet.unMergeCells(merge);
    for (const merge of source.merges) sheet.mergeCells(merge);
    source.columns.forEach((column, i) => {
      Object.assign(sheet.getColumn(i + 1), clone(column));
    });
    // Assign the style directly: Column.fill applies to every existing row and
    // materializes empty cells (16,384 columns x thousands of stock rows).
    // A column style serializes as a compact default without creating cells.
    const background = profile.sheets.MODULOS.rows[2].styles[2].fill;
    for (let col = 1; col <= 16384; col++) {
      const column = sheet.getColumn(col);
      column.style = { ...column.style, fill: clone(background) };
    }
    for (let row = 1; row <= end; row++) {
      const format = source.rows[Math.min(row - 1, source.rows.length - 1)];
      sheet.getRow(row).height = format.height;
      format.styles.forEach((style, col) => { sheet.getCell(row, col + 1).style = clone(style); });
    }
  }
}

module.exports = { applyOriginalFormat };
