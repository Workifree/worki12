/**
 * Validação de destino de redirect vindo da URL/storage (`/login?redirect=`).
 *
 * Só aceita caminho INTERNO. `startsWith('/')` não basta: `//site` e `/\site` são URLs de outro
 * host para o navegador, que ainda ignora tab/quebra de linha no meio (`/\t/site`). As mesmas
 * checagens valem para as formas codificadas (`/%2F%2Fsite`, `%252F...`).
 */
const MAX_DECODE_ROUNDS = 5;

function isInternalPath(value: string): boolean {
    // Caracteres de controle e barra invertida nunca aparecem num destino legítimo nosso.
    for (const char of value) {
        const code = char.charCodeAt(0);
        if (code < 0x20 || code === 0x7f || char === '\\') return false;
    }
    return value.startsWith('/') && !value.startsWith('//');
}

export function safeInternalPath(value: string | null | undefined): string | null {
    if (!value || !isInternalPath(value)) return null;

    // Decodifica só o CAMINHO (query/hash podem legitimamente carregar `%2F`).
    let path = value.split(/[?#]/)[0];
    for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
        let decoded: string;
        try {
            decoded = decodeURIComponent(path);
        } catch {
            return null;
        }
        if (decoded === path) return value;
        if (!isInternalPath(decoded)) return null;
        path = decoded;
    }
    return null; // codificado em camadas demais: recusa
}
