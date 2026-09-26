const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(__dirname, '..', 'sql');
const batches = ['001_schema.sql', '002_multiempresa.sql', '003_product_images.sql', '004_optional_stock_fields.sql', '005_saved_grids.sql', '006_grid_schedule.sql', '007_licenses.sql', '008_stock_brand.sql', '009_price_lists.sql', '010_unique_usernames.sql', '011_superadmin.sql', '012_atomik_company_code.sql', '013_cross_company_actors.sql', '014_price_factors.sql', '015_factor_dimensions.sql', '016_factor_lists.sql'].flatMap(file =>
  fs.readFileSync(path.join(directory, file), 'utf8').split(/^GO\s*$/mi).filter(batch => batch.trim()));
const script = `-- Gestion Stock: instalacion y migracion multiempresa para SSMS.
-- Generado por npm run db:build-script. No editar las copias del esquema aqui.
-- Conserva los datos existentes y los asigna a Atomik al migrar por primera vez.
-- Requiere SQL Server 2016+ y permisos para crear bases/tablas.
-- Luego ejecutar npm run db:migrate para cargar las rutas iniciales de Atomik desde .env.
USE [master];
GO
IF DB_ID(N'GESTION_STOCK') IS NULL EXEC(N'CREATE DATABASE [GESTION_STOCK]');
GO
USE [GESTION_STOCK];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
IF DB_NAME() <> N'GESTION_STOCK' THROW 50001, 'La base activa debe ser GESTION_STOCK.', 1;
IF (SELECT compatibility_level FROM sys.databases WHERE name=DB_NAME()) < 130
  THROW 50002, 'El importador requiere compatibilidad 130 o superior.', 1;
BEGIN TRY
  BEGIN TRANSACTION;
${batches.map(batch => `  EXEC(N'${batch.replace(/'/g, "''")}');`).join('\n')}
  COMMIT TRANSACTION;
  PRINT N'GESTION_STOCK: esquema multiempresa disponible.';
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
GO
SELECT CODIGO,NOMBRE FROM dbo.EMPRESAS;
GO
`;
fs.writeFileSync(path.join(directory, '000_create_atomik_stock.sql'), script);
console.log('Instalador SQL actualizado.');
