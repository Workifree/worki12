/**
 * Peças leves do gatilho do copiloto (orbe e a pílula "Pergunte ao Worki"). Ficam fora do painel
 * para o cabeçalho poder usá-las sem puxar o painel completo (que carrega sob demanda).
 */
import './copilot-base.css'

/** Bolinha do copiloto (laboratório): espectro com brilho e halo; gira e respira só enquanto `working`. */
export function Orb({ working = false, done = false, small = false, bare = false }: { working?: boolean; done?: boolean; small?: boolean; bare?: boolean }) {
  return (
    <span className={`wk-orb ${working ? '' : 'wk-orb--idle'} ${done ? 'wk-orb--done' : ''} ${small ? 'wk-orb--sm' : ''} ${bare ? 'wk-orb--bare' : ''}`} aria-hidden="true">
      <i className="wk-orb__halo" />
      <i className="wk-orb__core" />
    </span>
  )
}

/** Conteúdo da pílula: brilho do espectro em volta, orbe, texto e o atalho. `compact` = só "Ajuda" (cabeçalho do celular). */
export function TriggerBody({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <span className="wk-trigger__halo" aria-hidden="true" />
      <span className="wk-trigger__ring" aria-hidden="true">
        <span className="wk-trigger__sweep" />
      </span>
      <Orb small bare working />
      <span className="wk-trigger__txt">
        {compact ? (
          'Ajuda'
        ) : (
          <>
            Precisa de ajuda? <small>Pergunte ao Worki</small>
          </>
        )}
      </span>
      {!compact && <kbd>Ctrl K</kbd>}
    </>
  )
}
