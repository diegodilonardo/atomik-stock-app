const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { sql, getPool } = require('../db/pool');

async function authenticate(req, res, next) {
  const token = req.cookies.atomik_session;
  if (!token) return res.status(401).json({ error: 'Debe iniciar sesion' });
  try {
    req.user = jwt.verify(token, config.jwt.secret);
  } catch {
    return res.status(401).json({ error: 'La sesion vencio' });
  }
  if (!Number.isInteger(req.user.companyId)) return res.status(401).json({ error: 'Ingrese nuevamente con su usuario y contraseña' });
  try {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, req.user.id).input('company', sql.Int, req.user.companyId)
      .query(`SELECT U.USERNAME,U.ROLE,U.FULL_NAME,U.IS_SUPERADMIN,E.* FROM dbo.USERS U JOIN dbo.EMPRESAS E ON E.ID_EMPRESA=U.ID_EMPRESA
        WHERE U.ID_USER=@id AND U.ID_EMPRESA=@company AND U.ACTIVE=1 AND E.ACTIVE=1`);
    const company = result.recordset[0];
    if (!company) return res.status(401).json({ error: 'Usuario o empresa inactivos' });
    req.company = company;
    req.user.role = company.ROLE;
    req.user.isSuperAdmin = Boolean(company.IS_SUPERADMIN);
    req.user.name = company.FULL_NAME;
    req.user.username = company.USERNAME;
    req.user.companyName = company.NOMBRE;
    req.user.companyCode = company.CODIGO;
    req.user.homeCompanyId = company.ID_EMPRESA;
    const selected = req.get('X-Company-ID') || req.query.viewCompanyId;
    if (selected !== undefined && String(selected) !== String(company.ID_EMPRESA)) {
      if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'No tiene acceso a otra empresa' });
      const selectedId = Number(selected);
      if (!Number.isInteger(selectedId) || selectedId < 1 || selectedId > 2147483647) return res.status(400).json({ error: 'Empresa invalida' });
      const target = await pool.request().input('id', sql.Int, selectedId)
        .query('SELECT * FROM dbo.EMPRESAS WHERE ID_EMPRESA=@id AND ACTIVE=1');
      if (!target.recordset.length) return res.status(404).json({ error: 'Empresa inexistente o inactiva' });
      req.company = target.recordset[0];
      req.user.companyId = selectedId;
      req.user.companyName = req.company.NOMBRE;
      req.user.companyCode = req.company.CODIGO;
    }
    return next();
  } catch (error) { return next(error); }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: 'No tiene permisos para esta accion' });
    return next();
  };
}

module.exports = { authenticate, requireRole };
