/**
 * Regulamento de 1 página da Trilha de bônus (spec trilha-bonus-operador, R5), como dados.
 *
 * Regra editorial (AF9/AF10): só a regra geral. NÃO publicar limiares, janelas internas, lista de
 * vetos nem motivos de exclusão, e NÃO há cláusula de estorno. Tom simples, neutro de gênero.
 * Para o dinheiro, nunca usar as palavras "saldo", "carteira" ou "crédito".
 */

/** Versão vigente: mudou o texto, sobe a versão (o aceite grava versão e data). */
export const BONUS_RULES_VERSION = '2026-11-24'
export const BONUS_RULES_UPDATED_AT = '24 de novembro de 2026'

export const BONUS_CAP_REAIS = 300
export const BONUS_WINDOW_WEEKS = 12
export const BONUS_MIN_PAYOUT_REAIS = 25

export interface BonusRulesMilestone {
  title: string
  reais: string
}

export interface BonusRulesMilestoneGroup {
  name: string
  items: BonusRulesMilestone[]
}

export interface BonusRulesSection {
  id: string
  title: string
  paragraphs: string[]
}

export const BONUS_RULES_TITLE = 'Regulamento da Trilha de bônus'

export const BONUS_RULES_INTRO =
  'A Trilha de bônus é um programa do Worki que paga um valor em dinheiro a cada marco que você conquista ao organizar a operação da sua empresa no app.'

export const BONUS_RULES_SECTIONS: BonusRulesSection[] = [
  {
    id: 'o-que-e',
    title: 'O que é',
    paragraphs: [
      `São 20 marcos, do primeiro acesso à constância ao longo de ${BONUS_WINDOW_WEEKS} semanas. Quem completa todos recebe até R$ ${BONUS_CAP_REAIS},00 no total. Esse é o teto por pessoa, e há uma única inscrição por pessoa.`,
      'Os marcos valem para as ações feitas com o seu próprio login. Ações feitas por outra pessoa, em nome da sua conta, não contam.',
    ],
  },
  {
    id: 'o-que-conta',
    title: 'O que conta',
    paragraphs: [
      'Contam turnos reais, com presença confirmada dos dois lados.',
      'O marco aparece na tela assim que é conquistado. Antes de o valor ficar disponível, há uma conferência automática de poucos dias. Quase sempre ela passa sozinha e você não precisa fazer nada.',
    ],
  },
  {
    id: 'como-recebe',
    title: 'Como e quando o PIX sai',
    paragraphs: [
      `O pagamento é feito por PIX, uma vez por semana, toda segunda-feira, a partir do pedido que você faz na tela da Trilha. O valor mínimo por pedido é R$ ${BONUS_MIN_PAYOUT_REAIS},00.`,
      'Entram no PIX de segunda os valores que já saíram da conferência até a sexta-feira anterior. O que for liberado depois entra na segunda seguinte.',
      'No fim da trilha, o último pedido pode ser de qualquer valor, sem mínimo.',
      'O dinheiro do bônus vem do próprio Worki.',
    ],
  },
  {
    id: 'o-que-nao-e',
    title: 'O que o bônus não é',
    paragraphs: [
      'O bônus não é salário, não gera vínculo de trabalho e não fica guardado em nenhuma conta dentro do app. É um prêmio pago por PIX, por marco conquistado.',
      'Ele também não tem relação com o que a sua empresa paga às pessoas que trabalham nos turnos.',
    ],
  },
  {
    id: 'regra-geral',
    title: 'Regra geral',
    paragraphs: [
      'Bônus de turno que não seja genuíno pode deixar de ser pago, e o programa pode ser encerrado a qualquer momento.',
    ],
  },
  {
    id: 'como-sair',
    title: 'Como encerrar',
    paragraphs: [
      'Você pode sair da trilha quando quiser, falando com a equipe do Worki. O que já foi pago continua com você.',
    ],
  },
]

export const BONUS_RULES_MILESTONE_GROUPS: BonusRulesMilestoneGroup[] = [
  {
    name: 'Começando',
    items: [
      { title: 'Primeiro acesso', reais: 'R$ 0' },
      { title: 'Topei o desafio', reais: 'R$ 10' },
      { title: 'Briefing da empresa preenchido', reais: 'R$ 10' },
      { title: 'Convidou 5 freelas', reais: 'R$ 10' },
    ],
  },
  {
    name: 'Primeiros turnos',
    items: [
      { title: '1º turno publicado', reais: 'R$ 10' },
      { title: '3 freelas do Elenco aceitaram', reais: 'R$ 10' },
      { title: '1º check-in e checkout confirmados', reais: 'R$ 10' },
      { title: '1º turno completo', reais: 'R$ 20' },
      { title: '1º recibo validado em até 24h', reais: 'R$ 10' },
      { title: '1ª avaliação de freela', reais: 'R$ 10' },
      { title: '1º chamado de turno preenchido', reais: 'R$ 15' },
      { title: '1º freela repetido', reais: 'R$ 15' },
    ],
  },
  {
    name: 'Ritmo',
    items: [
      { title: '3 turnos completos', reais: 'R$ 15' },
      { title: '6 turnos completos', reais: 'R$ 15' },
      { title: '9 turnos completos', reais: 'R$ 20' },
      { title: '12 turnos completos', reais: 'R$ 20' },
      { title: '6 semanas ativas', reais: 'R$ 15' },
      { title: '10 semanas ativas', reais: 'R$ 15' },
    ],
  },
  {
    name: 'Constância',
    items: [
      { title: 'Velocidade', reais: 'R$ 15 a R$ 25' },
      { title: 'Constância', reais: 'R$ 15' },
    ],
  },
  {
    name: 'Prêmio final',
    items: [{ title: 'Coleção completa (marcos 1 a 12)', reais: 'R$ 30' }],
  },
]

export const BONUS_RULES_FOOTER = 'Dúvidas? Fale com a equipe do Worki pela Ajuda do app.'
