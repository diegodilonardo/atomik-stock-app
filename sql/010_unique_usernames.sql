-- El ingreso identifica al usuario sin solicitar empresa.
-- No renombrar ni unir cuentas existentes automaticamente.
IF EXISTS (SELECT USERNAME FROM dbo.USERS GROUP BY USERNAME HAVING COUNT(*) > 1)
  THROW 50010, 'Hay nombres de usuario repetidos entre empresas. Asigne nombres unicos antes de migrar.', 1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('dbo.USERS') AND name='UQ_USERS_LOGIN')
  CREATE UNIQUE INDEX UQ_USERS_LOGIN ON dbo.USERS(USERNAME);
