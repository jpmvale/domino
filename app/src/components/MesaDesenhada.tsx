import { useMemo } from 'react';
import type { Placement } from '@domino/rules';
import { layoutDaMesa } from '../layout';
import { FaceDaPedra } from './Pedra';

/** Pixels de SVG por meia-unidade: a pedra deitada fica 80×40. */
const U = 20;

/**
 * A mesa desenhada: as pedras jogadas e, quando há uma pedra escolhida na
 * mão, os alvos onde ela encaixa. Tocar no alvo joga.
 */
export function MesaDesenhada({
  mesa, alvos, aoEscolherAlvo, ultima,
}: {
  mesa: Placement[];
  /** Pontas onde a pedra escolhida encaixa. */
  alvos: string[];
  aoEscolherAlvo: (endId: string) => void;
  /** Índice da última pedra jogada, para destacar. */
  ultima: number | null;
}) {
  const layout = useMemo(() => layoutDaMesa(mesa), [mesa]);
  const pad = 1;
  const vx = (layout.minX - pad) * U;
  const vy = (layout.minY - pad) * U;
  const vw = (layout.maxX - layout.minX + pad * 2) * U;
  const vh = (layout.maxY - layout.minY + pad * 2) * U;

  return (
    <svg
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      style={{ width: '100%', height: '100%', display: 'block' }}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={mesa.length === 0 ? 'Mesa vazia' : `Mesa com ${mesa.length} pedras`}
    >
      {layout.pedras.map((p) => {
        const x = p.x * U;
        const y = p.y * U;
        const transform = p.vertical ? `translate(${x} ${y})` : `translate(${x} ${y + 2 * U}) rotate(-90)`;
        return (
          <g key={p.idx} transform={transform}>
            <g className={p.idx === ultima ? 'pedra-nova' : undefined}>
              <FaceDaPedra primeiro={p.primeiro} segundo={p.segundo} destaque={p.idx === ultima} />
            </g>
          </g>
        );
      })}

      {layout.saidas.filter((s) => alvos.includes(s.endId)).map((s) => {
        const cx = (s.x + s.dir.dx * 2) * U;
        const cy = (s.y + s.dir.dy * 2) * U;
        return (
          <g
            key={s.endId}
            className="alvo"
            role="button"
            tabIndex={0}
            aria-label="Jogar aqui"
            onClick={() => aoEscolherAlvo(s.endId)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') aoEscolherAlvo(s.endId); }}
          >
            <circle cx={cx} cy={cy} r={22} fill="rgba(63, 185, 138, 0.25)" stroke="var(--alvo)" strokeWidth={3} strokeDasharray="6 4" />
            <path d={`M ${cx - 9} ${cy} H ${cx + 9} M ${cx} ${cy - 9} V ${cy + 9}`} stroke="var(--alvo)" strokeWidth={4} strokeLinecap="round" />
          </g>
        );
      })}

      {mesa.length === 0 && alvos.length === 0 && (
        <text x={0} y={6} textAnchor="middle" fill="var(--texto-fraco)" fontSize={9}>
          esperando a primeira pedra
        </text>
      )}
    </svg>
  );
}
