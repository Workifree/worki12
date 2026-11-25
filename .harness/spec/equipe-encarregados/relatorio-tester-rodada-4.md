# Relatório do tester, rodada 4 (reteste focado): Equipe e encarregados

**Veredito: PASS.** Os 6 itens retestados estão corrigidos. Resta 1 defeito BAIXO novo (N-5).

- Ambiente: http://localhost:5173 (Vite dev; commit f2aad4b0 informado pelo orquestrador, sem hash de bundle), banco de produção só com contas de teste, 25/11/2026 (data do app). Empresa 9222 (desktop 1368 e 320x568); freela 9223 (390x844, 360x740, 320x568). Falha e atraso simulados trocando window.fetch.

## Reteste
| Item | Status | Evidência |
|---|---|---|
| N-4 | CORRIGIDO | 390: "Restaura..." antes do selo, sem sobreposição. 320: sem sobreposição (botão x 134-150, selo x 162-286), text-overflow ellipsis, elementFromPoint na ponta direita cai no botão. Ver N-5. |
| M-2 | CORRIGIDO | GET Conversation falhando (2 tentativas interceptadas): título "FREELAS" sem número, alert "Não conseguimos carregar" + "Tentar de novo". Com a rede restaurada, o botão traz "FREELAS (5)". |
| B-1 | CORRIGIDO | Selos iguais nos dois lados: Concluído (E, B-checkin), Contratado (D-vinculo; A só visto na empresa, no freela o contador de não lidas ocupa o lugar), Saída confirmada (C). Meus Turnos: "Em Andamento" vazio; C no Histórico como "Saída confirmada" com "Falar com a empresa" (44px), que abre a conversa de C. |
| B-2 | CORRIGIDO | Empresa 320: Enviar x 225-286, bolhas e selo inteiros (screenshot), documento 320. Ver N-5. |
| B-3 | CORRIGIDO | /company/relatorio e /company/operacao a 320: abas x 16-158 e 162-304, 44px, sem corte; main 320/320, não rola na horizontal. |
| B-4 | CORRIGIDO | Desktop, REST atrasado 3,5 s, MutationObserver no menu: nunca mostrou "Carregando..." nem "Não verificado"; o bloco aparece já como "Restaurante E2E Verificado". 1 carga. |

## Defeito novo

### N-5 · BAIXO · Cabeçalho do chat a 320px: o selo "Saída confirmada" esmaga o nome
- Oráculo: expectativa do usuário; design-system (alvo de 44px).
- Onde: /messages?conversation=9b7ce9e0-09a7-4392-b705-a36d391baa0c (freela) e /company/messages com a mesma conversa (empresa).
- Passos: 1) Viewport 320x568. 2) Abrir a conversa de "ZZ-TESTE rodada2 C".
- Esperado: dá para identificar com quem se fala e qual é o turno.
- Obtido: no freela aparece "R." e "Z.."; o botão "Ver perfil da empresa" mede 17x16 px (texto precisa de 127). Na empresa aparece "W." e o título do turno some (H4 17/90; título 3/117).
- A 360 (freela): "Rest..." e "ZZ-TES...", botão 57x24. A 390: "Restaura...".
- Frequência: sempre, nesta conversa. Outros selos não medidos no cabeçalho.
- Suspeita de origem: selo na mesma linha, sem encolher (Messages.tsx e CompanyMessages.tsx). Sugestão: selo abaixo do nome em tela estreita.

## Não testado
- Rótulo "Aguardando confirmação" (saída do freela sem confirmação da empresa) e selo "Em Andamento": não havia turno nesses estados e não criei turno nem marquei presença.
- Regressão ampla, console e rede completos, 844x390, offline real. Empresa a 360 e 390 no chat.

## Dados
- Nenhum turno, mensagem ou pagamento criado ou alterado. Fechei sem enviar o modal "Avaliar Empresa" que abriu em /my-jobs (turno E). Abrir a conversa de C não envia nada.
- Ao final: empresa sem emulação; freela emulando 390x844; os dois logados. Não precisei de senha.
- Matriz COBERTURA-CLIQUE-A-CLIQUE.md não lida nem alterada.
