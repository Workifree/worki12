# Navegação agrupada (empresa e freelancer)

Pedido do dono: o menu lateral tem opção demais; agrupar como os melhores produtos, fácil de achar.
Decisão de arquitetura aprovada.

Base: components/Sidebar.tsx, components/BottomNav.tsx, layouts/CompanyLayout.tsx, layouts/MainLayout.tsx,
App.tsx, Sidebar.test.tsx, __tests__/BottomNav.test.tsx. UMA fonte de verdade da navegação (config tipada
por papel, com `matches` das sub-rotas) usada por lateral, barra inferior e abas.

## Empresa, lateral
- Botão primário "Criar turno" no topo (não é item de nav); depois Início, Turnos, Elenco, Mensagens,
  Relatórios, Gestão.
- Início: com hasTeamNav leva a /company/hoje e as duas telas ganham abas "Hoje | Visão geral"
  (/company/dashboard); sem equipe, só /company/dashboard sem abas. Preservar readTeamNavHint.
- Elenco: abas "Meu Elenco" (/company/team) | "Indicações" (/company/indicacoes).
- Relatórios: abas "Pagamentos" (/company/relatorio) | "Operação" (/company/operacao), unificando as existentes.
- Gestão: rota nova /company/gestao, hub de cartões grandes (ícone, título, uma linha), com rótulos:
  "Pessoas" (Equipe e acessos -> /company/configuracoes/equipe, para quem já podia chegar lá, inclusive o
  dono único sem convites, com o texto "Convidar quem te ajuda"), "Empresa" (Dados da empresa ->
  /company/profile; Unidades -> /company/organization se canSeeOrganization), "Meus bônus" (Trilha ->
  /company/trilha só com useBonusTrailAccess), "Suporte" (Ajuda -> /ajuda). Cada sub-tela tem "‹ Gestão".
  Com trilha ativa, atalho compacto também no Início.
- Item da lateral ativo em todas as sub-rotas (inclusive /company/jobs/:id*); /company/notifications não marca nada.
- Encarregado: Início, Turnos, Elenco, Gestão (sem Mensagens: o chat da empresa fica fora da v1 para ele;
  /company/messages mostra "sem acesso" e os atalhos de chat somem; o WhatsApp continua). Elenco em modo restrito (equipe-encarregados
  R7/R10b: lê pelos cartões sem PII e traz freelas; sem remover, repassar link, listas ou histórico). Não vê
  Indicações (RPCs Gestor-only) nem Relatórios; essas rotas, Operação, Unidades e Equipe mostram "sem acesso"
  (`GestorRouteGuard`); em Gestão só o que já podia usar (não ampliar acesso; RLS é a barreira). Enquanto o papel carrega, não mostrar e depois esconder.
- Seletor de unidade permanece. Rodapé compacto: cartão da empresa (leva a Gestão), Sair; Ajuda.

## Empresa, celular
- Barra de 5: Início, Turnos, Elenco, Mensagens, Gestão (encarregado: 4, sem Mensagens).
- "Criar turno" vira botão flutuante estendido com texto em Início/Hoje e Turnos (>=44px, acima da barra com
  safe-area, com padding para não cobrir o fim da lista), acessível também nos estados vazios.
- Cabeçalho sem ícones de Trilha e Equipe; fica o sino.

## Freela
- Lateral: Início, Meus Turnos, Empresas, Recebimentos, Mensagens. Empresas: abas "Minhas empresas"
  (/carteira) | "Quem te indicou" (/indicacoes). Cartão do usuário no rodapé vira link "Ver meu perfil"
  (mantém nível/XP), ativo em /profile.
- Celular: os mesmos 5 (rótulos curtos "Turnos", "Empresas"); Perfil vira avatar no cabeçalho ao lado do
  sino (>=44px, aria-label "Meu perfil", estado ativo).

## Geral
- Nenhuma URL muda ou é removida; abas são links (NavLink, aria-current), uma linha, sem rolagem horizontal a
  320px, alvos >=44px; títulos coerentes com os rótulos, sem cabeçalho duplicado; sem contadores novos.
- Atualizar textos (app e docs de usuário) que apontem para lugares antigos.
- Teste: toda rota de página de cada papel é alcançável pela nova navegação.
- Gate: `cd frontend && npm run build && npm run lint && npx vitest run`. Não commitar. Não tocar em supabase/.

## Acréscimo: domínio worki.com.br (o domínio não é nosso)
- Remover toda referência no frontend e nos docs de usuário. Não inventar endereço nem usar e-mail pessoal.
- Fonte única `frontend/src/lib/contact.ts` lendo `VITE_CONTACT_EMAIL` (documentada em .env.example).
  Definida: mailto. Ausente: nenhum link de e-mail; Privacidade/Termos dizem "O canal de atendimento para
  dados pessoais será publicado nesta página."; Ajuda oculta o cartão de e-mail.
- Testar os dois estados e a ausência do domínio em frontend/src.
- Arquivos de PWA (index.html, manifest, service worker, vite.config, ícones) são de outro agente.

## Nota de implementação
Relatórios não cabe na barra de 5 do celular: em telas estreitas aparece como cartão em Gestão
(só para Gestor, `md:hidden`) e a barra marca "Gestão" nas telas de relatório.
