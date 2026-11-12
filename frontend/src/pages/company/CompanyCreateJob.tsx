import { useState, useEffect, useMemo, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Send, Users, X, Repeat, Megaphone } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import { logError } from '../../lib/logger';
import { todayLocalDate, formatDateOnly, localDateToTimestamp } from '../../lib/dateUtils';
import { generateOccurrenceDates, MAX_SERIES_OCCURRENCES } from '../../lib/recurrence';
import { JobSeriesService } from '../../services/jobSeriesService';
import { useCompanyTeam } from '../../hooks/useTeamConnections';
import { useCompanyInvites } from '../../hooks/useShiftInvites';
import { SHIFT_CATEGORIES } from '../../components/company/shiftCategories';
import type { TeamMember, RecurrenceType } from '../../types';
import { getAuthenticatedCompanyId } from '../../services/companyScopeService';
import { rotuloDeDias, WEEKDAY_FULL_LABELS } from '../../lib/weekdayLabels';
import { Button, Card, Field, PageHeader } from '../../components/ui';
import type { ReactNode } from 'react';

// Dom(0)..Sáb(6) — mesma convenção de `job_series.weekdays` (spec R1).
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Secao do formulario: card + titulo + campos com ritmo fixo (gap-4).
function FormSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <Card as="section" aria-label={title}>
            <h2 className="text-lg font-bold">{title}</h2>
            <div className="mt-4 flex flex-col gap-4">{children}</div>
        </Card>
    );
}

// Chips de dia da semana (toggle). Nao sao botoes de acao: so o estado muda.
const CHIP_BASE = 'h-11 rounded-xl border-2 border-black text-sm font-bold transition-colors';
const CHIP_ON = 'bg-black text-white';
const CHIP_OFF = 'bg-white text-black hover:bg-gray-100';

export default function CompanyCreateJob() {
    const navigate = useNavigate();
    const { id } = useParams(); // Add useParams
    const isEditing = !!id;

    // --- Repetir turno -------------------------------------------------------------------------
    // `?repetir=<jobId>` cria um turno NOVO com os dados de um anterior. Nao e edicao: `isEditing`
    // continua falso, entao o fluxo grava um registro novo.
    //
    // Por que existe: criar um turno exige hoje SETE entradas obrigatorias (titulo, categoria entre
    // 14 opcoes, descricao, valor, data, entrada e saida), espalhadas em tres etapas -- e a empresa
    // repete o MESMO tipo de turno o tempo todo. Recriar tudo a cada vez e trabalho que o sistema ja
    // tem guardado; a heuristica classica e "reconhecer em vez de lembrar" (Nielsen #6), e o que
    // pesa nao e a contagem de cliques, e o custo de interacao -- ler, decidir, digitar
    // (Nielsen Norman Group, "interaction cost").
    //
    // A DATA nao vem junto de proposito: e a unica coisa que necessariamente muda entre uma
    // repeticao e outra, e herda-la silenciosamente criaria turno na data errada.
    const [searchParams] = useSearchParams();
    const repetirId = searchParams.get('repetir');

    const { addToast } = useToast();
    const queryClient = useQueryClient();

    const startDateRef = useRef<HTMLInputElement>(null);
    const [loading, setLoading] = useState(false);
    const [createdJobId, setCreatedJobId] = useState<string | null>(null);
    const [showInvitePanel, setShowInvitePanel] = useState(false);

    // Escala Recorrente (F3) — só na criação (não em edição, série é imutável, ADR-20260817).
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('weekly');
    const [weekdays, setWeekdays] = useState<number[]>([]);
    const [rangeEndDate, setRangeEndDate] = useState('');
    const [createdSeriesSummary, setCreatedSeriesSummary] = useState<{ occurrences: number; label: string } | null>(null);

    const [formData, setFormData] = useState({
        title: '',
        category: '',
        type: 'freelance', // sempre freelance/diária no pivô presencial (sem CLT/fixo)
        description: '',
        requirements: '',
        briefing: '',
        // F8 — requisito de certificação do turno. Texto livre, ADVISORY (avisa, nunca trava):
        // aparece só como banner no ShiftCallModal, nunca filtra nem desabilita ninguém.
        certification_requirement: '',
        location: '',
        budget: '',
        budget_type: 'daily', // hourly, daily, project — postpago v1 = fixo por turno
        start_date: '',
        scope: 'on-site', // sempre presencial no pivô (sem remoto/híbrido)
        work_start_time: '',
        work_end_time: '',
        has_lunch: false,
        /** Quantas pessoas o turno precisa (F1). Texto no form, inteiro no banco. */
        slots: '1'
    });

    // Hooks de equipe e convites — carregados após criação do job
    const { teamMembers, loading: teamLoading } = useCompanyTeam();
    const { invite, invitingWorkerId, invites: sentInvites } = useCompanyInvites(createdJobId ?? '');

    // Etapa 2 — divulgacao progressiva (NN/g): dos quatro campos da tela, so a DESCRICAO e
    // obrigatoria, mas os quatro apareciam com o mesmo peso visual — e o botao desabilitado nao
    // dizia qual travava. Requisitos, briefing e certificacao ficam atras de um toggle e ABREM
    // SOZINHOS quando ja tem conteudo (edicao, repeticao, briefing padrao pre-preenchido): o
    // recolhimento nunca esconde dado, so adiamento de campo vazio. Recolher nao apaga nada.
    // ── Modelos: comece de um turno anterior ────────────────────────────────────────────────
    // A empresa repete o MESMO turno o tempo todo, e criar do zero custa sete entradas em tres
    // etapas. Em vez de um sistema de "modelos salvos" (que criaria trabalho de gestao — criar,
    // nomear, atualizar, apagar modelo: complexidade empurrada pro usuario, contra a lei de
    // Tesler), o modelo E o historico real: os ultimos turnos distintos viram cartoes de um
    // toque. Reconhecimento em vez de memoria (Nielsen #6) — a pessoa VE o turno que ja fez,
    // toca, e so escolhe a nova data (o mesmo motor do ?repetir=). Historico vazio = secao some.
    interface ModeloDeTurno { id: string; title: string; budget: number | null; work_start_time: string | null; work_end_time: string | null; created_at: string | null }
    const [modelos, setModelos] = useState<ModeloDeTurno[]>([]);
    useEffect(() => {
        if (isEditing || repetirId) return;
        let ativo = true;
        void (async () => {
            try {
                const companyId = await getAuthenticatedCompanyId();
                const { data } = await supabase
                    .from('jobs')
                    .select('id, title, budget, work_start_time, work_end_time, created_at')
                    .eq('company_id', companyId)
                    .neq('status', 'deleted')
                    .order('created_at', { ascending: false })
                    .limit(30);
                if (!ativo || !data) return;
                // dedupe por titulo normalizado: a serie de 10 "Garcom sabado" vira UM cartao (o mais recente)
                const vistos = new Set<string>();
                const unicos: ModeloDeTurno[] = [];
                for (const j of data as ModeloDeTurno[]) {
                    const chave = (j.title || '').trim().toLowerCase();
                    if (!chave || vistos.has(chave)) continue;
                    vistos.add(chave);
                    unicos.push(j);
                    if (unicos.length >= 6) break;   // Hick: poucos, os mais recentes
                }
                setModelos(unicos);
            } catch {
                /* vitrine e conveniencia: sem historico legivel, o wizard normal segue intacto */
            }
        })();
        return () => { ativo = false; };
    }, [isEditing, repetirId]);

    // ── Rascunho: trabalho digitado nunca se perde em silencio ──────────────────────────────
    // Prevencao de perda (Nielsen #5) + efeito Zeigarnik: quem escreveu a descricao e saiu num
    // toque errado (ou o celular matou a aba) deve RETOMAR, nao recomecar. localStorage (nao
    // session: aba morta e justamente o caso), 24h de validade, e o rascunho so existe se ha
    // conteudo digitado — campo vazio nunca vira rascunho. Criou o turno? Rascunho morre.
    // Edicao e ?repetir= ficam de fora: intencao explicita vence rascunho.
    const RASCUNHO_KEY = 'worki_rascunho_turno';
    const rascunhoRestaurado = useRef(false);
    useEffect(() => {
        if (isEditing || repetirId || rascunhoRestaurado.current) return;
        rascunhoRestaurado.current = true;
        try {
            const bruto = localStorage.getItem(RASCUNHO_KEY);
            if (!bruto) return;
            const r = JSON.parse(bruto) as { em?: number; formData?: typeof formData };
            if (!r?.formData || Date.now() - (r.em ?? 0) > 24 * 60 * 60 * 1000) {
                localStorage.removeItem(RASCUNHO_KEY);
                return;
            }
            setFormData((prev) => ({ ...prev, ...r.formData }));
            addToast('Rascunho recuperado — continue de onde parou.', 'info');
        } catch {
            /* rascunho ilegivel: ignora e segue com o formulario limpo */
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restauracao unica no mount
    }, []);

    useEffect(() => {
        if (isEditing || showInvitePanel) return;   // editar nao gera rascunho; criado = rascunho morto
        const t = setTimeout(() => {
            try {
                const temAlgo = formData.title.trim() || formData.description.trim() || formData.budget;
                if (!temAlgo) { localStorage.removeItem(RASCUNHO_KEY); return; }
                localStorage.setItem(RASCUNHO_KEY, JSON.stringify({ em: Date.now(), formData }));
            } catch { /* storage indisponivel: rascunho e conveniencia */ }
        }, 600);
        return () => clearTimeout(t);
    }, [formData, isEditing, showInvitePanel]);

    const [mostrarOpcionais, setMostrarOpcionais] = useState(false);
    useEffect(() => {
        if (formData.requirements || formData.briefing || formData.certification_requirement) {
            setMostrarOpcionais(true);
        }
    }, [formData.requirements, formData.briefing, formData.certification_requirement]);

    // Fetch Job Data if Editing
    useEffect(() => {
        if (isEditing) {
            fetchJobData(id!, 'editar');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchJobData usa state setters estaveis, so precisa re-executar quando id muda
    }, [id]);

    // Repetir: carrega o turno-modelo, limpa a data e ja abre na etapa em que ela e escolhida.
    useEffect(() => {
        if (isEditing || !repetirId) return;
        void fetchJobData(repetirId, 'repetir');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mesmos setters estaveis
    }, [repetirId]);

    // Pré-preenche o Briefing com o briefing padrão do negócio (só ao criar, e só se
    // ainda estiver vazio — a empresa pode ajustar/incrementar por turno).
    useEffect(() => {
        if (isEditing) return;
        let active = true;
        void (async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { data } = await supabase
                .from('companies')
                .select('default_briefing')
                .eq('id', user.id)
                .maybeSingle();
            if (!active || !data?.default_briefing) return;
            setFormData(prev => (prev.briefing ? prev : { ...prev, briefing: data.default_briefing as string }));
        })();
        return () => { active = false; };
    }, [isEditing]);

    const fetchJobData = async (jobId: string, modo: 'editar' | 'repetir' = 'editar') => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) { navigate('/login'); return; }

            const { data, error } = await supabase
                .from('jobs')
                .select('*')
                .eq('id', jobId)
                .eq('company_id', await getAuthenticatedCompanyId())
                .single();

            if (error) throw error;
            if (data) {
                setFormData({
                    title: data.title,
                    category: data.category,
                    type: data.type,
                    description: data.description,
                    requirements: data.requirements,
                    briefing: data.briefing || '',
                    certification_requirement: data.certification_requirement || '',
                    location: data.location || '',
                    budget: data.budget?.toString() || '',
                    budget_type: data.budget_type,
                    // Ao repetir, a data fica em branco: e a unica coisa que muda de verdade entre
                    // uma repeticao e outra, e herda-la criaria turno na data errada em silencio.
                    start_date: modo === 'repetir' ? '' : (data.start_date ? data.start_date.split('T')[0] : ''),
                    scope: data.scope,
                    work_start_time: data.work_start_time || '',
                    work_end_time: data.work_end_time || '',
                    has_lunch: data.has_lunch || false,
                    slots: String(data.slots ?? 1)
                });
                // O que falta preencher e a data -- leva o foco direto a ela (o formulario e uma
                // pagina so, entao o foco tambem rola ate o campo).
                if (modo === 'repetir') setTimeout(() => startDateRef.current?.focus(), 0);
            }
        } catch (error) {
            logError('Error fetching job:', error);
            navigate('/company/jobs');
        }
    };

    const calculateHours = (start: string, end: string, lunch: boolean = false) => {
        if (!start || !end) return { total: 0, work: 0 };
        const [startH, startM] = start.split(':').map(Number);
        const [endH, endM] = end.split(':').map(Number);

        let total = (endH + endM / 60) - (startH + startM / 60);
        if (total < 0) total += 24; // Handle overnight

        const work = lunch ? Math.max(0, total - 1) : total;
        return {
            total: total.toFixed(1).replace('.0', ''),
            work: work.toFixed(1).replace('.0', '')
        };
    };

    const toggleWeekday = (day: number) => {
        setWeekdays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b));
    };

    // Pré-visualização ao vivo (R8/A3) — recalcula a lista de datas a cada mudança nos
    // parâmetros de recorrência. Função pura de `lib/recurrence.ts`, testável isoladamente;
    // aqui só consumimos o resultado para o texto e o bloqueio de envio.
    const occurrenceDates = useMemo(() => {
        if (!isRecurring || !formData.start_date || !rangeEndDate) return [];
        if (recurrenceType === 'weekly' && weekdays.length === 0) return [];
        if (rangeEndDate < formData.start_date) return [];
        try {
            return generateOccurrenceDates({
                recurrenceType,
                weekdays: recurrenceType === 'weekly' ? weekdays : undefined,
                rangeStartDate: formData.start_date,
                rangeEndDate,
            });
        } catch (error) {
            logError('CompanyCreateJob.occurrenceDates', error);
            return [];
        }
    }, [isRecurring, recurrenceType, weekdays, formData.start_date, rangeEndDate]);

    const overCap = occurrenceDates.length > MAX_SERIES_OCCURRENCES;

    const previewDatesLabel = useMemo(() => {
        const shown = occurrenceDates.slice(0, 6).map(d => formatDateOnly(d, 'dd/MM'));
        return occurrenceDates.length > shown.length ? `${shown.join(', ')}…` : shown.join(', ');
    }, [occurrenceDates]);

    // Resumo pós-criação (R9): "toda domingo, de 06/09 a 27/09" / "todos os dias, de 01/09 a 05/09".
    const buildRecurrenceLabel = (): string => {
        const startLabel = formatDateOnly(formData.start_date, 'dd/MM');
        const endLabel = formatDateOnly(rangeEndDate, 'dd/MM');
        if (recurrenceType === 'daily') {
            return `todos os dias, de ${startLabel} a ${endLabel}`;
        }
        return `${rotuloDeDias([...weekdays])}, de ${startLabel} a ${endLabel}`;
    };

    // O QUE FALTA no formulario, em palavras.
    //
    // O botao ficava desabilitado sem dizer por que -- a pessoa nao tinha como adivinhar qual
    // campo travava. O onboarding deste mesmo produto ja diz o que falta; nao dizer aqui e
    // inconsistencia interna (Nielsen #1, visibilidade do estado, e #4, consistencia) num
    // formulario que a empresa preenche toda semana. E tambem a unica fonte de validade:
    // `canProceed` e "nao falta nada".
    const oQueFalta = (): string[] => {
        const falta: string[] = [];
        if (!formData.title.trim()) falta.push('o título do turno');
        if (!formData.category) falta.push('a função');
        if (!formData.description.trim()) falta.push('a descrição');
        if (!(parseFloat(formData.budget) > 0)) falta.push('o valor');
        if (!formData.start_date) falta.push('a data');
        else if (formData.start_date < todayLocalDate()) falta.push('uma data que ainda não passou');
        if (!formData.work_start_time) falta.push('o horário de entrada');
        if (!formData.work_end_time) falta.push('o horário de saída');
        if (!isEditing && isRecurring) {
            if (recurrenceType === 'weekly' && weekdays.length === 0) falta.push('os dias da semana');
            if (!rangeEndDate || rangeEndDate < formData.start_date) falta.push('a data final da série');
            else if (occurrenceDates.length === 0) falta.push('ao menos uma data na série');
            else if (overCap) falta.push(`um período menor (a série passaria de ${MAX_SERIES_OCCURRENCES} turnos)`);
        }
        return falta;
    };

    const faltas = oQueFalta();
    const podeEnviar = faltas.length === 0;

    const handleSubmit = async () => {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Usuário não autenticado");

            const budgetAmount = parseFloat(formData.budget) || 0;

            // Modelo postpago (Slice 1): sem reserva de escrow na criação — apenas inserir o job.
            // A cobrança acontece na conclusão do turno (Slice 2).
            if (!isEditing && budgetAmount <= 0) {
                addToast('Por favor, defina um valor para o turno.', 'error');
                setLoading(false);
                return;
            }

            // Escala Recorrente (F3) — caminho separado: cria 1 job_series + N jobs via RPC
            // atômica (ADR-20260817). Nunca em edição (série é imutável exceto por status).
            if (!isEditing && isRecurring) {
                if (recurrenceType === 'weekly' && weekdays.length === 0) {
                    addToast('Marque pelo menos um dia da semana.', 'error');
                    setLoading(false);
                    return;
                }
                if (!rangeEndDate || rangeEndDate < formData.start_date) {
                    addToast('Defina uma data final válida para a recorrência.', 'error');
                    setLoading(false);
                    return;
                }
                if (occurrenceDates.length === 0) {
                    addToast('Nenhum turno seria criado com essas datas. Ajuste o período ou os dias da semana.', 'error');
                    setLoading(false);
                    return;
                }
                // R7/A3: bloqueio NO CLIENT antes de qualquer INSERT — a RPC reforça o mesmo
                // limite no banco (defesa em profundidade), mas aqui é a primeira barreira.
                if (occurrenceDates.length > MAX_SERIES_OCCURRENCES) {
                    addToast(`Essa configuração criaria ${occurrenceDates.length} turnos — o limite é ${MAX_SERIES_OCCURRENCES}. Encurte o período ou marque menos dias da semana.`, 'error');
                    setLoading(false);
                    return;
                }

                const result = await JobSeriesService.createSeries({
                    recurrenceType,
                    weekdays: recurrenceType === 'weekly' ? weekdays : undefined,
                    rangeStartDate: formData.start_date,
                    rangeEndDate,
                    occurrenceDates,
                    jobTemplate: {
                        title: formData.title,
                        category: formData.category,
                        type: formData.type,
                        description: formData.description,
                        requirements: formData.requirements,
                        briefing: formData.briefing,
                        location: formData.location,
                        budget: budgetAmount,
                        budget_type: formData.budget_type,
                        scope: formData.scope,
                        work_start_time: formData.work_start_time,
                        work_end_time: formData.work_end_time,
                        has_lunch: formData.has_lunch,
                        slots: Math.max(1, Number.parseInt(formData.slots, 10) || 1),
                    },
                });

                if (result.error || !result.seriesId) {
                    // LM-12: duplo-clique cai no índice único (23505 no banco) — o service já
                    // traduz esse caso para "Essa série já foi criada.", nunca repassa cru.
                    addToast(result.error || 'Erro ao criar a série de turnos.', 'error');
                    setLoading(false);
                    return;
                }

                await queryClient.invalidateQueries({ queryKey: ['companyJobs'] });
                setCreatedSeriesSummary({ occurrences: result.occurrences, label: buildRecurrenceLabel() });
                setLoading(false);
                return;
            }

            const payload = {
                // Gerente de unidade (F13) nao e dono: `user.id` aqui produzia um INSERT que a
                // RLS (is_company_owner) recusa. A empresa correta e a que a sessao OPERA.
                company_id: await getAuthenticatedCompanyId(),
                title: formData.title,
                category: formData.category,
                type: formData.type,
                description: formData.description,
                requirements: formData.requirements,
                briefing: formData.briefing,
                // F8 — advisory, nunca trava (jobs.certification_requirement, texto livre ≤200).
                certification_requirement: formData.certification_requirement.trim() || null,
                location: formData.location,
                budget: budgetAmount,
                budget_type: formData.budget_type,
                // meio-dia local evita o off-by-one de fuso (meia-noite UTC virava o dia anterior em BRT)
                start_date: formData.start_date ? localDateToTimestamp(formData.start_date) : null,
                scope: formData.scope,
                work_start_time: formData.work_start_time,
                work_end_time: formData.work_end_time,
                has_lunch: formData.has_lunch,
                // CHECK (slots >= 1) no banco — o clamp aqui evita que um campo limpo pela
                // pessoa (string vazia → NaN) vire erro de constraint na cara dela.
                slots: Math.max(1, Number.parseInt(formData.slots, 10) || 1),
                // `status` NÃO entra aqui de propósito — ver o insert e o update abaixo.
                // Este payload é compartilhado pelos dois caminhos, e enquanto ele carregava
                // `status: 'open'` fixo, EDITAR um turno reescrevia o status: um turno `paused`
                // voltava a `open` e um `deleted` era RESSUSCITADO, sem nada na tela dizendo isso.
                // O status é da máquina de estados (botão Pausar/Reativar, exclusão), não do
                // formulário de edição — quem edita título e valor não está decidindo ciclo de vida.
            };

            if (isEditing) {
                // .select('id') obrigatório (patterns.md — UPDATE sob RLS negado em silêncio):
                // RLS de `jobs` foi ligada nesta revisão — "Turno atualizado com sucesso!" não
                // pode mentir quando o UPDATE afetou 0 linhas.
                const { data: updated, error } = await supabase.from('jobs').update(payload).eq('id', id).select('id');
                if (error) throw error;
                if (!updated || updated.length === 0) {
                    throw new Error('Não foi possível salvar as alterações: verifique se você ainda tem permissão sobre este turno.');
                }
                // Invalida o cache do React Query (staleTime 5min) para o dashboard não
                // continuar mostrando o título/dados ANTIGOS do turno em "Turnos Recentes".
                await queryClient.invalidateQueries({ queryKey: ['companyJobs'] });
                await queryClient.invalidateQueries({ queryKey: ['companyApplications'] });
                addToast('Turno atualizado com sucesso!', 'success');
                navigate('/company/dashboard');
            } else {
                // Criar turno — SEM reservar escrow (postpago, Slice 2)
                // `status: 'open'` só na CRIAÇÃO: turno novo nasce aberto. No UPDATE acima ele é
                // deliberadamente omitido, para a edição não reescrever o ciclo de vida.
                const { data: newJob, error } = await supabase.from('jobs').insert({ ...payload, status: 'open' }).select().single();
                if (error) throw error;

                // Novo turno deve aparecer imediatamente no dashboard (invalida cache).
                await queryClient.invalidateQueries({ queryKey: ['companyJobs'] });
                addToast('Turno criado! Convide um freela do seu elenco.', 'success');
                setCreatedJobId(newJob.id);
                setShowInvitePanel(true);
                try { localStorage.removeItem('worki_rascunho_turno'); } catch { /* ok */ }
            }
        } catch (error: unknown) {
            logError('Error saving job:', error);
            addToast(error instanceof Error ? error.message : 'Erro ao salvar turno. Verifique os dados.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const unidadeValor = formData.budget_type === 'hourly' ? 'por hora' : formData.budget_type === 'daily' ? 'por dia' : 'total do projeto';
    const horasTotais = formData.work_start_time && formData.work_end_time
        ? calculateHours(formData.work_start_time, formData.work_end_time)
        : null;
    const horasTrabalho = formData.work_start_time && formData.work_end_time
        ? calculateHours(formData.work_start_time, formData.work_end_time, formData.has_lunch)
        : null;

    const rotuloEnviar = isEditing ? 'Salvar alterações' : (isRecurring ? 'Criar série de turnos' : 'Criar turno');

    return (
        <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            <Button
                variant="ghost"
                onClick={() => navigate(-1)}
                iconLeft={<ArrowLeft size={16} strokeWidth={3} />}
                className="-ml-3 mb-2"
            >
                Voltar
            </Button>
            <PageHeader
                title={isEditing ? 'Editar turno' : 'Novo turno'}
                subtitle={isEditing ? 'Ajuste os dados do turno.' : 'Turno presencial. Você combina e paga o freela direto — o Worki registra e emite o recibo.'}
            />

            <div className="flex flex-col gap-6">
                {/* Modelos: o turno real que a empresa ja fez vira um toque. Historico vazio = some. */}
                {!isEditing && !repetirId && modelos.length > 0 && (
                    <section aria-label="Comece de um turno anterior">
                        <h2 className="text-sm font-bold">Comece de um turno anterior</h2>
                        <p className="mt-0.5 mb-3 text-xs text-gray-600">Preenche tudo pra você — só escolha a nova data.</p>
                        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0">
                            {modelos.map((mo) => (
                                <button
                                    key={mo.id}
                                    type="button"
                                    onClick={() => { void fetchJobData(mo.id, 'repetir'); }}
                                    className="min-h-11 w-56 shrink-0 rounded-xl border-2 border-black bg-white px-4 py-2.5 text-left transition-colors hover:bg-gray-50 sm:w-auto"
                                >
                                    <span className="block truncate text-sm font-bold">{mo.title}</span>
                                    <span className="block truncate text-xs text-gray-600">
                                        {mo.budget ? `R$ ${mo.budget}` : ''}{mo.work_start_time ? ` · ${mo.work_start_time}–${mo.work_end_time ?? ''}` : ''}
                                        {/* recencia = confianca de que e o turno certo ("e o do sabado passado mesmo") */}
                                        {mo.created_at ? ` · ${formatDistanceToNow(new Date(mo.created_at), { addSuffix: true, locale: ptBR })}` : ''}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                <FormSection title="O turno">
                    <Field label="Título do turno" required>
                        <input
                            type="text"
                            aria-label="Título do Turno"
                            placeholder="Ex.: Garçom para evento de sábado"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        />
                    </Field>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Função" required>
                            <select
                                aria-label="Função"
                                value={formData.category}
                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                            >
                                <option value="">Selecione a função</option>
                                {SHIFT_CATEGORIES.map(cat => (
                                    <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                                ))}
                            </select>
                        </Field>

                        {/* Vagas (F1): quantas pessoas o turno precisa. E o denominador do chamado —
                            com 3 vagas, o disparo so fecha no terceiro aceite. */}
                        <Field label="Quantas pessoas" hint="O chamado fica aberto até preencher todas as vagas.">
                            <input
                                type="number"
                                min={1}
                                step={1}
                                aria-label="Quantas pessoas o turno precisa"
                                value={formData.slots}
                                onChange={(e) => setFormData({ ...formData, slots: e.target.value })}
                            />
                        </Field>
                    </div>

                    <Field label="Descrição" required>
                        <textarea
                            aria-label="Descrição Completa"
                            className="!h-auto min-h-28 resize-y py-3"
                            placeholder="Dinâmica do turno, responsabilidades e postura esperada."
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        />
                    </Field>
                </FormSection>

                <FormSection title="Quando e onde">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <Field label="Data de início" required hint={!isEditing && isRecurring ? 'Primeira data da série.' : undefined}>
                            <input
                                ref={startDateRef}
                                type="date"
                                aria-label="Data de início"
                                min={todayLocalDate()}
                                value={formData.start_date}
                                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                            />
                        </Field>
                        <Field label="Entrada" required>
                            <input
                                type="time"
                                aria-label="Horário de entrada"
                                value={formData.work_start_time}
                                onChange={(e) => setFormData({ ...formData, work_start_time: e.target.value })}
                            />
                        </Field>
                        <Field label="Saída" required>
                            <input
                                type="time"
                                aria-label="Horário de saída"
                                value={formData.work_end_time}
                                onChange={(e) => setFormData({ ...formData, work_end_time: e.target.value })}
                            />
                        </Field>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label htmlFor="lunch" className="flex min-h-11 cursor-pointer select-none items-center gap-3 text-sm font-bold">
                            <input
                                type="checkbox"
                                id="lunch"
                                className="h-5 w-5 rounded accent-black"
                                checked={formData.has_lunch}
                                onChange={(e) => setFormData({ ...formData, has_lunch: e.target.checked })}
                            />
                            Intervalo de almoço (1h)
                        </label>
                        {horasTotais && horasTrabalho && (
                            <p className="text-xs text-gray-600">
                                {horasTotais.total}h de turno{formData.has_lunch ? ` · ${horasTrabalho.work}h de trabalho` : ''}
                            </p>
                        )}
                    </div>

                    <Field label="Localização">
                        <input
                            type="text"
                            aria-label="Localização Específica"
                            placeholder="Ex.: Rua Augusta, 1200 - Consolação, São Paulo"
                            value={formData.location}
                            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                        />
                    </Field>

                    {/* Escala Recorrente (F3) — so na criacao; edicao de ocorrencia isolada nao vira serie.
                        Recolhido por padrao: a maioria dos turnos e unico. */}
                    {!isEditing && (
                        <div className="rounded-xl border-2 border-dashed border-gray-300 p-4">
                            <label htmlFor="job-repeat" className="flex min-h-11 cursor-pointer select-none items-start gap-3">
                                <input
                                    type="checkbox"
                                    id="job-repeat"
                                    className="mt-0.5 h-5 w-5 shrink-0 rounded accent-black"
                                    checked={isRecurring}
                                    onChange={(e) => setIsRecurring(e.target.checked)}
                                />
                                <span>
                                    <span className="flex items-center gap-2 text-sm font-bold"><Repeat size={16} /> Repetir este turno</span>
                                    <span className="block text-xs text-gray-600">Cria vários turnos de uma vez, com o mesmo horário e valor.</span>
                                </span>
                            </label>

                            {isRecurring && (
                                <div className="mt-4 flex flex-col gap-4 border-t-2 border-dashed border-gray-300 pt-4">
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-sm font-bold">Tipo de recorrência</span>
                                        <div className="flex flex-col gap-2 sm:flex-row">
                                            <Button
                                                variant={recurrenceType === 'weekly' ? 'dark' : 'secondary'}
                                                onClick={() => setRecurrenceType('weekly')}
                                                aria-pressed={recurrenceType === 'weekly'}
                                                className="flex-1"
                                            >
                                                Toda semana
                                            </Button>
                                            <Button
                                                variant={recurrenceType === 'daily' ? 'dark' : 'secondary'}
                                                onClick={() => setRecurrenceType('daily')}
                                                aria-pressed={recurrenceType === 'daily'}
                                                className="flex-1"
                                            >
                                                Cobrir um período
                                            </Button>
                                        </div>
                                        {recurrenceType === 'daily' && (
                                            <p className="text-xs text-gray-600">Ex.: cobrir uma folga de férias — um turno por dia corrido no período.</p>
                                        )}
                                    </div>

                                    {recurrenceType === 'weekly' && (
                                        <div className="flex flex-col gap-1.5">
                                            <span id="job-weekdays-label" className="text-sm font-bold">Dias da semana</span>
                                            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="job-weekdays-label">
                                                {WEEKDAY_LABELS.map((label, day) => (
                                                    <button
                                                        key={day}
                                                        type="button"
                                                        onClick={() => toggleWeekday(day)}
                                                        aria-pressed={weekdays.includes(day)}
                                                        aria-label={WEEKDAY_FULL_LABELS[day]}
                                                        className={`w-11 ${CHIP_BASE} ${weekdays.includes(day) ? CHIP_ON : CHIP_OFF}`}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <Field label="Repetir até" required>
                                        <input
                                            type="date"
                                            aria-label="Repetir até"
                                            min={formData.start_date || todayLocalDate()}
                                            value={rangeEndDate}
                                            onChange={(e) => setRangeEndDate(e.target.value)}
                                        />
                                    </Field>

                                    {/* Pre-visualizacao ao vivo (R8) */}
                                    <p
                                        role="status"
                                        className={`rounded-xl border-2 p-3 text-sm ${overCap ? 'border-red-300 bg-red-50 font-bold text-red-700' : 'border-black bg-white font-medium'}`}
                                    >
                                        {occurrenceDates.length === 0 ? (
                                            <span className="text-gray-600">Defina os dias e o período para ver quantos turnos serão criados.</span>
                                        ) : overCap ? (
                                            <span>Essa configuração criaria {occurrenceDates.length} turnos — o limite é {MAX_SERIES_OCCURRENCES}. Encurte o período ou marque menos dias da semana.</span>
                                        ) : (
                                            <span>
                                                Serão criados <strong>{occurrenceDates.length}</strong> turno{occurrenceDates.length > 1 ? 's' : ''} — {previewDatesLabel}
                                            </span>
                                        )}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}
                </FormSection>

                <FormSection title="Valor">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Tipo de pagamento">
                            <select
                                aria-label="Tipo de Pagamento"
                                value={formData.budget_type}
                                onChange={(e) => setFormData({ ...formData, budget_type: e.target.value })}
                            >
                                <option value="hourly">Por hora</option>
                                <option value="daily">Por dia</option>
                                <option value="project">Projeto fixo</option>
                            </select>
                        </Field>
                        <Field
                            label="Valor"
                            required
                            hint={isEditing ? 'O valor não pode ser alterado após a criação.' : `Em reais, ${unidadeValor}.`}
                        >
                            <input
                                type="number"
                                inputMode="decimal"
                                aria-label="Valor do orçamento"
                                placeholder="0,00"
                                value={formData.budget}
                                onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                                disabled={isEditing}
                            />
                        </Field>
                    </div>
                </FormSection>

                {/* Avancados recolhidos. Abrem sozinhos quando ja tem conteudo (edicao, repeticao,
                    briefing padrao pre-preenchido): o recolhimento nunca esconde dado, so adia campo
                    vazio. Recolher nao apaga nada. */}
                <section aria-label="Detalhes opcionais">
                    <Button
                        variant="secondary"
                        fullWidth
                        onClick={() => setMostrarOpcionais(v => !v)}
                        aria-expanded={mostrarOpcionais}
                        aria-controls="job-opcionais"
                        iconRight={mostrarOpcionais ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        className="justify-between"
                    >
                        Requisitos, briefing e certificação (opcional)
                    </Button>

                    {mostrarOpcionais && (
                        <Card id="job-opcionais" className="mt-4">
                            <div className="flex flex-col gap-4">
                                <Field label="Requisitos (opcional)">
                                    <textarea
                                        aria-label="Requisitos (opcional)"
                                        className="!h-auto min-h-24 resize-y py-3"
                                        placeholder={'- Experiência em atendimento ou preparo\n- Agilidade e pontualidade'}
                                        value={formData.requirements}
                                        onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
                                    />
                                </Field>

                                <Field
                                    label="Briefing do turno (opcional)"
                                    hint="Regras da casa, cardápio, dress code — o freela vê isso no convite."
                                >
                                    <textarea
                                        id="briefing"
                                        aria-label="Briefing do Turno (opcional)"
                                        className="!h-auto min-h-28 resize-y py-3"
                                        placeholder="Ex.: Uniforme preto obrigatório. Início pontual às 18h."
                                        value={formData.briefing}
                                        onChange={(e) => setFormData({ ...formData, briefing: e.target.value })}
                                    />
                                </Field>

                                {/* F8 — advisory, nunca trava: aparece como banner no chamado de turno,
                                    nunca filtra nem desabilita a selecao de ninguem. */}
                                <Field
                                    label="Certificação exigida (opcional)"
                                    hint="Ex.: CREF válido, curso de manipulação de alimentos. É só um aviso — não filtra nem bloqueia freelas."
                                >
                                    <input
                                        id="certification-requirement"
                                        type="text"
                                        aria-label="Certificação Exigida (opcional)"
                                        maxLength={200}
                                        placeholder="Ex.: CREF válido"
                                        value={formData.certification_requirement}
                                        onChange={(e) => setFormData({ ...formData, certification_requirement: e.target.value })}
                                    />
                                </Field>
                            </div>
                        </Card>
                    )}
                </section>

                {/* CTA unico. Diz o que falta, em vez de so desabilitar o botao. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-gray-600">
                        {!podeEnviar ? `Falta preencher: ${faltas.join(', ')}.` : ''}
                    </p>
                    <Button
                        variant="dark"
                        size="lg"
                        onClick={handleSubmit}
                        loading={loading}
                        disabled={!podeEnviar}
                        title={podeEnviar ? undefined : 'Falta preencher: ' + faltas.join(', ')}
                        iconRight={!loading ? <Check size={18} /> : undefined}
                        className="w-full sm:w-auto"
                    >
                        {loading ? 'Salvando...' : rotuloEnviar}
                    </Button>
                </div>
            </div>

            {/* Resumo pós-criação de série (R9) — NÃO abre o painel de convite (que assume 1
                job); convidar continua sendo o fluxo por-ocorrência já existente na agenda. */}
            {createdSeriesSummary && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <Card
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="serie-criada-titulo"
                        className="w-full max-w-md text-center shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
                    >
                        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border-2 border-black bg-primary-light">
                            <Repeat size={24} className="text-primary" />
                        </div>
                        <h2 id="serie-criada-titulo" className="mb-2 text-2xl font-bold tracking-tight">Série criada!</h2>
                        <p className="mb-6 text-sm text-gray-600">
                            {createdSeriesSummary.occurrences} turno{createdSeriesSummary.occurrences > 1 ? 's' : ''} criado{createdSeriesSummary.occurrences > 1 ? 's' : ''}: {createdSeriesSummary.label}.
                            Convide um freela em cada turno na sua agenda.
                        </p>
                        <Button variant="dark" size="lg" fullWidth onClick={() => navigate('/company/jobs')}>
                            Ir para Meus Turnos
                        </Button>
                    </Card>
                </div>
            )}

            {/* Painel de convite pós-criação */}
            {showInvitePanel && createdJobId && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <Card
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="convidar-freela-titulo"
                        className="w-full max-w-md max-h-[90vh] overflow-y-auto shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
                    >
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h2 id="convidar-freela-titulo" className="text-xl font-bold tracking-tight">Convidar freela</h2>
                            <Button
                                variant="ghost"
                                onClick={() => { setShowInvitePanel(false); navigate('/company/dashboard'); }}
                                aria-label="Fechar e ir para o dashboard"
                                className="w-11 shrink-0 !px-0"
                            >
                                <X size={20} />
                            </Button>
                        </div>

                        <p className="mb-5 text-sm text-gray-600">
                            Turno criado! Para confirmar, convide pelo menos um freela do seu elenco — sem convite,
                            o turno fica parado esperando.
                        </p>

                        {teamLoading && (
                            <div className="space-y-3 animate-pulse">
                                {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-200 rounded-xl" />)}
                            </div>
                        )}

                        {!teamLoading && teamMembers.length === 0 && (
                            <div className="rounded-2xl border-2 border-dashed border-gray-300 py-8 text-center text-gray-600">
                                <Users size={32} className="mx-auto mb-2 opacity-40" />
                                <p className="text-sm font-bold">Seu elenco está vazio.</p>
                                <p className="mt-1 text-xs">Adicione freelas em <strong>Meu Elenco</strong> antes de criar turnos.</p>
                                <Button variant="dark" onClick={() => navigate('/company/team')} className="mt-4">
                                    Ir para Meu Elenco
                                </Button>
                            </div>
                        )}

                        {!teamLoading && teamMembers.length > 0 && (
                            <>
                            {/* A acao PRIMARIA e o chamado 1->N (primeiro-aceite) — e o coracao do
                                produto ("de 2 horas para 6 minutos") e ficava enterrado uma pagina
                                adiante. Convite um-a-um continua logo abaixo, como caminho fino. */}
                            <Button
                                variant="dark"
                                size="lg"
                                fullWidth
                                onClick={() => navigate(`/company/jobs/${createdJobId}/candidates?chamar=1`)}
                                iconLeft={<Megaphone size={18} />}
                                className="mb-4"
                            >
                                Chamar vários de uma vez — 1º que aceitar fica
                            </Button>
                            <p className="mb-3 text-center text-xs text-gray-600">ou convide um a um</p>

                            <div className="max-h-72 space-y-3 overflow-y-auto">
                                {teamMembers.map((member: TeamMember) => {
                                    const avatarUrl = member.worker.avatar_url ?? member.worker.photo_url ?? null;
                                    const isInviting = invitingWorkerId === member.worker.id;
                                    return (
                                        <div key={member.connection.id} className="flex items-center gap-3 rounded-xl border-2 border-gray-200 p-3">
                                            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border-2 border-black bg-gray-100">
                                                {avatarUrl ? (
                                                    <img src={avatarUrl} alt={member.worker.full_name} className="h-full w-full object-cover" />
                                                ) : (
                                                    <div className="flex h-full w-full items-center justify-center bg-black font-bold text-white">
                                                        {member.worker.full_name[0]?.toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-bold">{member.worker.full_name}</p>
                                                {member.worker.primary_role && (
                                                    <p className="truncate text-xs text-gray-600">{member.worker.primary_role}</p>
                                                )}
                                            </div>
                                            {sentInvites.some((inv) => inv.worker_id === member.worker.id) ? (
                                                <span className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary-light px-4 text-xs font-bold text-primary">
                                                    <Check size={14} /> Convidado
                                                </span>
                                            ) : (
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => invite(member.worker.id)}
                                                    loading={isInviting}
                                                    iconLeft={!isInviting ? <Send size={14} /> : undefined}
                                                    className="shrink-0"
                                                >
                                                    Convidar
                                                </Button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {sentInvites.length > 0 ? (
                                <Button
                                    variant="secondary"
                                    size="lg"
                                    fullWidth
                                    onClick={() => { setShowInvitePanel(false); navigate('/company/dashboard'); }}
                                    className="mt-5"
                                >
                                    Concluir — {sentInvites.length} convite{sentInvites.length > 1 ? 's' : ''} enviado{sentInvites.length > 1 ? 's' : ''}
                                </Button>
                            ) : (
                                <p className="mt-5 text-center text-xs text-gray-600">
                                    Convide pelo menos 1 freela para concluir a criação do turno.
                                </p>
                            )}
                            </>
                        )}
                    </Card>
                </div>
            )}
        </div>
    );
}
