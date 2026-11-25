/** Registro local do que o copiloto fez. Fica só no aparelho e passa pela redação. */
import { redactPII } from './redact'

export type LogKind = 'pedido' | 'acao' | 'confirmado' | 'recusado' | 'parou' | 'bloqueado' | 'entregue'

export interface LogEntry {
  at: string
  kind: LogKind
  text: string
}

const KEY = 'worki:copilot:log'
const MAX = 60
let memory: LogEntry[] | null = null

export function readLog(): LogEntry[] {
  if (memory) return memory
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(KEY) ?? '[]')
    memory = Array.isArray(parsed) ? (parsed as LogEntry[]).slice(-MAX) : []
  } catch {
    memory = []
  }
  return memory
}

export function writeLog(kind: LogKind, text: string): void {
  memory = [...readLog(), { at: new Date().toISOString(), kind, text: redactPII(text).slice(0, 200) }].slice(-MAX)
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    // janela privada ou cota: o registro fica só em memória
  }
}

export function clearLog(): void {
  memory = []
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // idem
  }
}
