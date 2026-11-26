/**
 * Degraus de XP: espelho de `worker_level_for_xp` (banco), travado por teste de paridade.
 * O NÍVEL exibido é sempre `workers.level`, gravado pelo banco; o app nunca o calcula. Os degraus
 * servem só para desenhar o progresso até o próximo.
 */
export const LEVELS = [
    { level: 1, minXp: 0 },
    { level: 2, minXp: 100 },
    { level: 3, minXp: 300 },
    { level: 4, minXp: 600 },
    { level: 5, minXp: 1000 },
    { level: 6, minXp: 1500 },
    { level: 7, minXp: 2100 },
    { level: 8, minXp: 2800 },
    { level: 9, minXp: 3600 },
    { level: 10, minXp: 4500 },
];

/**
 * Progresso REAL dentro do nível gravado no banco.
 *
 * As barras de XP usavam `xp % 100` ("assumindo 100 XP por nível") — mas os degraus
 * crescem (lvl 3=300, lvl 4=600...): um freela com 350 XP via "50/100" quando faltavam
 * 250. Número inventado sobre progresso é anti-motivação (Nielsen #1).
 * No nível máximo devolve barra cheia e restante 0.
 * Devolve `null` quando `level` e `xp` gravados se contradizem (dado antigo): melhor não mostrar
 * barra do que contradizer o nível exibido.
 */
export const levelProgress = (xp: number, level: number) => {
    const atual = LEVELS.find(l => l.level === level);
    const proximo = LEVELS.find(l => l.level === level + 1);
    if (!atual || xp < atual.minXp || (proximo && xp >= proximo.minXp)) return null;
    if (!proximo) return { percent: 100, dentroDoNivel: 0, tamanhoDoNivel: 0, faltam: 0 };
    const tamanho = proximo.minXp - atual.minXp;
    const dentro = xp - atual.minXp;
    return {
        percent: Math.min(100, Math.round((dentro / tamanho) * 100)),
        dentroDoNivel: dentro,
        tamanhoDoNivel: tamanho,
        faltam: proximo.minXp - xp,
    };
};
