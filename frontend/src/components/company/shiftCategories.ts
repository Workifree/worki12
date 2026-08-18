/**
 * Categorias de turno do mercado presencial de atendimento/serviço (pivô empresa-primeiro).
 * Sem tech/remoto — o turno é sempre presencial, definido pela função (salão/cozinha/evento).
 *
 * Vive em módulo próprio (não dentro de `CompanyCreateJob.tsx`) porque `EditSeriesModal.tsx`
 * (edição em massa "este e os futuros", R11) também precisa da MESMA lista — exportar uma
 * constante de um arquivo de página dispara `react-refresh/only-export-components` do ESLint
 * (arquivo de componente só pode exportar componentes) e duplicar a lista em dois lugares
 * arriscaria as duas divergirem.
 */
export const SHIFT_CATEGORIES: { name: string; slug: string }[] = [
    { name: 'Garçom / Garçonete', slug: 'garcom' },
    { name: 'Barista / Cafeteria', slug: 'barista' },
    { name: 'Barman / Bartender', slug: 'barman' },
    { name: 'Cozinheiro / Cozinha', slug: 'cozinha' },
    { name: 'Auxiliar de Cozinha / Cumim', slug: 'auxiliar_cozinha' },
    { name: 'Atendente / Balcão', slug: 'atendente' },
    { name: 'Caixa / Frente de Loja', slug: 'caixa' },
    { name: 'Recepção / Hostess', slug: 'recepcao' },
    { name: 'Limpeza / Copa / Steward', slug: 'limpeza' },
    { name: 'Estoque / Reposição', slug: 'estoque' },
    { name: 'Segurança / Portaria', slug: 'seguranca' },
    { name: 'Promotor / Degustação', slug: 'promotor' },
    { name: 'Auxiliar de Eventos / Buffet', slug: 'eventos' },
    { name: 'Outro (Hospitality)', slug: 'outro' },
];
