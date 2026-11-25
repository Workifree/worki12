# Aplicar em produção (SQL Editor do Supabase), NESTA ordem

Cada arquivo é uma transação: se uma verificação falhar, nada é gravado. Em caso de erro, pare e guarde a mensagem.

1. `1_hardening_candidaturas_commit.sql` (fecha forja de presença e autocontratação que existem hoje)
2. `2_e2_commit.sql`
3. `3_e3_commit.sql`
4. `4_e4_commit.sql`
5. `5_e5_commit.sql`
6. `6_sos_horario_de_entrada_commit.sql`

E0 e E1 já estão em produção: não reaplicar. A trilha de bônus (`20261124*`) NÃO está aqui: vai depois, com a equipe estável.
Pasta derivada de `supabase/migrations/`: apague depois de aplicar. Não usar `supabase db push`.
