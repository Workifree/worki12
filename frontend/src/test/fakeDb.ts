/** Banco falso dos testes de tela ao vivo: cada tabela é uma lista que o teste troca no meio. */
export interface FakeDb {
    rows: Record<string, unknown[]>
    /** Tabelas cuja leitura falha. */
    failing: Set<string>
    from: (table: string) => unknown
    reset: () => void
}

export function createFakeDb(): FakeDb {
    const db: FakeDb = {
        rows: {},
        failing: new Set(),
        reset() {
            db.rows = {}
            db.failing.clear()
        },
        from(table: string) {
            let one = false
            const result = () => {
                if (db.failing.has(table)) return { data: null, error: { message: 'rede', code: 'X' } }
                const list = db.rows[table] ?? []
                return { data: one ? list[0] ?? null : list, error: null }
            }
            const chain: Record<string, unknown> = {}
            for (const method of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'update', 'insert']) {
                chain[method] = () => chain
            }
            chain.single = chain.maybeSingle = () => { one = true; return chain }
            chain.then = (ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) =>
                Promise.resolve(result()).then(ok, no)
            return chain
        },
    }
    return db
}
