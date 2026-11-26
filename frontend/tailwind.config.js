
/** @type {import('tailwindcss').Config} */
export default {
    future: {
        // :hover só em dispositivos com hover real — evita estado "grudado" após toque no mobile.
        hoverOnlyWhenSupported: true,
    },
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            colors: {
                primary: {
                    DEFAULT: '#00A651', // verde de marca: preenchimento, barra e borda (nunca texto)
                    dark: '#008840', // fundo de botão: texto branco = 4,57:1 (AA)
                    light: '#e6f6ec',
                    ink: '#006b33', // texto e ícone verdes: 6,66:1 no branco; 5,95:1 no primary-light
                },
                accent: '#111111', // Brutalist Black
                border: 'rgba(0, 0, 0, 0.1)', // Subtle border
                canvas: '#F4F4F0', // fundo do app
                // Status semântico (lib/statusLabels.ts). Pares fg/bg entre 6,6:1 e 9,4:1.
                status: {
                    neutral: { bg: '#f3f4f6', fg: '#374151', line: '#d1d5db' },
                    info: { bg: '#eff6ff', fg: '#1e40af', line: '#bfdbfe' },
                    success: { bg: '#f0fdf4', fg: '#166534', line: '#bbf7d0' },
                    warning: { bg: '#fefce8', fg: '#854d0e', line: '#fde047' },
                    danger: { bg: '#fef2f2', fg: '#991b1b', line: '#fecaca' },
                },
                glass: {
                    surface: 'rgba(255, 255, 255, 0.75)', // legado: só o cabeçalho do MainLayout
                },
            },
            // `text-primary` e `text-primary-dark` viram o tom AA; bg e border seguem a marca.
            textColor: {
                primary: { DEFAULT: '#006b33', dark: '#006b33' },
            },
            // Raios: controle e aviso 12 (`rounded-xl`), cartão e diálogo 16 (`rounded-2xl`), selo `rounded-pill`.
            borderRadius: {
                'xl': '12px',
                '2xl': '16px',
                '3xl': '24px',
                'pill': '999px',
            },
            // Borda de controle interativo e de cartão em foco: `border-ink` (1,5px). O resto: sem
            // borda ou `border` cinza. `border-2` só no foco de campo.
            borderWidth: {
                'ink': '1.5px',
            },
            // Sombra: só `brutal-xs` (botão primário e cartão em foco) ou nenhuma.
            // Os demais tokens são LEGADO, suavizados para não gritar enquanto as telas migram.
            boxShadow: {
                'brutal-xs': '2px 2px 0 0 #000',
                'brutal-sm': '2px 2px 0 0 #000', // legado → use brutal-xs
                'brutal': '2px 2px 0 0 #000', // legado → use brutal-xs
                'brutal-lg': '0 12px 32px -8px rgba(17, 17, 17, 0.28)', // legado: elevação de diálogo/lateral
                'brutal-brand': '2px 2px 0 0 #00A651', // legado: destaque do freela
                'overlay': '0 12px 32px -8px rgba(17, 17, 17, 0.28)', // diálogo, menu e aviso flutuante
            },
            transitionDuration: { press: '80ms', fast: '150ms', base: '200ms', exit: '150ms' },
            transitionTimingFunction: {
                standard: 'cubic-bezier(.2,0,0,1)',
                enter: 'cubic-bezier(0,0,0,1)',
                exit: 'cubic-bezier(.3,0,1,1)',
            },
        },
    },
    plugins: [],
}
