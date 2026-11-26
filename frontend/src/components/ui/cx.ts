import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge 3.x: a config padrão resolve corretamente as utilities do Tailwind 3.4 usadas aqui.
// Ajustes: o raio custom `rounded-pill` e as sombras do tema (sem isto `shadow-brutal` seria lida
// como COR de sombra e não conflitaria com `shadow-none`).
const twMerge = extendTailwindMerge({
  extend: { theme: { radius: ['pill'], shadow: ['brutal', 'brutal-sm', 'brutal-lg', 'brutal-brand'] } },
})

/**
 * Junta classes ignorando falsy e RESOLVE conflitos do Tailwind: o último vence
 * (`cx('h-11', 'h-24')` → `h-24`), então o `className` do chamador sobrescreve o padrão do
 * primitivo sem precisar de `!important`. Local aos primitivos.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(' '))
}
