-- Cambia el codigo comercial; conserva el ID interno y todas las asociaciones.
IF EXISTS(SELECT 1 FROM dbo.EMPRESAS WHERE CODIGO='ATOMIK')
BEGIN
  IF EXISTS(SELECT 1 FROM dbo.EMPRESAS WHERE CODIGO='0')
    THROW 50012, 'El codigo 0 ya pertenece a una empresa. Revise las empresas antes de migrar Atomik.', 1;
  UPDATE dbo.EMPRESAS SET CODIGO='0' WHERE CODIGO='ATOMIK';
END;
