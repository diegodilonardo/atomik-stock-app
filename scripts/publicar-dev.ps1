param([Parameter(Mandatory = $true)][string]$Mensaje)
$ErrorActionPreference = 'Stop'
$rutaDev = Split-Path -Parent $PSScriptRoot
function Git-Dev {
    param([string[]]$Argumentos)
    $salida = & git -C $rutaDev @Argumentos
    if ($LASTEXITCODE -ne 0) { throw "Git fallo: $($Argumentos -join ' ')" }
    return $salida
}
if ([string]::IsNullOrWhiteSpace($Mensaje)) { throw 'Indica una descripcion del cambio.' }
$rama = Git-Dev -Argumentos @('branch', '--show-current')
if (-not $rama) { throw 'Selecciona una rama antes de publicar.' }
Git-Dev -Argumentos @('remote', 'get-url', 'origin') | Out-Null
if (Git-Dev -Argumentos @('diff', '--cached', '--name-only')) { throw 'Hay cambios preparados previamente. Revisalos antes de publicar.' }
$archivos = @(Git-Dev -Argumentos @('-c','core.quotePath=false','ls-files','--modified','--deleted','--others','--exclude-standard'))
$permitidos = @($archivos | Sort-Object -Unique | Where-Object {
    ($_ -match '^(src/|public/|tests/|scripts/|docs/|sql/|templates/)' -or $_ -in @('package.json','package-lock.json','.gitignore','.gitattributes','.env.example','README.md')) -and
    $_ -notmatch '(^|/)(node_modules|output|outputs|reference|tmp|logs)(/|$)' -and
    $_ -notmatch '\.(xlsx|csv|txt|log|bak|zip)$' -and
    ($_ -eq '.env.example' -or $_ -notmatch '(^|/)\.env')
})
if ($permitidos.Count) {
    Write-Host 'Archivos a publicar:'
    $permitidos | Out-Host
    Push-Location $rutaDev
    try {
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw 'Fallaron las pruebas. No se publico.' }
    } finally { Pop-Location }
    Git-Dev -Argumentos (@('add','--') + $permitidos) | Out-Host
    Git-Dev -Argumentos @('diff','--cached','--stat') | Out-Host
    Git-Dev -Argumentos @('commit','-m',$Mensaje) | Out-Host
}
Git-Dev -Argumentos @('push','-u','origin',$rama) | Out-Host
Write-Host 'Publicado. Ejecuta actualizar-produccion.ps1 en el servidor para aplicar los cambios.'
