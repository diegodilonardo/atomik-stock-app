-- El autor puede ser un superadministrador de otra empresa.
-- ID_EMPRESA sigue identificando al propietario del registro.
-- Conservar el ID del autor real, sin crear cuentas duplicadas ni moverlas.
DECLARE @table SYSNAME, @constraint SYSNAME, @column SYSNAME, @statement NVARCHAR(MAX);
DECLARE actors CURSOR LOCAL FAST_FORWARD FOR
  SELECT * FROM (VALUES
    ('STOCK_IMPORTS','FK_IMPORT_EMPRESA_USER','ID_USER'),
    ('PRODUCT_CLASSIFICATION','FK_CLASS_EMPRESA_USER','UPDATED_BY'),
    ('CLASSIFICATION_AUDIT','FK_AUDIT_EMPRESA_USER','ID_USER'),
    ('STOCK_GRIDS','FK_GRIDS_CREATOR','CREATED_BY'),
    ('STOCK_GRIDS','FK_GRIDS_UPDATER','UPDATED_BY')
  ) M(table_name,constraint_name,column_name);
OPEN actors;
FETCH NEXT FROM actors INTO @table,@constraint,@column;
WHILE @@FETCH_STATUS=0
BEGIN
  IF (SELECT COUNT(*) FROM sys.foreign_key_columns WHERE constraint_object_id=OBJECT_ID('dbo.'+@constraint)) > 1
  BEGIN
    SET @statement=N'ALTER TABLE dbo.'+QUOTENAME(@table)+N' DROP CONSTRAINT '+QUOTENAME(@constraint);
    EXEC sp_executesql @statement;
  END;
  IF OBJECT_ID('dbo.'+@constraint,'F') IS NULL
  BEGIN
    SET @statement=N'ALTER TABLE dbo.'+QUOTENAME(@table)+N' WITH CHECK ADD CONSTRAINT '+QUOTENAME(@constraint)
      +N' FOREIGN KEY('+QUOTENAME(@column)+N') REFERENCES dbo.USERS(ID_USER)';
    EXEC sp_executesql @statement;
  END;
  FETCH NEXT FROM actors INTO @table,@constraint,@column;
END;
CLOSE actors;
DEALLOCATE actors;
