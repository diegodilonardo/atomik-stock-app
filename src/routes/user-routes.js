const express = require('express');
const bcrypt = require('bcryptjs');
const { sql, getPool } = require('../db/pool');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('ADMIN'));

router.get('/companies', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().input('company', sql.Int, req.user.companyId)
      .input('super', sql.Bit, Boolean(req.user.isSuperAdmin))
      .query('SELECT ID_EMPRESA,CODIGO,NOMBRE FROM dbo.EMPRESAS WHERE ACTIVE=1 AND (@super=1 OR ID_EMPRESA=@company) ORDER BY NOMBRE');
    res.json({ data: result.recordset });
  } catch (error) { next(error); }
});

function userScope(pool, req) {
  return pool.request().input('company', sql.Int, req.user.companyId)
    .input('super', sql.Bit, Boolean(req.user.isSuperAdmin));
}
const scope = '(@super=1 OR (ID_EMPRESA=@company AND IS_SUPERADMIN=0))';

router.get('/', async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await userScope(pool, req).query(`SELECT U.ID_USER,U.USERNAME,U.FULL_NAME,U.ROLE,U.ACTIVE,U.CREATED_AT,U.UPDATED_AT,U.ID_EMPRESA,U.IS_SUPERADMIN,E.NOMBRE AS COMPANY_NAME,E.CODIGO AS COMPANY_CODE
      FROM dbo.USERS U JOIN dbo.EMPRESAS E ON E.ID_EMPRESA=U.ID_EMPRESA
      WHERE @super=1 OR U.ID_EMPRESA=@company ORDER BY E.NOMBRE,U.FULL_NAME`);
    res.json({ data: result.recordset });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim().toUpperCase();
    const fullName = String(req.body.fullName || '').trim();
    const password = String(req.body.password || '');
    const role = req.body.role;
    if (req.body.isSuperAdmin !== undefined || req.body.IS_SUPERADMIN !== undefined) return res.status(403).json({ error: 'El permiso de superadministrador no se asigna desde este formulario' });
    const companyId = req.body.companyId === undefined ? req.user.companyId : Number(req.body.companyId);
    if (!Number.isInteger(companyId) || companyId < 1 || companyId > 2147483647) return res.status(400).json({ error: 'Empresa invalida' });
    if (!req.user.isSuperAdmin && companyId !== req.user.companyId) return res.status(403).json({ error: 'Solo puede crear usuarios para su empresa' });
    if (!username || username.length > 80 || !fullName || fullName.length > 150 || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72 || !['ADMIN','CONSULTA'].includes(role)) {
      return res.status(400).json({ error: 'Complete los datos; la contraseña debe tener al menos 8 caracteres' });
    }
    const hash = await bcrypt.hash(password, 12);
    const pool = await getPool();
    const company = await pool.request().input('id', sql.Int, companyId).query('SELECT ID_EMPRESA FROM dbo.EMPRESAS WHERE ID_EMPRESA=@id AND ACTIVE=1');
    if (!company.recordset.length) return res.status(400).json({ error: 'Empresa inexistente o inactiva' });
    await pool.request().input('company', sql.Int, companyId)
      .input('username', sql.VarChar(80), username)
      .input('fullName', sql.VarChar(150), fullName)
      .input('hash', sql.VarChar(255), hash)
      .input('role', sql.VarChar(20), role)
      .query(`INSERT dbo.USERS(ID_EMPRESA,USERNAME,FULL_NAME,PASSWORD_HASH,ROLE) VALUES(@company,@username,@fullName,@hash,@role)`);
    return res.status(201).json({ created: true });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) return res.status(409).json({ error: 'El usuario ya existe' });
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const username = String(req.body.username || '').trim().toUpperCase();
    const fullName = String(req.body.fullName || '').trim();
    const role = req.body.role;
    const companyId = Number(req.body.companyId ?? req.user.companyId);
    if (req.body.isSuperAdmin !== undefined || req.body.IS_SUPERADMIN !== undefined) return res.status(403).json({ error: 'No se puede modificar el permiso de superadministrador' });
    if (!Number.isInteger(id) || id < 1 || id > 2147483647 || !Number.isInteger(companyId) || companyId < 1 || companyId > 2147483647 || !username || username.length > 80 || !fullName || fullName.length > 150 || !['ADMIN','CONSULTA'].includes(role)) return res.status(400).json({ error: 'Complete usuario, nombre, empresa y rol válidos' });
    if (!req.user.isSuperAdmin && companyId !== req.user.companyId) return res.status(403).json({ error: 'Solo el superadministrador puede reasignar empresas' });
    if (id === req.user.id && role !== 'ADMIN') return res.status(400).json({ error: 'No puede quitarse su propio permiso de administrador' });
    const pool = await getPool();
    const company = await pool.request().input('id', sql.Int, companyId).query('SELECT ID_EMPRESA FROM dbo.EMPRESAS WHERE ID_EMPRESA=@id AND ACTIVE=1');
    if (!company.recordset.length) return res.status(400).json({ error: 'Empresa inexistente o inactiva' });
    const result = await userScope(pool, req).input('id', sql.Int, id)
      .input('target', sql.Int, companyId).input('username', sql.VarChar(80), username)
      .input('name', sql.VarChar(150), fullName).input('role', sql.VarChar(20), role)
      .query(`UPDATE dbo.USERS SET USERNAME=@username,FULL_NAME=@name,ID_EMPRESA=@target,ROLE=@role,UPDATED_AT=SYSDATETIME()
        OUTPUT INSERTED.ID_USER WHERE ID_USER=@id AND ${scope} AND IS_SUPERADMIN=0`);
    if (!result.recordset.length) return res.status(404).json({ error: 'Usuario inexistente o protegido' });
    res.json({ updated: true });
  } catch (error) {
    if ([2601,2627].includes(error.number)) return res.status(409).json({ error: 'El usuario ya existe' });
    next(error);
  }
});

router.put('/:id/password', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { password, confirmation } = req.body;
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ error: 'Usuario invalido' });
    if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres y un maximo de 72 bytes.' });
    }
    if (password !== confirmation) return res.status(400).json({ error: 'Las contraseñas no coinciden' });
    const pool = await getPool();
    const user = await userScope(pool, req).input('id', sql.Int, id)
      .query(`SELECT ID_USER FROM dbo.USERS WHERE ${scope} AND ID_USER=@id`);
    if (!user.recordset.length) return res.status(404).json({ error: 'Usuario inexistente' });
    const hash = await bcrypt.hash(password, 12);
    const result = await userScope(pool, req).input('id', sql.Int, id)
      .input('hash', sql.VarChar(255), hash)
      .query(`UPDATE dbo.USERS SET PASSWORD_HASH=@hash,UPDATED_AT=SYSDATETIME()
        OUTPUT INSERTED.ID_USER WHERE ID_USER=@id AND ${scope}`);
    if (!result.recordset.length) return res.status(404).json({ error: 'Usuario inexistente' });
    res.json({ updated: true });
  } catch (error) { next(error); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (req.body.companyId !== undefined || req.body.isSuperAdmin !== undefined || req.body.IS_SUPERADMIN !== undefined) return res.status(400).json({ error: 'No se puede cambiar la empresa ni el permiso de superadministrador desde esta accion' });
    const active = typeof req.body.active === 'boolean' ? req.body.active : null;
    const role = ['ADMIN','CONSULTA'].includes(req.body.role) ? req.body.role : null;
    if (!Number.isInteger(id) || (active === null && role === null)) return res.status(400).json({ error: 'Cambio invalido' });
    if (id === req.user.id && active === false) return res.status(400).json({ error: 'No puede desactivar su propio usuario' });
    const pool = await getPool();
    const result = await userScope(pool, req).input('id', sql.Int, id).input('active', sql.Bit, active).input('role', sql.VarChar(20), role)
      .query(`UPDATE dbo.USERS SET ACTIVE=COALESCE(@active,ACTIVE),ROLE=COALESCE(@role,ROLE),UPDATED_AT=SYSDATETIME()
        OUTPUT INSERTED.ID_USER
        WHERE ID_USER=@id AND ${scope} AND IS_SUPERADMIN=0`);
    if (!result.recordset.length) return res.status(404).json({ error: 'Usuario inexistente' });
    return res.json({ updated: true });
  } catch (error) { return next(error); }
});

module.exports = router;
