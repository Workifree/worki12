/** Declara um cenário: grupo, id, papel, rota, regra que ativa o estado e o resto (prep, passos, espera...). */
export const grupoDe = (grupo) => (id, papel, rota, regra, extra = {}) => ({ grupo, id: `${grupo}-${id}`, papel, rota, regra, ...extra });
export const aria = (rotulo) => `[aria-label="${rotulo}"]`;
