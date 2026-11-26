# Aplica em producao as migrations pendentes, na ordem revisada, e registra cada uma no historico.
# Rode voce mesmo com:  ! powershell -ExecutionPolicy Bypass -File scripts/aplicar-migrations.ps1
# (a flag --yes e a sua confirmacao; o agente nao pode passa-la). Para na primeira falha.
# Cada migration ja foi revisada contra o catalogo real e testada em pglite.
$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent $PSScriptRoot
$ref  = 'vrklakcbkcsonarmhqhp'
$temp = Join-Path ([System.IO.Path]::GetTempPath()) 'worki-db-apply'
if (Test-Path $temp) { Remove-Item -Recurse -Force $temp }
New-Item -ItemType Directory -Force (Join-Path $temp 'supabase') | Out-Null
Set-Content -Path (Join-Path $temp 'supabase\config.toml') -Value "project_id = `"$ref`"" -Encoding ascii
Push-Location $temp
try {
    supabase link --project-ref $ref | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'supabase link falhou (faca supabase login).' }

    function Invoke-Sql([string]$sql) {
        $out = supabase db query --linked --yes --output-format json $sql 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or $out -match '"_tag"\s*:\s*"Error"') { Write-Host $out; throw 'Falha ao executar SQL.' }
        return $out
    }
    function Invoke-SqlFile([string]$path) {
        $out = supabase db query --linked --yes --output-format json -f $path 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or $out -match '"_tag"\s*:\s*"Error"') { Write-Host $out; throw "Falha em $path" }
    }
    function Test-Applied([string]$name) {
        $out = Invoke-Sql "select count(*)::int as n from supabase_migrations.schema_migrations where name = '$name'"
        return ($out -match '"n"\s*:\s*[1-9]')
    }
    function Register([string]$version, [string]$name) {
        Invoke-Sql "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name') on conflict do nothing" | Out-Null
    }

    # 0. Remove a linha falsa deixada por um teste do agente (migration vazia com o nome da de CPF).
    Invoke-Sql "delete from supabase_migrations.schema_migrations where (version = '20261126045127' and name = 'cpf_leitura_propria') or (version = '20261126051158' and name = 'cpf_leitura_propria') or (version = '20261126051249' and name = 'criacao_lote_turnos')" | Out-Null
    Write-Host 'Historico limpo das linhas duplicadas/falsas (cpf_leitura_propria e criacao_lote_turnos).'

    $ordem = @(
        '20261202000100_tempo_real',
        '20261128000100_criacao_lote_turnos',
        '20261129000100_cpf_leitura_propria',
        '20261124000100_trilha_bonus_s1_esquema',
        '20261124000200_trilha_bonus_s2_motor',
        '20261124000300_trilha_bonus_s3_aceite_e_saque',
        '20261124000400_trilha_bonus_s4_admin',
        '20261201000100_avisos_outbox_esquema',
        '20261201000200_avisos_produtores',
        '20261201000300_avisos_agendador',
        '20261127000100_presenca_p1_locais',
        '20261127000200_presenca_p2_politica_turno',
        '20261127000300_presenca_p3_verificacao'
    )
    foreach ($m in $ordem) {
        $version = $m.Substring(0, 14)
        $name    = $m.Substring(15)
        if (Test-Applied $name) { Write-Host "ja aplicada: $name"; continue }
        Write-Host "aplicando: $m ..."
        Invoke-SqlFile (Join-Path $raiz "supabase\migrations\$m.sql")
        Register $version $name
        Write-Host "  ok: $name"
    }

    # Indices da presenca: CREATE INDEX CONCURRENTLY nao roda em transacao, um comando por vez.
    if (-not (Test-Applied 'presenca_indices')) {
        Write-Host 'aplicando: indices da presenca ...'
        Invoke-Sql 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_presence_checks_job ON public.presence_checks (job_id)' | Out-Null
        Invoke-Sql 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_company_sites_company ON public.company_sites (company_id)' | Out-Null
        Register '20261127000400' 'presenca_indices'
        Write-Host '  ok: presenca_indices'
    }

    Write-Host ''
    Write-Host 'Conferencia no catalogo:'
    Invoke-Sql "select (select count(*) from pg_publication_tables where pubname='supabase_realtime') as tabelas_tempo_real, (select count(*) from pg_proc where proname in ('create_jobs_batch','create_presence_site') or proname like 'bonus_%') as funcoes, (select count(*) from cron.job where jobname like 'notice-%') as crons_avisos" | Write-Host
    Write-Host 'Concluido.'
}
catch {
    Write-Host "PAROU: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    Pop-Location
}
