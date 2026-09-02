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

export const calculateLevel = (xp: number) => {
    for (let i = LEVELS.length - 1; i >= 0; i--) {
        if (xp >= LEVELS[i].minXp) {
            return LEVELS[i].level;
        }
    }
    return 1;
};

/**
 * Progresso REAL dentro do nível atual, pelos degraus de LEVELS.
 *
 * As barras de XP usavam `xp % 100` ("assumindo 100 XP por nível") — mas os degraus
 * crescem (lvl 3=300, lvl 4=600...): um freela com 350 XP via "50/100" quando faltavam
 * 250. Número inventado sobre progresso é anti-motivação (Nielsen #1).
 * No nível máximo devolve barra cheia e restante 0.
 */
export const levelProgress = (xp: number) => {
    const nivel = calculateLevel(xp);
    const atual = LEVELS.find(l => l.level === nivel) ?? LEVELS[0];
    const proximo = LEVELS.find(l => l.level === nivel + 1);
    if (!proximo) return { percent: 100, dentroDoNivel: 0, tamanhoDoNivel: 0, faltam: 0 };
    const tamanho = proximo.minXp - atual.minXp;
    const dentro = Math.max(0, xp - atual.minXp);
    return {
        percent: Math.min(100, Math.round((dentro / tamanho) * 100)),
        dentroDoNivel: dentro,
        tamanhoDoNivel: tamanho,
        faltam: Math.max(0, proximo.minXp - xp),
    };
};
