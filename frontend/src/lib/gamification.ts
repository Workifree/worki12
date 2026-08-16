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
