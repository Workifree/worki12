# Publica a edge function copilot-llm (com verificacao de JWT). Rode voce mesmo: a flag --yes e a
# sua confirmacao. Usa uma pasta temporaria so com a funcao, porque o supabase/config.toml do
# repositorio tem um campo num formato que a CLI nova recusa.
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
$temp = Join-Path ([System.IO.Path]::GetTempPath()) 'worki-fn-deploy'
if (Test-Path $temp) { Remove-Item -Recurse -Force $temp }
New-Item -ItemType Directory -Force (Join-Path $temp 'supabase\functions') | Out-Null
Copy-Item -Recurse (Join-Path $raiz 'supabase\functions\copilot-llm') (Join-Path $temp 'supabase\functions\copilot-llm')
Set-Content -Path (Join-Path $temp 'supabase\config.toml') -Value 'project_id = "vrklakcbkcsonarmhqhp"' -Encoding ascii

Push-Location $temp
try {
    npx -y supabase functions deploy copilot-llm --project-ref vrklakcbkcsonarmhqhp --use-api --yes
    $codigo = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $codigo
