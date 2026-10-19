import { describe, expect, it } from 'vitest';
import {
  advance,
  applyMove,
  checkInvariants,
  colocar,
  createMatch,
  createRng,
  jogadasLegais,
  opcoesDoModo,
  pontasAbertas,
  project,
  somaDasPontas,
  tipoDeBatida,
  todasAsPedras,
  type MatchOptions,
  type MatchState,
  type Placement,
  type TileId,
} from '../src/index.js';

/** Monta uma mesa jogando as pedras em sequência, cada uma na ponta pedida. */
function mesaDe(jogadas: [TileId, string | null][], abrem = false): Placement[] {
  let mesa: Placement[] = [];
  let primeira = false;
  for (const [t, end] of jogadas) {
    const [a, b] = t.split('-').map(Number);
    const dobra = a === b;
    const r = colocar(mesa, t, end, 'p1', dobra && abrem && primeira);
    if (!r) throw new Error(`não encaixou ${t} em ${end}`);
    mesa = r;
    primeira ||= dobra;
  }
  return mesa;
}

describe('mesa', () => {
  it('a primeira pedra abre duas pontas', () => {
    const mesa = mesaDe([['3-5', null]]);
    expect(pontasAbertas(mesa).map((e) => [e.id, e.value])).toEqual([['0E', 3], ['0D', 5]]);
    expect(somaDasPontas(mesa)).toBe(8);
  });

  it('carroça sozinha na mesa conta as duas metades uma vez só', () => {
    expect(somaDasPontas(mesaDe([['5-5', null]]))).toBe(10);
  });

  it('carroça na ponta conta dobrado', () => {
    // 5:5 de saída, 5:3 de um lado: pontas 3 e a carroça (10).
    const mesa = mesaDe([['5-5', null], ['3-5', '0D']]);
    expect(somaDasPontas(mesa)).toBe(13);
    // 3:3 encostando: 5:5 (10) + 3:3 na ponta (6).
    expect(somaDasPontas(mesaDe([['5-5', null], ['3-5', '0D'], ['3-3', '1C']]))).toBe(16);
  });

  it('a primeira carroça nunca abre; as seguintes abrem três pontas', () => {
    const mesa = mesaDe([['5-5', null], ['4-5', '0D'], ['4-4', '1C']], true);
    expect(mesa[0]!.branches).toBe(false);
    expect(mesa[2]!.branches).toBe(true);
    const pontas = pontasAbertas(mesa);
    expect(pontas.filter((e) => e.placement === 2).map((e) => e.slot).sort()).toEqual(['C', 'L', 'R']);
    // Sem nada encostado, o 4:4 vale 8, como uma ponta só.
    expect(somaDasPontas(mesa)).toBe(10 + 8);
  });

  it('carroça que abre: depois que encostam, cada lado livre vale o número', () => {
    const mesa = mesaDe([['5-5', null], ['4-5', '0D'], ['4-4', '1C'], ['2-4', '2L']], true);
    // 5:5 na ponta (10) + 4:4 com C e R livres (4 + 4) + 2 do 2:4.
    expect(somaDasPontas(mesa)).toBe(10 + 8 + 2);
  });

  it('recusa pedra que não encaixa', () => {
    expect(colocar(mesaDe([['3-5', null]]), '1-2', '0E', 'p1', false)).toBeNull();
  });
});

describe('tipo de batida', () => {
  it('simples, carroça, lá-e-lô e cruzada', () => {
    expect(tipoDeBatida('2-3', [3, 6])).toBe('SIMPLES');
    expect(tipoDeBatida('3-3', [3, 6])).toBe('CARROCA');
    expect(tipoDeBatida('3-6', [3, 6])).toBe('LA_E_LO');
    expect(tipoDeBatida('4-4', [4, 4])).toBe('CRUZADA');
  });
});

describe('início da partida', () => {
  it('4 jogadores: 7 pedras cada, sem monte, e quem tem a sena começa por ela', () => {
    const m = createMatch({ matchId: 'm', seed: 's1', playerIds: ['a', 'b', 'c', 'd'], options: opcoesDoModo('BATIDA') });
    expect(Object.values(m.mao.maos).every((h) => h.length === 7)).toBe(true);
    expect(m.mao.monte).toHaveLength(0);
    expect(m.mao.maos[m.mao.vez!]).toContain('6-6');
    expect(m.mao.pedraObrigatoria).toBe('6-6');
    expect(jogadasLegais(m, m.mao.vez!)).toEqual([{ tileId: '6-6', endId: null }]);
  });

  it('duplas: 1 e 3 contra 2 e 4', () => {
    const m = createMatch({ matchId: 'm', seed: 's', playerIds: ['a', 'b', 'c', 'd'], options: opcoesDoModo('BATIDA') });
    expect(m.equipes).toEqual([['a', 'c'], ['b', 'd']]);
  });

  it('2 jogadores: sobra monte de 14', () => {
    const m = createMatch({ matchId: 'm', seed: 's', playerIds: ['a', 'b'], options: opcoesDoModo('BATIDA') });
    expect(m.mao.monte).toHaveLength(14);
  });

  it('recusa pedra alheia antes de qualquer regra', () => {
    const m = createMatch({ matchId: 'm', seed: 's1', playerIds: ['a', 'b', 'c', 'd'], options: opcoesDoModo('BATIDA') });
    const vez = m.mao.vez!;
    const alheia = Object.entries(m.mao.maos).find(([id]) => id !== vez)![1][0]!;
    const r = applyMove(m, { playerId: vez, mao: 1, tileId: alheia, endId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FORBIDDEN_CARD');
  });
});

// ---------------------------------------------------------------------------
// Simulação de propriedade
// ---------------------------------------------------------------------------

function simular(seed: string, jogadores: number, options: MatchOptions, conferirVazamento: boolean): MatchState {
  const ids = ['a', 'b', 'c', 'd'].slice(0, jogadores);
  let m = createMatch({ matchId: seed, seed, playerIds: ids, options });
  const rng = createRng(`jogadas:${seed}`);

  for (let passos = 0; passos < 5_000 && m.endReason === null; passos++) {
    const erros = checkInvariants(m);
    if (erros.length > 0) throw new Error(`${seed}: ${erros.join('; ')}`);

    // Nada da mão alheia nem do monte vaza para quem vê.
    if (conferirVazamento && m.mao.fase === 'JOGANDO') {
      for (const viewer of ids) {
        const visto = JSON.stringify(project(m, viewer));
        const proibidas = [
          ...m.mao.monte,
          ...ids.filter((id) => id !== viewer).flatMap((id) => m.mao.maos[id]!),
        ].filter((t) => t !== m.mao.pedraObrigatoria); // a saída obrigatória é anunciada
        for (const t of proibidas) {
          if (visto.includes(`"${t}"`)) throw new Error(`${seed}: ${t} vazou para ${viewer}`);
        }
      }
    }

    if (m.mao.fase === 'FIM_DA_MAO') {
      const r = advance(m);
      if (!r.ok) throw new Error(r.motivo);
      m = r.state;
      continue;
    }
    const legais = jogadasLegais(m, m.mao.vez!);
    if (legais.length === 0) throw new Error(`${seed}: vez sem jogada`);
    const j = legais[rng.nextInt(legais.length)]!;
    const r = applyMove(m, { playerId: m.mao.vez!, mao: m.mao.numero, ...j });
    if (!r.ok) throw new Error(`${seed}: jogada legal recusada: ${r.motivo}`);
    m = r.state;
  }
  const erros = checkInvariants(m);
  if (erros.length > 0) throw new Error(`${seed}: ${erros.join('; ')}`);
  return m;
}

describe('simulação', () => {
  const combinacoes: [number, MatchOptions][] = [];
  for (const n of [2, 3, 4]) {
    for (const modo of ['BATIDA', 'MULTIPLO_DE_5'] as const) {
      for (const duplas of [true, false]) {
        for (const carrocasAbrem of [true, false]) {
          combinacoes.push([n, { ...opcoesDoModo(modo), duplas, carrocasAbrem }]);
        }
      }
    }
  }

  it('1.000 partidas completas sem violar invariante nem vazar pedra', () => {
    let terminadas = 0;
    for (let i = 0; i < 1_000; i++) {
      const [n, opts] = combinacoes[i % combinacoes.length]!;
      const m = simular(`sim-${i}`, n, opts, i < 100);
      if (m.endReason === 'META') terminadas++;
      expect(m.vencedores?.length).toBeGreaterThan(0);
    }
    expect(terminadas).toBe(1_000);
  }, 60_000);

  it('todas as pedras existem e são 28 distintas', () => {
    expect(new Set(todasAsPedras()).size).toBe(28);
  });
});
