
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
                    DEFAULT: '#00A651', // Strong Professional Green
                    dark: '#008840', // texto branco = 4,57:1 (AA); #008a42 dava 4,45:1
                    light: '#e6f6ec',
                },
                accent: '#111111', // Brutalist Black
                border: 'rgba(0, 0, 0, 0.1)', // Subtle border
                glass: {
                    surface: 'rgba(255, 255, 255, 0.75)',
                    border: 'rgba(255, 255, 255, 0.5)',
                }
            },
            borderRadius: {
                'xl': '16px',
                '2xl': '24px',
                '3xl': '32px',
                'pill': '999px',
            },
            boxShadow: {
                'glass': '0 4px 30px rgba(0, 0, 0, 0.03)',
                'float': '0 10px 40px -10px rgba(0,0,0,0.08)',
            }
        },
    },
    plugins: [],
}
