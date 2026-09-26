const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sql, getPool } = require('../db/pool');
const config = require('../config/env');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim().toUpperCase();
    const password = String(req.body.password || '');
    if (!username || username.length > 80 || !password) return res.status(400).json({ error: 'Ingrese usuario y contraseña' });
    const pool = await getPool();
    const result = await pool.request().input('username', sql.VarChar(80), username)
      .query(`SELECT U.ID_USER,U.USERNAME,U.FULL_NAME,U.PASSWORD_HASH,U.ROLE,U.IS_SUPERADMIN,U.ID_EMPRESA,E.NOMBRE,E.CODIGO
        FROM dbo.USERS U JOIN dbo.EMPRESAS E ON E.ID_EMPRESA=U.ID_EMPRESA
        WHERE U.USERNAME=@username AND U.ACTIVE=1 AND E.ACTIVE=1`);
    const user = result.recordset[0];
    if (result.recordset.length !== 1 || !(await bcrypt.compare(password, user.PASSWORD_HASH))) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    const payload = { id: user.ID_USER, username: user.USERNAME, name: user.FULL_NAME, role: user.ROLE,
      isSuperAdmin: Boolean(user.IS_SUPERADMIN),
      companyId: user.ID_EMPRESA, companyName: user.NOMBRE, companyCode: user.CODIGO };
    const token = jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
    res.cookie('atomik_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.env === 'production',
      maxAge: 8 * 60 * 60 * 1000
    });
    return res.json({ user: payload });
  } catch (error) { return next(error); }
});

router.post('/logout', (_req, res) => {
  res.clearCookie('atomik_session');
  res.status(204).end();
});

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

router.get('/companies', authenticate, async (req, res, next) => {
  try {
    if (!req.user.isSuperAdmin) return res.status(403).json({ error: 'Solo disponible para superadministradores' });
    const pool = await getPool();
    const result = await pool.request().query('SELECT ID_EMPRESA,CODIGO,NOMBRE FROM dbo.EMPRESAS WHERE ACTIVE=1 ORDER BY NOMBRE');
    res.json({ data: result.recordset });
  } catch (error) { next(error); }
});

module.exports = router;
