$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Se creo .env. Complete las credenciales antes de continuar." -ForegroundColor Yellow
    exit 0
}

npm install
npm run db:create
npm run db:migrate
Write-Host "Instalacion terminada. Cree el primer administrador con:" -ForegroundColor Green
Write-Host 'npm run user:create-admin -- ADMIN "SuClaveSegura" "Administrador"'
