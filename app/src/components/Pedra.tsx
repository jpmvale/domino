/**
 * Uma pedra de dominó em SVG.
 *
 * Desenhada dentro de um sistema de coordenadas próprio (40×80 em pé), para
 * servir tanto na mão quanto na mesa, onde ela é posicionada por um `<g>`.
 */

/** Posições dos pontos numa metade de 40×40, para cada número de 0 a 6. */
const PONTOS: Record<number, [number, number][]> = {
  0: [],
  1: [[20, 20]],
  2: [[11, 11], [29, 29]],
  3: [[10, 10], [20, 20], [30, 30]],
  4: [[11, 11], [29, 11], [11, 29], [29, 29]],
  5: [[10, 10], [30, 10], [20, 20], [10, 30], [30, 30]],
  6: [[11, 9], [29, 9], [11, 20], [29, 20], [11, 31], [29, 31]],
};

function Metade({ n, dy }: { n: number; dy: number }) {
  return (
    <g transform={`translate(0 ${dy})`}>
      {(PONTOS[n] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3.8} fill="var(--pedra-ponto)" />
      ))}
    </g>
  );
}

/** O desenho em pé (40×80). `primeiro` em cima, `segundo` embaixo. */
export function FaceDaPedra({ primeiro, segundo, destaque }: { primeiro: number; segundo: number; destaque?: boolean }) {
  return (
    <g>
      <rect
        x={1} y={1} width={38} height={78} rx={6}
        fill="var(--pedra)"
        stroke={destaque ? 'var(--ponto)' : 'var(--pedra-borda)'}
        strokeWidth={destaque ? 3 : 1.5}
      />
      <line x1={7} y1={40} x2={33} y2={40} stroke="var(--pedra-linha)" strokeWidth={1.5} />
      <Metade n={primeiro} dy={0} />
      <Metade n={segundo} dy={40} />
    </g>
  );
}

/** Uma pedra solta, para a mão e para o fim da mão. */
export function Pedra({
  tileId, largura = 34, deitada = false, destaque = false,
}: { tileId: string; largura?: number; deitada?: boolean; destaque?: boolean }) {
  const [a, b] = tileId.split('-').map(Number) as [number, number];
  const w = deitada ? largura * 2 : largura;
  const h = deitada ? largura : largura * 2;
  return (
    <svg width={w} height={h} viewBox={deitada ? '0 0 80 40' : '0 0 40 80'} role="img" aria-label={`pedra ${a} e ${b}`}>
      <g transform={deitada ? 'translate(0 40) rotate(-90)' : undefined}>
        <FaceDaPedra primeiro={a} segundo={b} destaque={destaque} />
      </g>
    </svg>
  );
}

/** As costas de uma pedra: o que se vê da mão dos outros. */
export function CostasDaPedra({ largura = 10 }: { largura?: number }) {
  return (
    <svg width={largura} height={largura * 2} viewBox="0 0 40 80" aria-hidden>
      <rect x={1} y={1} width={38} height={78} rx={6} fill="var(--pedra-costas)" stroke="var(--linha)" strokeWidth={2} />
    </svg>
  );
}
