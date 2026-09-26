param(
    [string]$RutaApp = 'C:\atomik-stock-app',
    [Parameter(Mandatory = $true)][string]$Servicio
)

$ErrorActionPreference = 'Stop'
function Ejecutar-Git {
    param([string[]]$Argumentos)
    $resultado = & git -C $RutaApp @Argumentos
    if ($LASTEXITCODE -ne 0) { throw "Git falló: $($Argumentos -join ' ')" }
    return $resultado
}

$identidad = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identidad)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Abrí PowerShell como administrador.'
}
foreach ($comando in @('git', 'npm.cmd')) {
    if (-not (Get-Command $comando -ErrorAction SilentlyContinue)) { throw "Falta instalar $comando." }
}
$RutaApp = (Resolve-Path -LiteralPath $RutaApp).Path
$servicioActual = Get-Service -Name $Servicio
if ($servicioActual.Status -ne 'Running') { throw 'El servicio debe estar iniciado antes de actualizar.' }
if (-not (Test-Path -LiteralPath (Join-Path $RutaApp '.env'))) { throw 'Falta el .env de producción.' }
$raizGit = Ejecutar-Git -Argumentos @('rev-parse', '--show-toplevel')
if ([IO.Path]::GetFullPath($raizGit).TrimEnd('\') -ne $RutaApp.TrimEnd('\')) { throw 'La carpeta no es la raíz del repositorio.' }
$cambiosLocales = Ejecutar-Git -Argumentos @('status', '--porcelain', '--untracked-files=no')
if ($cambiosLocales) { throw "Hay archivos versionados modificados. No se sobrescribieron. Revisá git status antes de continuar.`n$($cambiosLocales -join "`n")" }
$anterior = Ejecutar-Git -Argumentos @('rev-parse', 'HEAD')
Write-Host 'Descargando cambios...'
Ejecutar-Git -Argumentos @('fetch', '--prune') | Out-Host
$destino = Ejecutar-Git -Argumentos @('rev-parse', '--verify', '@{upstream}')
& git -C $RutaApp merge-base --is-ancestor HEAD $destino
if ($LASTEXITCODE -ne 0) { throw 'La rama local y la remota divergen. No se modificó la aplicación.' }
if ($anterior -eq $destino) { Write-Host 'Producción ya está actualizada.'; return }
$archivos = Ejecutar-Git -Argumentos @('diff', '--name-only', 'HEAD', $destino)
if ($archivos | Where-Object { $_ -match '^(storage/|salidas/|output/|reference/|tmp/|\.env$)' }) {
    throw 'La actualización modifica datos o imágenes de producción. Se requiere revisar esos archivos antes de continuar.'
}
Write-Host "Actualizando $anterior -> $destino"
Stop-Service -Name $Servicio
(Get-Service -Name $Servicio).WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
try {
    Ejecutar-Git -Argumentos @('merge', '--ff-only', $destino) | Out-Host
    Push-Location $RutaApp
    try {
        & npm.cmd ci --omit=dev
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' }
        & node scripts/migrate.js
        if ($LASTEXITCODE -ne 0) { throw 'Falló la migración de la base de datos. El servicio queda detenido para revisión.' }
    } finally { Pop-Location }
    Start-Service -Name $Servicio
    (Get-Service -Name $Servicio).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
    Write-Host 'Actualización completada. Verificá el acceso a la aplicación y los registros del servicio.'
} catch {
    Write-Warning "La actualización no terminó. No se realizó una reversión automática. Versión anterior: $anterior. Revisá el servicio y el error antes de reiniciarlo."
    throw
}
