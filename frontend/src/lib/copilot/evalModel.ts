/**
 * SÓ EM DESENVOLVIMENTO: escolhe o modelo para comparação, pelo modo de avaliação da função
 * (que só aceita as contas de teste). No build de produção `import.meta.env.DEV` é `false` e o
 * corpo inteiro sai do bundle.
 */
export const EVAL_MODEL_KEY = 'worki:copilot:eval-model'

export function devEvalModel(): { eval: { model: string } } | null {
  if (import.meta.env.DEV) {
    try {
      const model = window.localStorage.getItem(EVAL_MODEL_KEY)
      if (model) return { eval: { model } }
    } catch {
      // sem armazenamento: caminho de produção
    }
  }
  return null
}
