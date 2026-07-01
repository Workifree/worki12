import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Article 5 do projeto: o padrão de dados canônico é useEffect + setState (fetch/reset
      // on mount/open). A regra set-state-in-effect (recommended do react-hooks) conflita com
      // esse padrão constitucional; mantida como AVISO (visível), não como erro que quebra o build.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
])
