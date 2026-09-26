const { sql, getPool } = require('../db/pool');

function invalid(message) { return Object.assign(new Error(message), { status: 400 }); }

function normalizeRules(input = {}, strict = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Reglas invalidas');
  const allowed = ['excelColumns', 'brand', 'priceList', 'license', 'rubro', 'year', 'season', 'level', 'type', 'search', 'positiveStock', 'actioned'];
  if (strict && Object.keys(input).some(key => !allowed.includes(key))) throw invalid('La grilla contiene una regla no admitida');
  const result = {};
  if (input.excelColumns !== undefined) {
    let columns = input.excelColumns;
    if (!strict && typeof columns === 'string') { try { columns = JSON.parse(columns); } catch { throw invalid('Columnas de Excel invalidas'); } }
    result.excelColumns = require('./excel-columns').normalizeColumns(columns);
  }
  if (input.priceList !== undefined && input.priceList !== '') {
    let pair;
    try { pair = JSON.parse(input.priceList); } catch { throw invalid('Lista de precios invalida'); }
    if (typeof input.priceList !== 'string' || !Array.isArray(pair) || pair.length !== 2 || pair.some(x => typeof x !== 'string' || !x.trim() || x.length > 30)) throw invalid('Lista de precios invalida');
    result.priceList = JSON.stringify(pair);
  }
  for (const [key, maxLength] of [['brand', 150], ['license', 150], ['rubro', 40], ['year', 30], ['season', 30], ['level', 3]]) {
    const value = input[key];
    const values = value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value];
    if (values.length > 100 || values.some(item => typeof item !== 'string' || !item.trim() || item.trim().length > maxLength)) throw invalid(`Filtro ${key} invalido`);
    result[key] = [...new Set(values.map(item => item.trim()))];
  }
  if (result.level.some(level => !['900', '950'].includes(level))) throw invalid('Tipo de producto invalido');
  result.type = input.type ?? '';
  if (!['', 'MODULOS', 'ACCIONADO', 'SUELTOS'].includes(result.type)) throw invalid('Clasificacion invalida');
  if (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) throw invalid('Busqueda invalida');
  result.actioned = input.actioned ?? '';
  if (!['', 'confirmed', 'possible', 'unconfirmed'].includes(result.actioned)) throw invalid('Filtro accionado invalido');
  result.search = (input.search || '').trim();
  if (![undefined, false, true, 'false', 'true', '0', '1'].includes(input.positiveStock)) throw invalid('Regla de stock invalida');
  result.positiveStock = [true, 'true', '1'].includes(input.positiveStock);
  return result;
}

const CLASSIFICATION = "CASE WHEN S.NIVEL=950 THEN COALESCE(C.CLASSIFICATION,'MODULOS') WHEN S.NIVEL=900 THEN 'SUELTOS' ELSE 'SIN_CLASIFICAR' END";
const FROM_WHERE = `FROM dbo.STOCK_CURRENT S
  LEFT JOIN dbo.COMPANY_PRICE_FACTORS FCTR ON FCTR.ID_EMPRESA=S.ID_EMPRESA
    AND FCTR.MARCA=COALESCE(S.MARCA,N'') AND FCTR.NIVEL=S.NIVEL AND FCTR.ESPECIFICO=0 AND FCTR.LISTA=N''
  LEFT JOIN dbo.COMPANY_PRICE_FACTORS EXACT_FACTOR ON EXACT_FACTOR.ID_EMPRESA=S.ID_EMPRESA
    AND EXACT_FACTOR.MARCA=COALESCE(S.MARCA,N'') AND EXACT_FACTOR.NIVEL=S.NIVEL AND EXACT_FACTOR.ESPECIFICO=1
    AND EXACT_FACTOR.LICENCIA=COALESCE(S.LICENCIA,N'') AND EXACT_FACTOR.RUBRO=S.RUBRO AND EXACT_FACTOR.LISTA=N''
  LEFT JOIN dbo.COMPANY_PRICE_FACTORS LIST_EXACT ON LIST_EXACT.ID_EMPRESA=S.ID_EMPRESA
    AND LIST_EXACT.MARCA=COALESCE(S.MARCA,N'') AND LIST_EXACT.NIVEL=S.NIVEL AND LIST_EXACT.ESPECIFICO=1
    AND LIST_EXACT.LICENCIA=COALESCE(S.LICENCIA,N'') AND LIST_EXACT.RUBRO=S.RUBRO
    AND LIST_EXACT.LISTA=@priceList AND @priceList<>N''
  LEFT JOIN dbo.COMPANY_PRICE_FACTORS LIST_BRAND ON LIST_BRAND.ID_EMPRESA=S.ID_EMPRESA
    AND LIST_BRAND.MARCA=COALESCE(S.MARCA,N'') AND LIST_BRAND.NIVEL=S.NIVEL AND LIST_BRAND.ESPECIFICO=0
    AND LIST_BRAND.LISTA=@priceList AND @priceList<>N''
  LEFT JOIN dbo.STOCK_PRICES P ON P.ID_EMPRESA=S.ID_EMPRESA AND P.COD_ALFA=S.COD_ALFA
    AND P.DEPOSITO=S.DEPOSITO AND P.NIVEL=S.NIVEL AND P.LISTA=@priceList AND P.VERSION=@priceVersion
  LEFT JOIN dbo.PRODUCT_CLASSIFICATION C ON C.ID_EMPRESA=S.ID_EMPRESA AND C.COD_ALFA=S.COD_ALFA
  WHERE S.ID_EMPRESA=@company
    AND (@priceList=N'' OR P.COD_ALFA IS NOT NULL)
    AND (@rubros=N'[]' OR S.RUBRO IN (SELECT value FROM OPENJSON(@rubros)))
    AND (@brands=N'[]' OR COALESCE(NULLIF(S.MARCA,''),N'Sin marca') IN (SELECT value FROM OPENJSON(@brands)))
    AND (@licenses=N'[]' OR COALESCE(NULLIF(S.LICENCIA,''),N'Sin licencia') IN (SELECT value FROM OPENJSON(@licenses)))
    AND (@years=N'[]' OR S.COD_ANIO IN (SELECT value FROM OPENJSON(@years)))
    AND (@seasons=N'[]' OR S.COD_TEM IN (SELECT value FROM OPENJSON(@seasons)))
    AND (@levels=N'[]' OR S.NIVEL IN (SELECT CONVERT(INT,value) FROM OPENJSON(@levels)))
    AND (@actioned='' OR (@actioned='confirmed' AND (${CLASSIFICATION})='ACCIONADO')
      OR (@actioned='unconfirmed' AND (${CLASSIFICATION})<>'ACCIONADO')
      OR (@actioned='possible' AND (${CLASSIFICATION})<>'ACCIONADO' AND S.PARES>0 AND COALESCE(P.PRECIO,S.PRECIO)<COALESCE(P.P_BAS,S.P_BAS)))
    AND (@positiveStock=0 OR S.STOCK>0)
    AND (@type='' OR ${CLASSIFICATION}=@type)
    AND NOT EXISTS (
      SELECT 1 FROM OPENJSON(@terms) WITH (term NVARCHAR(200), pattern NVARCHAR(402)) T
      WHERE NOT EXISTS (
        SELECT 1 FROM (VALUES (S.COD_ALFA),(S.CODIGO),(S.DMODC),(S.DCOLORC),(S.COD_ANIO)) F(value)
        WHERE F.value COLLATE Latin1_General_100_CI_AI LIKE T.pattern COLLATE Latin1_General_100_CI_AI ESCAPE '~'
          OR (LEN(T.term)=4 AND T.term LIKE '20[0-9][0-9]' AND S.COD_ANIO=RIGHT(T.term,2))
      )
    )`;

function searchTerms(search) {
  return [...new Set(search.split(/[\s,;]+/u).filter(Boolean))].map(term => ({
    term, pattern: `%${term.replace(/[~%_\[]/g, char => '~' + char)}%`
  }));
}

function bindRules(request, companyId, rules) {
  const r = normalizeRules(rules);
  return request.input('company', sql.Int, companyId)
    .input('priceList', sql.NVarChar(30), r.priceList ? JSON.parse(r.priceList)[0] : '')
    .input('priceVersion', sql.NVarChar(30), r.priceList ? JSON.parse(r.priceList)[1] : '')
    .input('brands', sql.NVarChar(sql.MAX), JSON.stringify(r.brand))
    .input('licenses', sql.NVarChar(sql.MAX), JSON.stringify(r.license))
    .input('rubros', sql.NVarChar(sql.MAX), JSON.stringify(r.rubro))
    .input('years', sql.NVarChar(sql.MAX), JSON.stringify(r.year))
    .input('seasons', sql.NVarChar(sql.MAX), JSON.stringify(r.season))
    .input('levels', sql.NVarChar(sql.MAX), JSON.stringify(r.level))
    .input('actioned', sql.VarChar(20), r.actioned)
    .input('positiveStock', sql.Bit, r.positiveStock).input('type', sql.VarChar(20), r.type)
    .input('terms', sql.NVarChar(sql.MAX), JSON.stringify(searchTerms(r.search)));
}

async function queryStock(company, rules, pagination = null) {
  const pool = await getPool();
  rules = await validatePriceList(company.ID_EMPRESA, rules);
  const request = bindRules(pool.request(), company.ID_EMPRESA, rules)
    .input('factor', sql.Decimal(9,4), company.PUBLIC_PRICE_FACTOR);
  let limit = '';
  if (pagination) {
    request.input('offset', sql.Int, (pagination.page - 1) * pagination.pageSize).input('limit', sql.Int, pagination.pageSize);
    limit = 'OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY';
  }
  const result = await request.query(`SELECT COUNT(*) AS TOTAL ${FROM_WHERE};
    SELECT S.*, P.PRECIO AS LIST_PRICE, P.P_BAS AS LIST_BASE, P.DTOESP AS LIST_DISCOUNT,
      P.LISTA AS SELECTED_LIST, P.VERSION AS SELECTED_VERSION,
      ${CLASSIFICATION} AS CLASSIFICATION, ${CLASSIFICATION} AS WEB_CLASSIFICATION,
      CAST(COALESCE(P.PRECIO,S.PRECIO)/NULLIF(S.PARES,0) AS DECIMAL(19,4)) AS PRICE_WHOLESALE,
      CAST(COALESCE(P.P_BAS,S.P_BAS)/NULLIF(S.PARES,0) AS DECIMAL(19,4)) AS PRICE_BASE,
      CAST(CASE WHEN (${CLASSIFICATION})<>'ACCIONADO' AND S.PARES>0 AND COALESCE(P.PRECIO,S.PRECIO)<COALESCE(P.P_BAS,S.P_BAS) THEN 1 ELSE 0 END AS BIT) AS POSSIBLE_ACTIONED,
      COALESCE(LIST_EXACT.FACTOR,LIST_BRAND.FACTOR,EXACT_FACTOR.FACTOR,FCTR.FACTOR,@factor) AS PUBLIC_PRICE_FACTOR,
      CAST(COALESCE(P.PRECIO,S.PRECIO)/NULLIF(S.PARES,0)*COALESCE(LIST_EXACT.FACTOR,LIST_BRAND.FACTOR,EXACT_FACTOR.FACTOR,FCTR.FACTOR,@factor) AS DECIMAL(19,4)) AS PRICE_PUBLIC
    ${FROM_WHERE} ORDER BY S.DMODC,S.DCOLORC,S.TALLC,S.COD_ALFA,S.DEPOSITO,S.NIVEL ${limit}`);
  const data = result.recordsets[1].map(row => row.SELECTED_LIST === null ? row : { ...row,
    PRECIO: row.LIST_PRICE, P_BAS: row.LIST_BASE, DTOESP: row.LIST_DISCOUNT,
    LISTA: row.SELECTED_LIST, VERSION: row.SELECTED_VERSION });
  return { data, total: result.recordsets[0][0].TOTAL };
}

async function validatePriceList(companyId, rules = {}) {
  const r = normalizeRules(rules);
  const pool = await getPool();
  const rows = (await pool.request().input('company', sql.Int, companyId)
    .query('SELECT DISTINCT LISTA,VERSION FROM dbo.STOCK_PRICES WHERE ID_EMPRESA=@company')).recordset;
  if (rows.length === 1 && !r.priceList) r.priceList = JSON.stringify([rows[0].LISTA, rows[0].VERSION]);
  if (rows.length > 1 && !r.priceList) throw invalid('Seleccione una lista de precios y su version');
  if (r.priceList && !rows.some(row => JSON.stringify([row.LISTA, row.VERSION]) === r.priceList)) throw invalid('La lista y version elegidas no estan disponibles. Revise la grilla.');
  return r;
}

module.exports = { normalizeRules, queryStock, invalid, searchTerms, validatePriceList };
