export const MAIN_CONTENT_ID = 'conteudo';

/** Primeiro foco dos layouts: leva o teclado direto ao conteúdo, sem passar pelo menu. */
export default function SkipLink() {
    return (
        <a
            href={`#${MAIN_CONTENT_ID}`}
            onClick={(e) => {
                // Sem trocar o hash da URL (o roteador veria uma navegação).
                e.preventDefault();
                document.getElementById(MAIN_CONTENT_ID)?.focus();
            }}
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:rounded-xl focus:border-2 focus:border-black focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-bold focus:text-black"
        >
            Pular para o conteúdo
        </a>
    );
}
