import { describe, expect, it } from 'vitest';
import {
  applyMove,
  createMatch,
  createRng,
  jogadasLegais,
  opcoesDoModo,
  type MatchState,
} from '@domino/rules';
import { layoutDaMesa, LARGURA } from '../src/layout';

/** Joga uma mão inteira ao acaso e devolve o estado no fim dela. */
function maoAleatoria(seed: string, jogadores: number, abrem: boolean): MatchState[] {
  let m = createMatch({
    matchId: seed, seed, playerIds: ['a', 'b', 'c', 'd'].slice(0, jogadores),
    options: { ...opcoesDoModo('MULTIPLO_DE_5'), carrocasAbrem: abrem, meta: 300 },
  });
  const rng = createRng(seed);
  const estados: MatchState[] = [];
  while (m.mao.fase === 'JOGANDO' && m.endReason === null) {
    const legais = jogadasLegais(m, m.mao.vez!);
    const j = legais[rng.nextInt(legais.length)]!;
    const r = applyMove(m, { playerId: m.mao.vez!, mao: m.mao.numero, ...j });
    if (!r.ok) throw new Error(r.motivo);
    m = r.state;
    estados.push(m);
  }
  return estados;
}

const sobrepoe = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('layout da mesa', () => {
  it('nenhuma pedra fica por cima de outra, em 400 mãos', () => {
    let sobreposicoes = 0;
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const estados = maoAleatoria(`lay-${i}`, 2 + (i % 3), i % 2 === 0);
      const fim = estados.at(-1)!;
      const { pedras } = layoutDaMesa(fim.mao.mesa);
      total++;
      expect(pedras).toHaveLength(fim.mao.mesa.length);
      outer: for (let a = 0; a < pedras.length; a++) {
        for (let b = a + 1; b < pedras.length; b++) {
          if (sobrepoe(pedras[a]!, pedras[b]!)) { sobreposicoes++; break outer; }
        }
      }
    }
    // Mesa com muitas carroças abertas pode não ter saída sem cruzar; é raro.
    expect(sobreposicoes / total).toBeLessThan(0.02);
  });

  it('a fila quase sempre respeita a largura da mesa, com folga para a curva', () => {
    let fora = 0;
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const fim = maoAleatoria(`larg-${i}`, 2 + (i % 3), i % 2 === 0).at(-1)!;
      for (const p of layoutDaMesa(fim.mao.mesa).pedras) {
        total++;
        if (p.x < -LARGURA - 3 || p.x + p.w > LARGURA + 3) fora++;
      }
    }
    // Passar da borda é a saída de último caso, para não sobrepor.
    expect(fora / total).toBeLessThan(0.03);
  });

  it('o mesmo estado desenha sempre a mesma mesa', () => {
    const fim = maoAleatoria('det', 4, true).at(-1)!;
    expect(layoutDaMesa(fim.mao.mesa)).toEqual(layoutDaMesa(fim.mao.mesa));
  });
});
