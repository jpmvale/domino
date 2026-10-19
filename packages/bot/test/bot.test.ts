import { describe, expect, it } from 'vitest';
import {
  advance,
  applyMove,
  createMatch,
  createRng,
  opcoesDoModo,
  project,
  type MatchOptions,
} from '@domino/rules';
import { decidirJogada, type BotDifficulty } from '../src/index.js';

/** Uma partida inteira entre dois bots; devolve quem venceu. */
function duelo(seed: string, a: BotDifficulty, b: BotDifficulty, options: MatchOptions): 'a' | 'b' {
  let m = createMatch({ matchId: seed, seed, playerIds: ['a', 'b'], options });
  const rng = createRng(`bots:${seed}`);
  for (let i = 0; i < 5_000 && m.endReason === null; i++) {
    if (m.mao.fase === 'FIM_DA_MAO') { m = (advance(m) as { state: typeof m }).state; continue; }
    const vez = m.mao.vez!;
    const d = decidirJogada(project(m, vez), vez, vez === 'a' ? a : b, rng);
    const r = applyMove(m, { playerId: vez, mao: m.mao.numero, ...d });
    if (!r.ok) throw new Error(`bot fez jogada ilegal: ${r.motivo}`);
    m = r.state;
  }
  return m.vencedores!.includes('a') ? 'a' : 'b';
}

describe('bots', () => {
  it('nunca jogam ilegal, nos dois modos', () => {
    for (let i = 0; i < 60; i++) {
      for (const modo of ['BATIDA', 'MULTIPLO_DE_5'] as const) duelo(`ileg-${i}`, 'FACIL', 'DIFICIL', opcoesDoModo(modo));
    }
  });

  it('no múltiplo de 5, o difícil ganha do fácil na maioria', () => {
    let vitorias = 0;
    const n = 120;
    for (let i = 0; i < n; i++) {
      // Alterna quem começa sentado primeiro, para não medir a vantagem do assento.
      const difFirst = i % 2 === 0;
      const v = duelo(`t-${i}`, difFirst ? 'DIFICIL' : 'FACIL', difFirst ? 'FACIL' : 'DIFICIL', opcoesDoModo('MULTIPLO_DE_5'));
      if ((v === 'a') === difFirst) vitorias++;
    }
    expect(vitorias / n).toBeGreaterThan(0.6);
  }, 30_000);
});
