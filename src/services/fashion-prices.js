const text = value => String(value ?? '').trim().toUpperCase();
const licenseName = value => text(value) === 'SIN LICENCIA' ? '' : text(value);

function applyFashionPrices(products, company, rules) {
  return products.map(product => {
    const brand = text(product.DMARCA), license = licenseName(product.LICENCIAS), rubro = text(product.RUBRO);
    const level = Number(product.NIVEL || 950), list = text(product.LISTA);
    const candidates = rules.filter(rule => text(rule.MARCA) === brand && Number(rule.NIVEL) === level);
    const exact = rule => Boolean(rule.ESPECIFICO) && licenseName(rule.LICENCIA) === license && text(rule.RUBRO) === rubro;
    const general = rule => !rule.ESPECIFICO;
    const find = (priceList, predicate) => candidates.find(rule => text(rule.LISTA) === priceList && predicate(rule));
    const matched = (list && (find(list,exact) || find(list,general))) || find('',exact) || find('',general);
    const factor = Number(matched?.FACTOR ?? company.PUBLIC_PRICE_FACTOR);
    if (!Number.isFinite(factor) || factor <= 0) throw new Error('Configure un coeficiente de precio público válido para la empresa.');
    const pairs = Number(product.PARES);
    if (!Number.isInteger(pairs) || pairs <= 0) throw Object.assign(new Error(`El producto ${product.COD_ALFA || product.CODIGO || ''} no tiene una cantidad válida de pares por módulo.`), {status:400});
    const wholesale = Number(product.PRECIO) / pairs;
    return { ...product, PRICE_WHOLESALE:wholesale, PUBLIC_PRICE_FACTOR:factor,
      PRICE_PUBLIC:Math.round((wholesale * factor + Number.EPSILON)*10000)/10000 };
  });
}

async function priceFashionProducts(products, company) {
  const {sql,getPool} = require('../db/pool');
  const pool = await getPool();
  const result = await pool.request().input('company',sql.Int,company.ID_EMPRESA)
    .query('SELECT MARCA,NIVEL,FACTOR,ESPECIFICO,LICENCIA,RUBRO,LISTA FROM dbo.COMPANY_PRICE_FACTORS WHERE ID_EMPRESA=@company');
  return applyFashionPrices(products,company,result.recordset);
}
module.exports = { applyFashionPrices, priceFashionProducts };
