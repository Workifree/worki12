import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, PageHeader } from '../components/ui';

/** Gerado por `node scripts/gerar-licencas.mjs` a partir das dependências de runtime. */
const LICENSES_URL = '/licencas-de-terceiros.txt';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'error' };

export default function Licenses() {
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(LICENSES_URL, { signal: controller.signal });
        const text = await res.text();
        // Hospedagem de SPA devolve index.html no lugar de um arquivo que não existe.
        if (!res.ok || /^\s*<(!doctype|html)/i.test(text)) throw new Error('indisponivel');
        setState({ status: 'ready', text });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'error' });
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:py-10">
      <div className="max-w-3xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          iconLeft={<ArrowLeft size={18} />}
          className="-ml-3 mb-2"
        >
          Voltar
        </Button>
        <PageHeader title="Licenças de código aberto" subtitle="Software de terceiros usado pelo Worki" />
        <Card padding="lg" className="space-y-4 text-sm sm:text-base leading-relaxed text-gray-800">
          <p>
            O Worki usa código aberto. Abaixo estão os avisos de copyright e as licenças dos projetos
            que fazem parte do aplicativo, como o page-agent, que sustenta o assistente da tela.
          </p>

          {state.status === 'loading' && (
            <p role="status" className="font-semibold">Carregando as licenças...</p>
          )}

          {state.status === 'error' && (
            <p role="alert" className="font-semibold">
              Não foi possível carregar as licenças agora.{' '}
              <a href={LICENSES_URL} className="underline">Abrir o arquivo de texto</a>.
            </p>
          )}

          {state.status === 'ready' && (
            <>
              <pre
                tabIndex={0}
                aria-label="Texto das licenças de código aberto"
                className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words border border-gray-200 rounded-xl bg-white p-3 text-xs leading-relaxed"
              >
                {state.text}
              </pre>
              <p className="text-sm">
                <a href={LICENSES_URL} className="underline font-semibold">Baixar em texto</a>
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
