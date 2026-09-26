# Gestión Stock — Multiempresa

Aplicación web para consultar precios y stock, clasificar módulos e importar diariamente el stock. El Excel se genera a pedido mediante la descarga o la exportación explícita.

## Empresas y archivos de origen

### Exportación diaria por grilla

Al seleccionar una grilla guardada, los administradores pueden activar su exportación diaria,
elegir la hora de Argentina y una ruta completa `.xlsx`, y pulsar **Guardar programación**.
Se usan las reglas guardadas y el stock vigente, sin importar stock en ese momento.
Cada destino se reemplaza diariamente; dos grillas activas no pueden compartir la misma ruta.
La aplicación debe estar funcionando con acceso de escritura a la carpeta de destino.
Al iniciar después del horario se recupera la ejecución pendiente del día, sin generar días anteriores.
Se registra un intento por día: un fallo se muestra en la grilla y se vuelve a intentar al día siguiente.
Si se interrumpe el proceso durante una exportación, el estado queda como iniciada y se debe revisar
el destino; no se repite automáticamente ese día para evitar duplicados.
Anular una grilla impide futuras ejecuciones. La base conserva la programación y el último resultado.
La migración `006_grid_schedule.sql` incorpora estos campos sin activar programaciones existentes.

## Grillas guardadas y filtros múltiples

La tabla muestra **Precio base** por par (`P_BAS / PARES`), comparable con el
mayorista (`PRECIO / PARES`). Si el mayorista es menor, la fila aparece en ámbar
con la etiqueta **Posible accionado**. No cambia automáticamente la clasificación.
Con cero pares no se calcula la comparación y esos precios se muestran como `—`.

Rubro, año, temporada y tipo de producto permiten marcar varias opciones con casillas.
Sin selecciones se incluyen todos los valores. Dentro de un filtro se acepta
cualquiera de las opciones elegidas; entre filtros se exige cumplir todas las
condiciones. **Solo stock mayor que 0** excluye los productos sin disponibilidad.
La búsqueda y la categoría del menú (Módulos, Accionado o Sueltos) también forman
parte de las reglas guardadas.

Para crear una grilla, elegir filtros, ingresar un nombre en **Grillas de stock**
y pulsar **Guardar como nueva**. Por ejemplo: rubro Calzado y stock mayor que cero;
otra grilla puede seleccionar Indumentaria con la misma regla de disponibilidad.
Los administradores pueden abrir, editar, guardar cambios y anular grillas. La anulación conserva el registro, retira la grilla del listado e impide consultarla o descargarla; no elimina los Excel descargados previamente.
Los usuarios Consulta solo pueden abrirlas y descargarlas. Las grillas pertenecen
a la empresa y están disponibles para sus usuarios.

Las reglas se guardan en `STOCK_GRIDS`; los productos se consultan sobre el stock
vigente. Importar stock no genera Excel ni modifica estas reglas. **Descargar Excel
de esta vista** aplica los filtros actuales; **Descargar grilla guardada** aplica
las reglas persistidas de la grilla elegida. Los totales superiores siguen siendo
los de toda la empresa. Archivar una grilla no borra productos ni historial.

La migración `005_saved_grids.sql` se aplica con `npm run db:migrate` y está incluida
en el instalador SQL generado. Una versión de edición evita sobrescribir cambios
de otro administrador sin volver a abrir la grilla.

## Separación por empresa

La aplicación usa una sola base, `GESTION_STOCK`. Cada empresa tiene sus usuarios,
stock, historial, clasificaciones, auditoría e importaciones separados por
`ID_EMPRESA`. Los datos anteriores a esta versión se asignan a `0` (Atomik).
El mismo código de producto puede existir en distintas empresas. Cada nombre
de usuario es único en toda la aplicación y cada cuenta pertenece a una empresa.
El ingreso pide únicamente usuario y contraseña y abre la empresa asignada.
Los administradores crean usuarios para su propia empresa. Para trabajar en otra
empresa se necesita una cuenta distinta asignada a ella.

El TXT no necesita una columna adicional: la asociación guardada en `EMPRESAS`
entre empresa y ruta completa identifica el origen. Cada empresa tiene un TXT
y un Excel de salida; ambos deben ser exclusivos. Las rutas se normalizan y
se comparan sin distinguir mayúsculas de minúsculas. Usar siempre la ruta UNC
canónica del servidor, evitando alias de servidor o unidades de red mapeadas.
El importador admite depósitos 7/8 (Atomik) y 21 (MIDING). El TXT admite 78 columnas,
con este orden final desde la columna 71:
`DISCIPLINA|COLORC|COD_TEM|COD_AÑO|MODC|DTOESP|P_BAS|ESTADIO`.
También admite archivos anteriores de 74 columnas (sin códigos de fotografía).
No se pueden mezclar ambos formatos dentro de un mismo archivo.

### Fotos de productos en el Excel

En **Configuración de empresa** se indica la carpeta de fotos de esa empresa.
Los cuatro códigos nuevos se guardan como texto para conservar ceros iniciales
(`COD_AÑO` se almacena como `COD_ANIO` en SQL Server).
Se busca primero `COD_AÑO + COD_TEM + MODC + COLORC` y luego
`COD_AÑO + MODC + COLORC`, con extensión JPG, JPEG o PNG, sin separadores.
Si ambas variantes existen se utiliza la que incluye temporada.
El Excel incrusta las fotos encontradas y completa la columna oculta
`NOMBRE IMAGEN`. Si faltan códigos o una foto, mantiene `No Existe la Imagen`.
Si la carpeta configurada no es accesible, la exportación informa el error.

### Actualizar una instalación existente

Detener la aplicación, verificar `DB_DATABASE=GESTION_STOCK` en `.env` y ejecutar:

```powershell
npm run db:migrate
npm run dev
```

La migración es transaccional y se puede repetir. Conserva usuarios y datos.
Al migrar por primera vez copia las rutas de `.env` a la empresa Atomik.
Después, las rutas, el factor de precio y los días de historial se administran
desde **Configuración de empresa**, disponible para su administrador.
Las sesiones anteriores requieren iniciar sesión nuevamente con el mismo
usuario y contraseña. El servidor comprueba empresa, estado y rol
en cada solicitud; el navegador no puede elegir otra empresa mediante parámetros.

### Registrar otra empresa

Desde la consola del servidor:

```powershell
npm run company:save -- EMPRESA2 "Segunda empresa" "\\servidor\stock\empresa2.TXT" "\\servidor\salida\Empresa2.xlsx"
npm run user:create-admin -- --empresa EMPRESA2 ADMIN "UnaClaveSegura" "Administrador"
npm run import:stock -- EMPRESA2
```

`company:save` también permite actualizar nombre y rutas de una empresa existente.
El alta de empresas se hace desde consola; un administrador web administra solo
su propia empresa. No registra otras empresas ni obtiene acceso a sus usuarios.
La importación manual y automática solo actualiza stock e historial; no lee fotos
ni genera o reemplaza el Excel. Sin argumento utiliza `0` (Atomik). No se importan
empresas inactivas o sin archivo de origen configurado. La importación no requiere
una salida de Excel ni una carpeta de fotos accesible.

El cron global (`STOCK_CRON`, por defecto 07:00 Argentina) recorre las empresas
activas y procesa cada una de manera independiente. Un error no detiene las
demás. La recuperación al iniciar se aplica al horario predeterminado de 07:00,
por empresa. Una exclusión en SQL Server impide dos actualizaciones/exportaciones
simultáneas de la misma empresa, incluso desde distintos procesos.

### Verificación

```powershell
npm test
$env:MULTIEMPRESA_TEST_SQL='1'
node --test tests/multiempresa.integration.test.js
Remove-Item Env:MULTIEMPRESA_TEST_SQL
```

La prueba de integración crea y elimina su propia base temporal `GESTION_TEST_*`
y archivos temporales. Requiere permisos SQL para crear bases. Comprueba migración
repetible, usuarios, consultas, clasificación, importaciones, descargas, rutas
duplicadas y aislamiento entre dos empresas con el mismo SKU y usuario.

## Alcance de esta versión

- Usuarios con roles `ADMIN` y `CONSULTA`.
- Lectura del TXT de 74 columnas desde una ruta de red.
- Validación completa antes de modificar el stock vigente.
- Stock actual e historial móvil de 30 días en SQL Server.
- Tipo producto según `NIVEL`: 950 para módulos y 900 para pares sueltos, independientemente del depósito.
- Filtro de tipo de producto combinable con rubro, año, temporada y búsqueda. Accionado sigue siendo una clasificación de módulos.
- Clasificación manual y persistente entre `MODULOS` y `ACCIONADO`.
- Cron diario a las 07:00 de Argentina.
- Recuperación al iniciar si la PC estaba apagada a la hora del proceso.
- Descarga individual del Excel desde el navegador.
- Reemplazo protegido del Excel compartido únicamente mediante una exportación administrativa explícita.

Las fotos del Excel se configuran por empresa; ver la sección de fotos de productos.

## Requisitos

- Windows 10/11.
- Node.js 20 o superior.
- SQL Server Express y TCP/IP habilitado.
- Acceso de lectura a `\\172.24.0.175\Vicbor2\Productos\Atomik\Grillas`.
- Acceso de escritura a `\\192.168.106.79\General MKT-COMERCIAL\Grillas_Stock\ATOMIK\STOCK`.

La cuenta de Windows que inicie la aplicación debe tener permisos sobre las dos rutas de red.

## Instalación inicial

### Crear la base desde SQL Server Management Studio

Abrir `sql/000_create_atomik_stock.sql` en SSMS y ejecutar el archivo completo
con una cuenta que pueda crear bases y tablas. Crea `GESTION_STOCK`, `EMPRESAS` y las seis
tablas operativas, incluyendo claves, restricciones e índices. Se puede
volver a ejecutar sin borrar datos; no corrige automáticamente diferencias en
tablas preexistentes fuera de las migraciones incluidas.

Requiere SQL Server 2016 o posterior y nivel de compatibilidad 130 o superior
para el importador. El archivo incluye `sql/001_schema.sql` y `sql/002_multiempresa.sql`.
Para regenerarlo después de modificar el esquema, ejecutar `npm run db:build-script`.

Luego configurar `.env`, ejecutar `npm run db:migrate` para cargar las rutas de Atomik y crear el administrador con
`npm run user:create-admin -- ADMIN "UnaClaveSegura" "Administrador"`.
El script SQL no crea credenciales de SQL Server ni usuarios de la aplicación.

### Instalación desde PowerShell

1. Abrir PowerShell dentro de la carpeta del proyecto.
2. Ejecutar:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\scripts\setup.ps1
   ```

3. La primera ejecución crea `.env` y se detiene. Editar las credenciales y ejecutar nuevamente el mismo comando.
4. Crear el primer administrador:

   ```powershell
   npm run user:create-admin -- ADMIN "UnaClaveSegura" "Administrador"
   ```

5. Probar la importación:

   ```powershell
   npm run import:stock
   ```

6. Iniciar la aplicación:

   ```powershell
   npm start
   ```

7. Abrir `http://localhost:3200`. Desde otra PC de la red, usar `http://IP-DE_LA_PC:3200`.

## Inicio automático con Windows

Crear una tarea en el Programador de tareas:

- Desencadenador: `Al iniciar el sistema`.
- Programa: `powershell.exe`.
- Argumentos: `-ExecutionPolicy Bypass -File "C:\RUTA\atomik-stock-app\scripts\start-app.ps1"`.
- Ejecutar con la cuenta de Windows que accede a las carpetas compartidas.
- Activar `Ejecutar tanto si el usuario inició sesión como si no`.
- Activar `Reiniciar la tarea si se produce un error`.

## Migración posterior del SQL Server

La aplicación no contiene servidores ni contraseñas fijas. Después de restaurar la base en el servidor, modificar solamente en `.env`:

```env
DB_SERVER=SERVIDOR_SQL
DB_INSTANCE=
DB_PORT=1433
DB_DATABASE=GESTION_STOCK
DB_USER=usuario_stock
DB_PASSWORD=clave
DB_ENCRYPT=true
DB_TRUST_SERVER_CERTIFICATE=true
```

## Reglas de actualización

1. Se lee el archivo completo.
2. Se valida el formato (74, 78, 79 o 82 columnas), tipos, depósitos y claves duplicadas por lista/version.
3. La actualización de `STOCK_CURRENT` se realiza dentro de una transacción.
4. Solo después de una importación correcta se guarda la fotografía diaria y se depuran datos anteriores a 30 días.
5. La importación termina al guardar stock e historial. `EXCEL_STATUS` queda vacío porque no se solicitó una exportación.
6. La descarga de Excel es independiente. La exportación explícita al recurso compartido genera un archivo temporal antes de reemplazar el destino.

## Variables principales

Revisar `.env.example`. Las rutas UNC deben escribirse como Windows las muestra, comenzando con `\\servidor\carpeta`.

## Comandos

```text
npm start                 Iniciar la aplicación
npm run dev               Desarrollo con reinicio automático
npm run db:create         Crear la base configurada
npm run db:migrate        Crear o actualizar tablas
npm run import:stock      Ejecutar una importación desde consola
npm run user:create-admin Crear o restablecer un administrador
npm test                  Ejecutar pruebas del importador
```

### Licencias
El TXT admite 79 campos: LICENCIA después de ESTADIO. También admite 82 campos para MIDING: los primeros 75 campos originales y luego LICENCIA, DTO_ESP, P_BAS, ESTADIO, MARCA, LISTA y VERSION. Estos tres campos se guardan como texto (conservan ceros iniciales) y quedan vacíos para archivos anteriores. Se admiten los depósitos 7, 8 y 21; la empresa se identifica por el archivo configurado, no por el depósito. Aplicar la migración 008 antes de importar. Se conservan los formatos anteriores de 78 y 74 campos. El filtro Licencia permite selección múltiple y la opción Sin licencia para valores vacíos. Se guarda con las reglas de la grilla y se aplica a sus exportaciones manuales y programadas.

### Exportar desde la terminal
Desde C:\atomik-stock-app, ejecutar:

```powershell
node scripts/export-grid.js --empresa 0 --listar
node scripts/export-grid.js --empresa 0 --id 7
node scripts/export-grid.js --empresa 0 --nombre "GRILLA STOCK INDUMENTARIA SL - VENDEDORES" --salida "C:\Grillas\SL.xlsx"
node scripts/export-grid.js --empresa 0 --todas
```

Sin `--salida` usa el destino guardado de cada grilla y reemplaza el archivo existente. `--todas` exige que todas las grillas activas tengan rutas distintas configuradas, aunque su exportación diaria esté desactivada. Usa el stock vigente sin importar ni modificar la programación. Requiere acceso SQL y permisos sobre las carpetas de fotos y salida. Devuelve código de salida 1 si hay errores. No requiere servidor web iniciado.

## Listas de precios por grilla

Aplicar la migración 009 con npm run db:migrate. STOCK_CURRENT conserva un registro por empresa, código alfa, depósito y nivel; STOCK_PRICES guarda los precios de cada LISTA y VERSION. La importación reemplaza ambos conjuntos en una transacción. El stock y los datos descriptivos deben coincidir entre listas; una diferencia rechaza el archivo y conserva el stock anterior. Los totales y el historial de cantidades se calculan una sola vez por producto.

El selector Lista de precios muestra cada combinación disponible. Cada grilla guarda una sola combinación, utilizada también por la descarga, el cron y el script de exportación. No se reemplaza silenciosamente una versión desaparecida: la grilla debe actualizarse. La alerta de posible accionado compara precio y base de la lista seleccionada. Los archivos sin listas (Atomik) mantienen su funcionamiento. La clasificación manual sigue siendo por producto en la empresa.

MIDING tiene código de empresa 3000 y origen productos_grilla_stock_miding.TXT. Sus rutas de fotos/salida y usuarios deben configurarse antes de completar la operación comercial.

## Superadministrador

La migración 011 agrega IS_SUPERADMIN, deshabilitado por defecto. Para habilitar a un administrador activo existente: node scripts/set-superadmin.js USUARIO. No cambia su empresa ni contraseña.

En Usuarios, el superadministrador ve las cuentas de todas las empresas y elige una empresa activa al crear una cuenta. Puede cambiar contraseñas y activar/desactivar usuarios comunes de otras empresas. Los administradores comunes solo gestionan su empresa y no pueden modificar cuentas de superadministrador. El formulario no concede este permiso ni permite cambiar de empresa una cuenta existente, para preservar su historial. Los permisos se consultan en cada solicitud. El selector Empresa permite al superadministrador consultar el stock, las grillas y descargar Excel de cualquier empresa activa. El superadministrador conserva sus permisos de gestión en la empresa seleccionada: puede importar, clasificar productos, administrar grillas y programar exportaciones. La migración 013 permite registrar su ID real como autor aunque su cuenta pertenezca a otra empresa. La selección se valida contra el permiso actual en cada petición y se aplica también a las descargas. Cambiar de empresa recarga la pantalla y limpia filtros y selecciones.

El filtro Marca admite selección múltiple y la opción Sin marca para registros vacíos. Se conserva en las grillas guardadas y se aplica a sus consultas y exportaciones, siempre dentro de la empresa de la sesión.

En el formato actual de 82 campos, las columnas 76–82 son LICENCIA|DTO_ESP|P_BAS|ESTADIO|MARCA|LISTA|VERSION. Los formatos antiguos de 74/78/79 conservan su orden anterior. Las grillas antiguas sin lista explícita usan la única lista disponible; si hay varias, se exige elegir una.

## Coeficientes por marca y tipo de producto

En Configuración de empresa, cada marca tiene un coeficiente para Módulo (950, incluidos accionados) y otro para Suelto (900). Un campo vacío usa PUBLIC_PRICE_FACTOR de la empresa. Precio público = (precio de la lista seleccionada / pares por unidad de stock) × coeficiente. No cambia el precio mayorista ni el precio base.

La migración 014 crea COMPANY_PRICE_FACTORS. Los coeficientes se guardan por ID_EMPRESA + MARCA + NIVEL, con hasta cuatro decimales; se conservan entre importaciones. Aplican a la web, Excel manual, grillas guardadas, cron y exportación por línea de comando. Se guardan junto con la configuración en una transacción. Las marcas nuevas usan el general hasta configurarlas.

## Columnas del Excel por grilla

En Grillas de stock, abrir Columnas del Excel, marcar los campos y Guardar cambios (o Guardar como nueva). La selección se guarda en RULES_JSON.excelColumns y se aplica a descargas, cron y CLI. Las grillas sin esta regla mantienen el diseño anterior.

Se ocultan columnas existentes sin eliminarlas ni cambiar referencias. Pedido, stock, subtotales y el bloque de talles de Sueltos quedan disponibles; CODIGO/COD_ALFA y las hojas auxiliares mantienen sus bloqueos/ocultación. Precio base, marca y licencia son columnas adicionales al final, con el formato de la hoja. En Sueltos, si el precio base varía dentro de un bloque, se informa Varía según talle. Excluir Imagen evita leer la carpeta de fotos.


### Coeficientes por licencia y rubro

La migración 015 amplía las reglas a marca + licencia + rubro + tipo de producto, por empresa. La configuración muestra las combinaciones importadas y conserva las reglas guardadas aunque desaparezcan temporalmente del stock. Primero se aplica la combinación exacta; si está vacía, el coeficiente de marca (Todas / Todos) y luego el general de empresa. Sin licencia representa un producto sin licencia y es distinto de Todas. Los valores anteriores se conservan como respaldo de marca. El cálculo se comparte entre la web y todas las exportaciones.

### Coeficientes por lista
La migración 016 conserva las reglas anteriores bajo Todas las listas. Se permiten reglas por LISTA (independientes de VERSION): combinación de lista > marca de lista > combinación general > marca general > coeficiente de empresa. La configuración muestra las listas importadas y las listas con reglas guardadas. El precio público de la web y de las exportaciones usa la lista seleccionada.


## Publicar y actualizar desde Git

Desarrollo (repositorio origin configurado):

```powershell
.\scripts\publicar-dev.ps1 -Mensaje "Descripcion del cambio"
```

Ejecuta pruebas, prepara archivos de codigo permitidos, crea el commit y publica la rama actual. No incluye .env, stock TXT, Excel ni carpetas de salida. Si falla el push, se puede repetir para enviar el commit pendiente.

Servidor, PowerShell como administrador, con repositorio clonado, rama con upstream, .env local y servicio Windows existente:

```powershell
.\scripts\actualizar-produccion.ps1 -RutaApp C:\atomik-stock-app -Servicio StockGrillasApp
```

Descarga cambios, rechaza modificaciones locales o ramas divergentes, detiene el servicio, actualiza por fast-forward, instala dependencias, ejecuta las migraciones SQL y vuelve a iniciar el servicio. Si falla la instalacion o migracion, deja el servicio detenido e informa el commit anterior; no revierte automaticamente la base de datos. Conserva el .env local y los archivos operativos excluidos de Git.

Git respalda el codigo. La base SQL, las fotos, los archivos de stock, los Excel y el .env requieren su propio respaldo. Antes de actualizar produccion, realizar el respaldo de la base SQL.
