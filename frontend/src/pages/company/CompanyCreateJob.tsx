import { useState, useEffect, useMemo, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Check, ChevronRight, ChevronDown, ChevronUp, Wand2, MapPin, DollarSign, Briefcase, Calendar, Clock, Send, Users, Loader2, X, Repeat, Megaphone } from 'lucide-react';
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

// Dom(0)..Sáb(6) — mesma convenção de `job_series.weekdays` (spec R1).
const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

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

    const [step, setStep] = useState(1);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roda uma vez por modo de entrada
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
            const r = JSON.parse(bruto) as { em?: number; step?: number; formData?: typeof formData };
            if (!r?.formData || Date.now() - (r.em ?? 0) > 24 * 60 * 60 * 1000) {
                localStorage.removeItem(RASCUNHO_KEY);
                return;
            }
            setFormData((prev) => ({ ...prev, ...r.formData }));
            if (r.step === 2 || r.step === 3) setStep(r.step);
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
                localStorage.setItem(RASCUNHO_KEY, JSON.stringify({ em: Date.now(), step, formData }));
            } catch { /* storage indisponivel: rascunho e conveniencia */ }
        }, 600);
        return () => clearTimeout(t);
    }, [formData, step, isEditing, showInvitePanel]);

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
                // O que falta preencher e a data -- abre direto nela em vez de fazer a pessoa
                // atravessar duas etapas ja resolvidas.
                if (modo === 'repetir') setStep(3);
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

    const handleNext = () => setStep(step + 1);
    const handleBack = () => setStep(step - 1);

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

    // O QUE FALTA na etapa atual, em palavras.
    //
    // O botao ficava desabilitado sem dizer por que -- e a etapa 2 mostra QUATRO campos de texto
    // dos quais so a descricao e obrigatoria, entao a pessoa nao tinha como adivinhar qual travava.
    // O onboarding deste mesmo produto ja diz o que falta; nao dizer aqui e inconsistencia interna
    // (Nielsen #1, visibilidade do estado, e #4, consistencia) num passo que a empresa percorre
    // toda semana.
    const oQueFalta = (): string[] => {
        const falta: string[] = [];
        if (step === 1) {
            if (!formData.title.trim()) falta.push('o título do turno');
            if (!formData.category) falta.push('a função');
        } else if (step === 2) {
            if (!formData.description.trim()) falta.push('a descrição');
        } else if (step === 3) {
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
        }
        return falta;
    };

    // Validação por etapa — mesmo padrão de `canProceed()` do WorkerOnboarding.
    const canProceed = () => {
        switch (step) {
            case 1: return !!(formData.title.trim() && formData.category);
            case 2: return !!formData.description.trim();
            case 3: {
                const baseValid = !!(parseFloat(formData.budget) > 0 && formData.start_date && formData.start_date >= todayLocalDate() && formData.work_start_time && formData.work_end_time);
                if (!baseValid) return false;
                if (isEditing || !isRecurring) return true;
                if (recurrenceType === 'weekly' && weekdays.length === 0) return false;
                if (!rangeEndDate || rangeEndDate < formData.start_date) return false;
                if (occurrenceDates.length === 0 || overCap) return false;
                return true;
            }
            default: return true;
        }
    };

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

    return (
        <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-8 duration-500 pb-20">
            {/* Header */}
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <button onClick={() => navigate(-1)} className="min-h-11 px-2 -mx-2 inline-flex items-center gap-2 text-gray-400 font-bold hover:text-black transition-colors mb-2">
                        <ArrowLeft size={16} strokeWidth={3} /> Voltar
                    </button>
                    <h1 className="text-3xl font-black uppercase tracking-tighter">{isEditing ? 'Editar Turno' : 'Criar Novo Turno'}</h1>
                </div>
                {/* Progress Indicator */}
                <div className="flex items-center gap-2">
                    {[1, 2, 3].map((s) => (
                        <div key={s} className={`w-3 h-3 rounded-full border border-black transition-all ${step >= s ? 'bg-black' : 'bg-transparent'}`} aria-label={`Etapa ${s}${step >= s ? ' concluída' : ''}`} />
                    ))}
                </div>
            </div>

            <div className="bg-white border-2 border-black rounded-2xl p-8 shadow-[8px_8px_0px_0px_rgba(0,0,0,0.1)]">

                    {/* Step 1: Basic Info */}
                    {step === 1 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                            {modelos.length > 0 && (
                                <div className="mb-2">
                                    <p className="text-xs font-black uppercase tracking-wide text-gray-500 mb-1">
                                        Comece de um turno anterior
                                    </p>
                                    <p className="text-xs font-bold text-gray-400 mb-3">
                                        Preenche tudo de novo pra você — só escolha a nova data.
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {modelos.map((mo) => (
                                            <button
                                                key={mo.id}
                                                type="button"
                                                onClick={() => { void fetchJobData(mo.id, 'repetir'); }}
                                                className="min-h-11 text-left bg-gray-50 hover:bg-primary-light border-2 border-gray-200 hover:border-black rounded-xl px-4 py-3 transition-all"
                                            >
                                                <span className="block font-black uppercase text-sm truncate">{mo.title}</span>
                                                <span className="block text-xs font-bold text-gray-500">
                                                    {mo.budget ? `R$ ${mo.budget}` : ''}{mo.work_start_time ? ` · ${mo.work_start_time}–${mo.work_end_time ?? ''}` : ''}
                                                    {/* recencia = confianca de que e o turno certo ("e o do sabado passado mesmo") */}
                                                    {mo.created_at ? ` · ${formatDistanceToNow(new Date(mo.created_at), { addSuffix: true, locale: ptBR })}` : ''}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                    <p className="text-[11px] font-black uppercase text-gray-400 mt-4 text-center">ou crie do zero:</p>
                                </div>
                            )}
                            <h2 className="text-xl font-black uppercase flex items-center gap-2">
                                <Briefcase size={20} /> Informações Básicas
                            </h2>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wide">Título do Turno</label>
                                <input
                                    type="text"
                                    aria-label="Título do Turno"
                                    className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold text-lg placeholder:text-gray-300 transition-all"
                                    placeholder="Ex: Garçom para evento de sábado, Barista para cafeteria..."
                                    value={formData.title}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wide">Função</label>
                                <select
                                    aria-label="Função"
                                    className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold appearance-none"
                                    value={formData.category}
                                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                >
                                    <option value="">Selecione a função...</option>
                                    {SHIFT_CATEGORIES.map(cat => (
                                        <option key={cat.slug} value={cat.slug}>{cat.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Turno é sempre presencial no pivô — sem seletor de formato/remoto */}
                            <div className="flex items-center gap-2 rounded-xl bg-blue-50 border-2 border-blue-100 px-4 py-3 text-blue-700">
                                <MapPin size={18} className="flex-shrink-0" />
                                <span className="text-xs font-black uppercase tracking-wide">Turno presencial</span>
                            </div>
                        </div>
                    )}

                    {/* Step 2: Details */}
                    {step === 2 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-xl font-black uppercase flex items-center gap-2">
                                <Wand2 size={20} /> Detalhes & Requisitos
                            </h2>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wide">Descrição Completa <span className="text-red-500">*</span></label>
                                <textarea
                                    aria-label="Descrição Completa"
                                    className="w-full h-32 bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-medium text-sm placeholder:text-gray-300 transition-all resize-none"
                                    placeholder="Descreva a dinâmica do turno, responsabilidades no salão/bar/cozinha e postura esperada..."
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                />
                            </div>

                            {/* Baymard: marcar obrigatorio E opcional explicitamente (so 14% dos
                                sites fazem; 32% dos usuarios erram campo quando nao se marca). */}
                            <button
                                type="button"
                                onClick={() => setMostrarOpcionais(v => !v)}
                                className="min-h-11 w-full flex items-center justify-between gap-2 bg-gray-50 hover:bg-gray-100 border-2 border-dashed border-gray-300 rounded-xl px-4 py-3 font-black uppercase text-xs text-gray-600 transition-colors"
                            >
                                <span>Requisitos, briefing e certificação (opcional)</span>
                                {mostrarOpcionais ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>

                            {mostrarOpcionais && (<>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wide">Requisitos (opcional)</label>
                                <textarea
                                    aria-label="Requisitos (opcional)"
                                    className="w-full h-24 bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-medium text-sm placeholder:text-gray-300 transition-all resize-none"
                                    placeholder="- Experiência em atendimento ou preparo&#10;- Agilidade e pontualidade&#10;- Boa comunicação e trabalho em equipe"
                                    value={formData.requirements}
                                    onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="briefing" className="text-xs font-bold uppercase tracking-wide">Briefing do Turno (opcional)</label>
                                <p className="text-xs text-gray-400 font-bold">Regras da casa, cardápio, procedimentos, dress code — o freela vê isso no convite.</p>
                                <textarea
                                    id="briefing"
                                    aria-label="Briefing do Turno (opcional)"
                                    className="w-full h-28 bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-medium text-sm placeholder:text-gray-300 transition-all resize-none"
                                    placeholder="Ex: Uniforme preto obrigatório. Cardápio fixo do bar. Início pontual às 18h..."
                                    value={formData.briefing}
                                    onChange={(e) => setFormData({ ...formData, briefing: e.target.value })}
                                />
                            </div>

                            {/* F8 — advisory, nunca trava: aparece como banner no chamado de turno,
                                nunca filtra nem desabilita a seleção de ninguém. */}
                            <div className="space-y-2">
                                <label htmlFor="certification-requirement" className="text-xs font-bold uppercase tracking-wide">
                                    Certificação Exigida (opcional)
                                </label>
                                <p className="text-xs text-gray-400 font-bold">
                                    Ex: CREF válido, curso de manipulação de alimentos. É só um aviso — não filtra nem bloqueia freelas.
                                </p>
                                <input
                                    id="certification-requirement"
                                    type="text"
                                    aria-label="Certificação Exigida (opcional)"
                                    maxLength={200}
                                    className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-medium text-sm placeholder:text-gray-300 transition-all"
                                    placeholder="Ex: CREF válido"
                                    value={formData.certification_requirement}
                                    onChange={(e) => setFormData({ ...formData, certification_requirement: e.target.value })}
                                />
                            </div>
                            </>)}
                        </div>
                    )}

                    {/* Step 3: Logistics */}
                    {step === 3 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                            <h2 className="text-xl font-black uppercase flex items-center gap-2">
                                <DollarSign size={20} /> Valor & Cronograma
                            </h2>

                            {/* Aviso sobre como o pagamento funciona no piloto (modo A) */}
                            {!isEditing && (
                                <div className="p-4 rounded-xl border-2 bg-blue-50 border-blue-200 flex items-start gap-3">
                                    <DollarSign size={20} className="text-blue-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <span className="text-xs font-black uppercase text-blue-700 block mb-1">Como funciona o pagamento</span>
                                        <p className="text-xs text-blue-600 font-bold">Você combina e paga o freela direto (PIX ou dinheiro). Depois do turno, registre o pagamento aqui e o Worki emite o recibo pros dois lados.</p>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-wide">Tipo de Pagamento</label>
                                    <select
                                        aria-label="Tipo de Pagamento"
                                        className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold appearance-none"
                                        value={formData.budget_type}
                                        onChange={(e) => setFormData({ ...formData, budget_type: e.target.value })}
                                    >
                                        <option value="hourly">Por Hora</option>
                                        <option value="daily">Por Dia</option>
                                        <option value="project">Projeto Fixo</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold uppercase tracking-wide">Valor ({formData.budget_type === 'hourly' ? '/h' : formData.budget_type === 'daily' ? '/dia' : 'Total'})</label>
                                    <div className="relative">
                                        <span className="absolute left-4 top-3.5 font-black text-gray-400">R$</span>
                                        <input
                                            type="number"
                                            aria-label="Valor do orçamento"
                                            className={`w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl py-3 pl-10 pr-4 font-bold text-lg placeholder:text-gray-300 transition-all ${isEditing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            placeholder="0,00"
                                            value={formData.budget}
                                            onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                                            disabled={isEditing}
                                        />
                                    </div>
                                    {isEditing && (
                                        <p className="text-xs text-orange-600 font-bold mt-1">
                                            O valor não pode ser alterado após a criação.
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Vagas (F1): quantas pessoas o turno precisa. É o denominador do
                                chamado — com 3 vagas, o disparo só fecha no terceiro aceite. */}
                            <div className="space-y-2">
                                <label htmlFor="job-slots" className="text-xs font-bold uppercase tracking-wide">
                                    Quantas pessoas
                                </label>
                                <input
                                    id="job-slots"
                                    type="number"
                                    min={1}
                                    step={1}
                                    aria-label="Quantas pessoas o turno precisa"
                                    className="w-full sm:w-40 bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold text-lg transition-all"
                                    value={formData.slots}
                                    onChange={(e) => setFormData({ ...formData, slots: e.target.value })}
                                />
                                <p className="text-xs text-gray-400 font-bold">
                                    O chamado fica aberto até preencher todas as vagas ou expirar.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label htmlFor="job-start-date" className="text-xs font-bold uppercase tracking-wide">
                                        {isRecurring ? 'Início da recorrência' : 'Início'}
                                    </label>
                                    <div className="relative">
                                        <Calendar className="absolute left-3 top-3.5 text-gray-400" size={20} />
                                        <input
                                            id="job-start-date"
                                            type="date"
                                            aria-label="Data de início"
                                            min={todayLocalDate()}
                                            className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl py-3 pl-10 pr-4 font-bold transition-all"
                                            value={formData.start_date}
                                            onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Escala Recorrente (F3) — só na criação; edição de ocorrência isolada não vira série. */}
                            {!isEditing && (
                                <div className="space-y-4 bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-4">
                                    <div className="flex items-center justify-between flex-wrap gap-3">
                                        <div>
                                            <h3 className="text-sm font-black uppercase flex items-center gap-2 text-gray-700">
                                                <Repeat size={16} /> Repetir este turno
                                            </h3>
                                            <p className="text-xs text-gray-400 font-bold mt-1">Cria vários turnos de uma vez, com o mesmo horário e valor.</p>
                                        </div>
                                        <div className="flex border-2 border-black rounded-xl overflow-hidden" role="group" aria-label="Repetir este turno">
                                            <button
                                                type="button"
                                                onClick={() => setIsRecurring(false)}
                                                aria-pressed={!isRecurring}
                                                className={`min-h-[44px] px-4 py-2.5 font-black uppercase text-xs transition-colors ${!isRecurring ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'}`}
                                            >
                                                Turno único
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setIsRecurring(true)}
                                                aria-pressed={isRecurring}
                                                className={`min-h-[44px] px-4 py-2.5 font-black uppercase text-xs transition-colors border-l-2 border-black ${isRecurring ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'}`}
                                            >
                                                Recorrente
                                            </button>
                                        </div>
                                    </div>

                                    {isRecurring && (
                                        <div className="space-y-4 pt-4 border-t-2 border-dashed border-gray-200">
                                            <div className="space-y-2">
                                                <label className="text-xs font-bold uppercase tracking-wide">Tipo de recorrência</label>
                                                <div className="flex flex-col sm:flex-row gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setRecurrenceType('weekly')}
                                                        aria-pressed={recurrenceType === 'weekly'}
                                                        className={`flex-1 min-h-[44px] px-4 py-2.5 rounded-xl border-2 font-black uppercase text-xs transition-colors ${recurrenceType === 'weekly' ? 'bg-black text-white border-black' : 'bg-white border-black hover:bg-gray-100'}`}
                                                    >
                                                        Toda semana
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setRecurrenceType('daily')}
                                                        aria-pressed={recurrenceType === 'daily'}
                                                        className={`flex-1 min-h-[44px] px-4 py-2.5 rounded-xl border-2 font-black uppercase text-xs transition-colors ${recurrenceType === 'daily' ? 'bg-black text-white border-black' : 'bg-white border-black hover:bg-gray-100'}`}
                                                    >
                                                        Cobrir um período
                                                    </button>
                                                </div>
                                                {recurrenceType === 'daily' && (
                                                    <p className="text-xs text-gray-400 font-bold">Ex.: cobrir uma folga de férias — um turno por dia corrido no período.</p>
                                                )}
                                            </div>

                                            {recurrenceType === 'weekly' && (
                                                <div className="space-y-2">
                                                    <label className="text-xs font-bold uppercase tracking-wide">Dias da semana</label>
                                                    <div className="flex flex-wrap gap-2" role="group" aria-label="Dias da semana">
                                                        {WEEKDAY_LABELS.map((label, day) => (
                                                            <button
                                                                key={day}
                                                                type="button"
                                                                onClick={() => toggleWeekday(day)}
                                                                aria-pressed={weekdays.includes(day)}
                                                                aria-label={WEEKDAY_FULL_LABELS[day]}
                                                                className={`w-11 h-11 rounded-xl border-2 font-black text-xs uppercase transition-colors ${weekdays.includes(day) ? 'bg-primary text-white border-black' : 'bg-white border-black text-black hover:bg-gray-100'}`}
                                                            >
                                                                {label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="space-y-2">
                                                <label htmlFor="job-range-end" className="text-xs font-bold uppercase tracking-wide">Repetir até</label>
                                                <div className="relative">
                                                    <Calendar className="absolute left-3 top-3.5 text-gray-400" size={20} />
                                                    <input
                                                        id="job-range-end"
                                                        type="date"
                                                        aria-label="Repetir até"
                                                        min={formData.start_date || todayLocalDate()}
                                                        className="w-full bg-white border-2 border-transparent focus:border-black outline-none rounded-xl py-3 pl-10 pr-4 font-bold transition-all"
                                                        value={rangeEndDate}
                                                        onChange={(e) => setRangeEndDate(e.target.value)}
                                                    />
                                                </div>
                                            </div>

                                            {/* Pré-visualização ao vivo (R8) */}
                                            <div className={`rounded-xl border-2 p-4 text-sm font-bold ${overCap ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-black'}`}>
                                                {occurrenceDates.length === 0 ? (
                                                    <span className="text-gray-400 font-medium">Defina os dias e o período para ver quantos turnos serão criados.</span>
                                                ) : overCap ? (
                                                    <span>Essa configuração criaria {occurrenceDates.length} turnos — o limite é {MAX_SERIES_OCCURRENCES}. Encurte o período ou marque menos dias da semana.</span>
                                                ) : (
                                                    <span>
                                                        Serão criados <strong>{occurrenceDates.length}</strong> turno{occurrenceDates.length > 1 ? 's' : ''} — {previewDatesLabel}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Detailed Schedule */}
                            <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-xl p-4 space-y-4">
                                <h3 className="text-sm font-black uppercase flex items-center gap-2 text-gray-500">
                                    <Clock size={16} /> Horário de Trabalho
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wide">Entrada</label>
                                        <input
                                            type="time"
                                            aria-label="Horário de entrada"
                                            className="w-full bg-white border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold transition-all"
                                            value={formData.work_start_time}
                                            onChange={(e) => setFormData({ ...formData, work_start_time: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold uppercase tracking-wide">Saída</label>
                                        <input
                                            type="time"
                                            aria-label="Horário de saída"
                                            className="w-full bg-white border-2 border-transparent focus:border-black outline-none rounded-xl p-3 font-bold transition-all"
                                            value={formData.work_end_time}
                                            onChange={(e) => setFormData({ ...formData, work_end_time: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="lunch"
                                        className="w-5 h-5 accent-black rounded"
                                        checked={formData.has_lunch}
                                        onChange={(e) => setFormData({ ...formData, has_lunch: e.target.checked })}
                                    />
                                    <label htmlFor="lunch" className="text-sm font-bold cursor-pointer select-none">
                                        Intervalo de Almoço (1h)
                                    </label>
                                </div>

                                {/* Calculation Display */}
                                {(formData.work_start_time && formData.work_end_time) && (
                                    <div className="bg-gray-200 rounded-lg p-3 text-xs font-bold uppercase text-gray-600 flex justify-between">
                                        <span>Total: {calculateHours(formData.work_start_time, formData.work_end_time).total}h</span>
                                        <span>Trabalho: {calculateHours(formData.work_start_time, formData.work_end_time, formData.has_lunch).work}h</span>
                                        <span className={formData.has_lunch ? 'text-black' : 'text-gray-400'}>Almoço: {formData.has_lunch ? '1h' : '0h'}</span>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase tracking-wide">Localização Específica</label>
                                <div className="relative">
                                    <MapPin className="absolute left-3 top-3.5 text-gray-400" size={20} />
                                    <input
                                        type="text"
                                        aria-label="Localização Específica"
                                        className="w-full bg-gray-50 border-2 border-transparent focus:border-black outline-none rounded-xl py-3 pl-10 pr-4 font-bold placeholder:text-gray-300 transition-all"
                                        placeholder="Ex: Rua Augusta, 1200 - Consolação, São Paulo"
                                        value={formData.location}
                                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Navigation Buttons */}
                    {/* Diz o que falta, em vez de so desabilitar o botao. */}
                    {!canProceed() && oQueFalta().length > 0 && (
                        <p className="mt-6 text-xs font-bold text-red-500">
                            Falta preencher: {oQueFalta().join(', ')}.
                        </p>
                    )}

                    <div className="mt-8 flex justify-between pt-6 border-t border-gray-100">
                        {step > 1 ? (
                            <button
                                onClick={handleBack}
                                className="px-6 py-3 rounded-xl border-2 border-black font-black uppercase hover:bg-gray-50 transition-colors"
                            >
                                Voltar
                            </button>
                        ) : <div></div>}

                        <button
                            onClick={step === 3 ? handleSubmit : handleNext}
                            disabled={loading || !canProceed()}
                            title={canProceed() ? undefined : 'Falta preencher: ' + oQueFalta().join(', ')}
                            className="bg-black text-white px-8 py-3 rounded-xl font-black uppercase flex items-center gap-2 hover:bg-primary hover:scale-[1.02] transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Salvando...' : step === 3 ? (isEditing ? 'Salvar Alterações' : (isRecurring ? 'Criar Série de Turnos' : 'Criar Turno')) : 'Próximo'}
                            {!loading && step < 3 && <ChevronRight size={20} />}
                            {!loading && step === 3 && <Check size={20} />}
                        </button>
                    </div>

            </div>

            {/* Resumo pós-criação de série (R9) — NÃO abre o painel de convite (que assume 1
                job); convidar continua sendo o fluxo por-ocorrência já existente na agenda. */}
            {createdSeriesSummary && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6 text-center">
                        <div className="w-14 h-14 rounded-full bg-primary-light border-2 border-black flex items-center justify-center mx-auto mb-4">
                            <Repeat size={24} className="text-primary" />
                        </div>
                        <h2 className="text-2xl font-black uppercase tracking-tight mb-2">Série criada!</h2>
                        <p className="text-sm font-bold text-gray-600 mb-6">
                            {createdSeriesSummary.occurrences} turno{createdSeriesSummary.occurrences > 1 ? 's' : ''} criado{createdSeriesSummary.occurrences > 1 ? 's' : ''}: {createdSeriesSummary.label}.
                            Convide um freela em cada turno na sua agenda.
                        </p>
                        <button
                            onClick={() => navigate('/company/jobs')}
                            className="w-full min-h-[44px] bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase text-sm transition-colors"
                        >
                            Ir para Meus Turnos
                        </button>
                    </div>
                </div>
            )}

            {/* Painel de convite pós-criação */}
            {showInvitePanel && createdJobId && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] w-full max-w-md p-6">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-black uppercase tracking-tight">Convidar Freela</h2>
                            <button
                                onClick={() => { setShowInvitePanel(false); navigate('/company/dashboard'); }}
                                aria-label="Fechar e ir para o dashboard"
                                className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <p className="text-sm font-bold text-gray-600 mb-5">
                            Turno criado! Para confirmar, convide pelo menos um freela do seu elenco — sem convite,
                            o turno fica parado esperando.
                        </p>

                        {teamLoading && (
                            <div className="space-y-3 animate-pulse">
                                {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-200 rounded-xl" />)}
                            </div>
                        )}

                        {!teamLoading && teamMembers.length === 0 && (
                            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl text-gray-400">
                                <Users size={32} className="mx-auto mb-2 opacity-30" />
                                <p className="font-bold text-sm">Seu elenco está vazio.</p>
                                <p className="text-xs mt-1">Adicione freelas em <strong>Meu Elenco</strong> antes de criar turnos.</p>
                                <button
                                    onClick={() => navigate('/company/team')}
                                    className="mt-4 bg-black hover:bg-primary text-white px-4 py-2 rounded-xl font-black uppercase text-xs transition-colors"
                                >
                                    Ir para Meu Elenco
                                </button>
                            </div>
                        )}

                        {!teamLoading && teamMembers.length > 0 && (
                            <>
                            {/* A acao PRIMARIA e o chamado 1->N (primeiro-aceite) — e o coracao do
                                produto ("de 2 horas para 6 minutos") e ficava enterrado uma pagina
                                adiante. Convite um-a-um continua logo abaixo, como caminho fino. */}
                            <button
                                onClick={() => navigate(`/company/jobs/${createdJobId}/candidates?chamar=1`)}
                                className="w-full min-h-11 mb-4 bg-primary hover:bg-black text-white px-4 py-3 rounded-xl font-black uppercase text-sm transition-colors flex items-center justify-center gap-2"
                            >
                                <Megaphone size={18} /> Chamar vários de uma vez — 1º que aceitar fica
                            </button>
                            <p className="text-[11px] font-black uppercase text-gray-400 mb-3 text-center">ou convide um a um:</p>
                            </>
                        )}
                        {!teamLoading && teamMembers.length > 0 && (
                            <div className="space-y-3 max-h-72 overflow-y-auto">
                                {teamMembers.map((member: TeamMember) => {
                                    const avatarUrl = member.worker.avatar_url ?? member.worker.photo_url ?? null;
                                    const isInviting = invitingWorkerId === member.worker.id;
                                    return (
                                        <div key={member.connection.id} className="flex items-center gap-3 p-3 rounded-xl border-2 border-gray-100 hover:border-black transition-all">
                                            <div className="w-10 h-10 rounded-xl border-2 border-black overflow-hidden bg-gray-100 flex-shrink-0">
                                                {avatarUrl ? (
                                                    <img src={avatarUrl} alt={member.worker.full_name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-black text-white font-black">
                                                        {member.worker.full_name[0]?.toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-black uppercase text-sm truncate">{member.worker.full_name}</p>
                                                {member.worker.primary_role && (
                                                    <p className="text-xs font-bold text-gray-400 uppercase truncate">{member.worker.primary_role}</p>
                                                )}
                                            </div>
                                            {sentInvites.some((inv) => inv.worker_id === member.worker.id) ? (
                                                <span className="bg-green-100 text-green-700 px-4 min-h-11 rounded-xl font-black uppercase text-xs flex items-center gap-1.5 flex-shrink-0">
                                                    <Check size={14} /> Convidado
                                                </span>
                                            ) : (
                                                <button
                                                    onClick={() => invite(member.worker.id)}
                                                    disabled={isInviting}
                                                    className="bg-black hover:bg-primary text-white px-4 min-h-11 rounded-xl font-black uppercase text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                                                >
                                                    {isInviting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                                                    {isInviting ? '...' : 'Convidar'}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {!teamLoading && teamMembers.length > 0 && (
                            sentInvites.length > 0 ? (
                                <button
                                    onClick={() => { setShowInvitePanel(false); navigate('/company/dashboard'); }}
                                    className="w-full mt-5 bg-black hover:bg-primary text-white px-6 py-3 rounded-xl font-black uppercase text-sm transition-colors"
                                >
                                    Concluir — {sentInvites.length} convite{sentInvites.length > 1 ? 's' : ''} enviado{sentInvites.length > 1 ? 's' : ''}
                                </button>
                            ) : (
                                <p className="text-center text-xs font-bold text-gray-400 mt-5">
                                    Convide pelo menos 1 freela para concluir a criação do turno.
                                </p>
                            )
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
