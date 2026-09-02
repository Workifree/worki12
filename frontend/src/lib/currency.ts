/**
 * Formato canônico de dinheiro do app: "R$ 150,00" (vírgula, sempre 2 casas).
 *
 * Antes cada tela formatava do seu jeito — `R$ {job.pay}` cru virava "R$ 150.5"
 * (ponto decimal, sem centavos) no histórico de MyJobs, enquanto MeusRecebimentos
 * mostrava "R$ 150,50" e o Dashboard usava Intl com "R$ 1.234,56". Três formatos
 * para o assunto mais sensível do freela (Nielsen #4, consistência).
 */
export function formatBRL(amount: number): string {
    return (amount ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
