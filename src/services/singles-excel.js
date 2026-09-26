const profile = require('./excel-format.json');
const { compareSizes } = require('./single-stock');

function configureSingles(workbook, products, company) {
  const sheet = workbook.addWorksheet('SUELTOS');
  sheet.properties.tabColor = { argb: 'FF000000' };
  const gray = profile.sheets.MODULOS.rows[2].styles[2].fill;
  for (let c = 1; c <= 16384; c++) sheet.getColumn(c).style = { fill: structuredClone(gray) };
  sheet.getColumn(1).width = 3.7; sheet.getColumn(2).width = 13.85546875;
  sheet.getColumn(3).width = 9;
  for (let c = 5; c <= 11; c++) sheet.getColumn(c).width = c >= 9 ? 19 : 15;
  sheet.getColumn(4).width = 28;
  sheet.views = [{ state: 'frozen', ySplit: 2, zoomScale: 80 }];
  sheet.sheetProtection = structuredClone(profile.sheets.SUELTOS.protection);
  const groups = new Map();
  for (const row of products) {
    if (Number(row.STOCK) <= 0) continue;
    const key = JSON.stringify([row.ID_EMPRESA, row.MARCA, row.LICENCIA, row.RUBRO, row.COD_ANIO, row.COD_TEM,
      row.MODC || row.CODIGO || row.COD_ALFA, row.COLORC || row.DCOLORC,
      row.DMODC, row.DCOLORC, row.SEXO, row.EDAD, row.DISCIPLINA, row.DEPOSITO]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const refs = [], photos = [];
  const subtotals = [];
  let start = 3, maxCol = 12;
  const baseStyle = structuredClone(profile.sheets.SUELTOS.rows[2].styles[2]);
  function cell(r, c, value, green = false) {
    const target = sheet.getCell(r, c);
    target.value = value;
    target.style = structuredClone(baseStyle);
    target.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    target.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    if (green) {
      target.fill = structuredClone(profile.sheets.SUELTOS.rows[2].styles[12].fill);
      target.protection = { locked: false };
    }
    return target;
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => compareSizes(String(a.TALLC || ''), String(b.TALLC || '')) || String(a.COD_ALFA).localeCompare(String(b.COD_ALFA)));
    const first = rows[0];
    const prices = rows.map(row => [Number(row.PRECIO || 0) / Number(row.PARES || 1), row.PRICE_PUBLIC ?? Number(row.PRECIO || 0) / Number(row.PARES || 1) * company.PUBLIC_PRICE_FACTOR]);
    const common = prices.every(p => p.every((v, i) => v === prices[0][i]));
    const width = Math.max(12, rows.length + 11); maxCol = Math.max(maxCol, width);
    for (let c = 12; c <= width; c++) sheet.getColumn(c).width = 11;
    cell(start, 2, 'No Existe la Imagen');
    sheet.getRow(start).height = 24;
    const metadata = [first.COD_ANIO || '—', first.DMODC, first.DCOLORC,
      first.SEXO, first.EDAD, first.DISCIPLINA];
    metadata.forEach((value, i) => cell(start, i + 3, value || '—'));
    for (let i = 0; i < 2; i++) {
      const price = cell(start, 9 + i, common ? prices[0][i] : 'Ver por talle');
      if (common) price.numFmt = '$#,##0.00';
    }
    const bases = rows.map(row => row.PRICE_BASE ?? Number(row.P_BAS || 0) / Number(row.PARES || 1));
    photos.push({ ...first, EXCEL_BASE_PRICE: bases.every(value => value === bases[0]) ? bases[0] : 'Varía según talle', EXCEL_IMAGE_ROW: start, EXCEL_IMAGE_SPAN: common ? 3 : 5 });
    for (const [offset, label] of [[0, 'Talle'], [1, 'Stock (pares)'], [2, 'Pedido (pares)'], ...(!common ? [[3, 'Precio mayorista'], [4, 'Precio público']] : [])]) {
      if (offset) sheet.getRow(start + offset).height = 24;
      cell(start + offset, 11, label).font = { name: 'Calibri', size: 11, bold: true };
    }
    rows.forEach((row, i) => {
      const col = i + 12;
      const size = cell(start, col, String(row.TALLC || 'Sin talle'));
      size.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
      size.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF17365D' } };
      const stock = cell(start + 1, col, Number(row.STOCK));
      const order = cell(start + 2, col, 0, true);
      order.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF245125' } };
      order.dataValidation = { type: 'custom', allowBlank: true, formulae: [`AND(ISNUMBER(${order.address}),${order.address}=INT(${order.address}),${order.address}>=0,${order.address}<=${stock.address})`],
        showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Pedido invalido', error: 'Ingrese un entero entre cero y el stock de este talle.' };
      if (!common) prices[i].forEach((price, j) => { cell(start + 3 + j, col, price).numFmt = '$#,##0.00'; });
      refs.push({ code: String(row.CODIGO || ''), alfa: String(row.COD_ALFA || ''), address: order.address, price: prices[i][0], productRow: start, sizeIndex: i });
    });
    const lastSize = sheet.getColumn(rows.length + 11).letter;
    subtotals.push({ row: start, end: start + (common ? 2 : 4), formula: common
      ? `SUM(L${start + 2}:${lastSize}${start + 2})*I${start}`
      : `SUMPRODUCT(L${start + 2}:${lastSize}${start + 2},L${start + 3}:${lastSize}${start + 3})` });
    // AutoFilter evaluates each physical row. Repeat the product fields so
    // stock/order rows match too. Keep a normal number format: Excel's filter
    // uses displayed values, so a blank (;;;) format hides these rows as blanks.
    for (let col = 2; col <= 10; col++) {
      const firstCell = sheet.getCell(start, col);
      const end = start + (common ? 2 : 4);
      for (let r = start; r <= end; r++) {
        const target = r === start ? firstCell : cell(r, col, firstCell.value);
        if (r !== start) {
          target.numFmt = firstCell.numFmt || 'General';
          target.font = { ...structuredClone(firstCell.font), color: structuredClone(gray.fgColor) };
        }
        target.border = { left: { style: 'thin' }, right: { style: 'thin' },
          ...(r === start ? { top: { style: 'thin' } } : {}),
          ...(r === end ? { bottom: { style: 'thin' } } : {}) };
      }
    }
    start += common ? 3 : 5;
  }
  const subtotalColumn = ++maxCol;
  sheet.getColumn(subtotalColumn).width = 22;
  for (const subtotal of subtotals) {
    const total = cell(subtotal.row, subtotalColumn, { formula: subtotal.formula, result: 0 });
    total.numFmt = '$#,##0.00';
    total.font = { name: 'Calibri', size: 11, bold: true };
    total.protection = { locked: true };
    sheet.mergeCells(subtotal.row, subtotalColumn, subtotal.end, subtotalColumn);
  }
  sheet.mergeCells(1, 2, 1, maxCol);
  const title = sheet.getCell('B1'); title.value = `GRILLA ${company.NOMBRE} SUELTOS - STOCK`;
  title.style = structuredClone(profile.sheets.SUELTOS.rows[0].styles[1]);
  sheet.getRow(1).height = 30;
  const headers = ['IMAGEN', 'AÑO', 'MODELO', 'COLOR', 'SEXO', 'EDAD', 'DISCIPLINA', 'PRECIO MAYORISTA', 'PRECIO PÚBLICO', 'DETALLE'];
  for (let c = 2; c <= maxCol; c++) {
    const header = cell(2, c, c === subtotalColumn ? 'SUBTOTAL' : headers[c - 2] || 'TALLES');
    header.fill = structuredClone(profile.sheets.MODULOS.rows[1].styles[1].fill);
    header.font = structuredClone(profile.sheets.MODULOS.rows[1].styles[1].font);
  }
  sheet.getRow(2).height = 30;
  sheet.autoFilter = { from: 'C2', to: `J${Math.max(3, start - 1)}` };
  // Each horizontal size has its own identifiers; never collapse them to one SKU.
  for (const ref of refs) {
    const codeColumn = maxCol + 1 + ref.sizeIndex * 2;
    for (const [col, header, value] of [[codeColumn, 'CODIGO', ref.code], [codeColumn + 1, 'COD_ALFA', ref.alfa]]) {
      sheet.getColumn(col).hidden = true;
      sheet.getColumn(col).width = 22;
      sheet.getCell(2, col).value = `${header} (talle ${ref.sizeIndex + 1})`;
      const identifier = sheet.getCell(ref.productRow, col);
      identifier.value = value;
      identifier.numFmt = '@';
      identifier.protection = { locked: true };
    }
  }
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: `B1:${sheet.getColumn(maxCol).letter}${Math.max(3, start - 1)}` };
  return { refs, photos };
}
module.exports = { configureSingles };
