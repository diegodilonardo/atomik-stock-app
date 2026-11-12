const {compareSizes}=require('../../public/js/fashion-sort');

function groupSingles(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.NIVEL !== 900 || Number(row.STOCK) <= 0) continue;
    // Keep distinct seasons, product identities and prices available in the detail.
    const key = JSON.stringify([row.ID_EMPRESA, row.MARCA, row.LICENCIA, row.RUBRO, row.COD_ANIO, row.COD_TEM,
      row.MODC || row.CODIGO || row.COD_ALFA, row.COLORC || row.DCOLORC,
      row.DMODC, row.DCOLORC, row.SEXO, row.EDAD, row.DISCIPLINA]);
    if (!groups.has(key)) groups.set(key, { ...row, STOCK: 0, SIZES: [], GROUPED_SINGLE: true, POSSIBLE_ACTIONED: false });
    const group = groups.get(key);
    const label = String(row.TALLC || 'Sin talle').trim();
    let size = group.SIZES.find(size => size.label === label);
    if (!size) { size = { label, stock: 0, items: [] }; group.SIZES.push(size); }
    size.stock += Number(row.STOCK);
    size.items.push({ code: row.COD_ALFA, stock: Number(row.STOCK), depot: row.DEPOSITO,
      wholesale: row.PRICE_WHOLESALE, base: row.PRICE_BASE, public: row.PRICE_PUBLIC });
    group.STOCK += Number(row.STOCK);
    group.POSSIBLE_ACTIONED ||= Boolean(row.POSSIBLE_ACTIONED);
    for (const field of ['PRICE_WHOLESALE', 'PRICE_BASE', 'PRICE_PUBLIC']) {
      if (group[field] !== row[field]) group[field] = null;
    }
  }
  for (const group of groups.values()) group.SIZES.sort((a, b) => compareSizes(a.label, b.label));
  return [...groups.values()];
}
function groupStockView(rows) {
  return [...rows.filter(row => row.NIVEL !== 900), ...groupSingles(rows)].sort((a, b) =>
    String(a.DMODC || '').localeCompare(String(b.DMODC || ''), 'es', { numeric: true }) ||
    String(a.DCOLORC || '').localeCompare(String(b.DCOLORC || ''), 'es', { numeric: true }) ||
    Number(b.NIVEL) - Number(a.NIVEL) ||
    String(a.COD_ALFA || '').localeCompare(String(b.COD_ALFA || ''), 'es', { numeric: true }));
}
module.exports = { groupSingles, compareSizes, groupStockView };
