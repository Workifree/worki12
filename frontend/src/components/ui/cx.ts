import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge 3.x: a config padrão resolve corretamente as utilities do Tailwind 3.4 usadas aqui.
// Ajustes: o raio custom `rounded-pill` e as sombras do tema (sem isto `shadow-brutal` seria lida
// como COR de sombra e não conflitaria com `shadow-none`) e a largura `border-ink` (1,5px; sem
// isto seria lida como COR de borda e apagaria `border-black`).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ['pill'],
      shadow: ['brutal-xs', 'brutal', 'brutal-sm', 'brutal-lg', 'brutal-brand', 'overlay'],
    },
    classGroups: {
      'border-w': [{ border: ['ink'] }],
      'border-w-x': [{ 'border-x': ['ink'] }],
      'border-w-y': [{ 'border-y': ['ink'] }],
      'border-w-t': [{ 'border-t': ['ink'] }],
      'border-w-b': [{ 'border-b': ['ink'] }],
      'border-w-l': [{ 'border-l': ['ink'] }],
      'border-w-r': [{ 'border-r': ['ink'] }],
    },
  },
})

/**
 * Junta classes ignorando falsy e RESOLVE conflitos do Tailwind: o último vence
 * (`cx('h-11', 'h-24')` → `h-24`), então o `className` do chamador sobrescreve o padrão do
 * primitivo sem precisar de `!important`. Local aos primitivos.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(' '))
}
