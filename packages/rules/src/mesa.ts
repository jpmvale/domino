/**
 * A mesa: as pedras jogadas, as pontas abertas e a soma delas.
 *
 * A mesa é uma árvore. A primeira pedra tem dois lados (`E` e `D`); cada pedra
 * seguinte encosta num lado aberto e oferece a continuação (`C`). Uma carroça
 * que abre oferece também as duas laterais (`L` e `R`) — três pontas novas.
 */

import { parseTile } from './pedras.js';
import type { OpenEnd, Placement, PlayerId, Slot, TileId } from './types.js';

export const endIdOf = (placement: number, slot: Slot): string => `${placement}${slot}`;

/** Número exposto num lado de uma pedra da mesa. */
function valorDoLado(p: Placement, slot: Slot): number {
  if (p.parent === null) {
    // A primeira pedra: `E` é o lado `a`, `D` o lado `b`. Numa carroça, iguais.
    return slot === 'E' ? p.a : p.b;
  }
  // Continuação e laterais. Laterais só existem em carroça, onde tudo é igual.
  return p.outValue!;
}

export function pontasAbertas(mesa: readonly Placement[]): OpenEnd[] {
  const pontas: OpenEnd[] = [];
  for (const p of mesa) {
    for (const [slot, filho] of Object.entries(p.slots) as [Slot, number | null][]) {
      if (filho !== null) continue;
      pontas.push({ id: endIdOf(p.idx, slot), placement: p.idx, slot, value: valorDoLado(p, slot) });
    }
  }
  return pontas;
}

/**
 * Soma das pontas, para o modo múltiplo de 5.
 *
 * - Pedra comum na ponta conta o número que fica para fora.
 * - Carroça na ponta conta as duas metades (5:5 vale 10). Isso vale para a
 *   primeira pedra quando é carroça — sozinha na mesa ela conta 10 uma vez,
 *   não 20 — e para toda carroça que não abre.
 * - Carroça que abre: enquanto nada encostou nas laterais nem na continuação,
 *   conta como uma ponta só, valendo o dobro. Depois que alguém encostou, cada
 *   lado livre vale o número dela (decisão de 19/10/2026).
 */
export function somaDasPontas(mesa: readonly Placement[]): number {
  let soma = 0;
  for (const p of mesa) {
    const lados = Object.values(p.slots) as (number | null)[];
    const abertos = lados.filter((f) => f === null).length;
    if (abertos === 0) continue;

    if (!p.isDouble) {
      // Pedra comum: só tem um lado aberto se não é a primeira. A primeira
      // pode ter dois, e cada um vale o seu número.
      for (const [slot, filho] of Object.entries(p.slots) as [Slot, number | null][]) {
        if (filho === null) soma += valorDoLado(p, slot);
      }
      continue;
    }

    const v = p.a;
    if (p.branches && abertos < lados.length) {
      soma += v * abertos;
    } else {
      soma += v * 2;
    }
  }
  return soma;
}

/** Onde essa pedra encaixa. Mesa vazia: em lugar nenhum específico (`null`). */
export function encaixesDe(mesa: readonly Placement[], tile: TileId): (string | null)[] {
  if (mesa.length === 0) return [null];
  const t = parseTile(tile);
  return pontasAbertas(mesa)
    .filter((e) => e.value === t.a || e.value === t.b)
    .map((e) => e.id);
}

/**
 * Coloca a pedra. Não valida posse nem vez — isso é do motor. Valida só o
 * encaixe, e devolve `null` quando não encaixa.
 */
export function colocar(
  mesa: readonly Placement[],
  tile: TileId,
  endId: string | null,
  playerId: PlayerId,
  abreLaterais: boolean,
): Placement[] | null {
  const t = parseTile(tile);
  const isDouble = t.a === t.b;
  const idx = mesa.length;

  if (mesa.length === 0) {
    if (endId !== null) return null;
    return [{
      idx, tileId: tile, a: t.a, b: t.b, parent: null, parentSlot: null,
      inValue: null, outValue: null, isDouble,
      // A primeira pedra nunca abre: é sempre a primeira carroça, se for uma.
      branches: false,
      slots: { E: null, D: null },
      playerId,
    }];
  }

  if (endId === null) return null;
  const ponta = pontasAbertas(mesa).find((e) => e.id === endId);
  if (!ponta) return null;
  if (ponta.value !== t.a && ponta.value !== t.b) return null;

  const inValue = ponta.value;
  const outValue = t.a === inValue ? t.b : t.a;
  const branches = isDouble && abreLaterais;

  const nova: Placement = {
    idx, tileId: tile, a: t.a, b: t.b,
    parent: ponta.placement, parentSlot: ponta.slot,
    inValue, outValue, isDouble, branches,
    slots: branches ? { C: null, L: null, R: null } : { C: null },
    playerId,
  };

  return [
    ...mesa.map((p) =>
      p.idx === ponta.placement ? { ...p, slots: { ...p.slots, [ponta.slot]: idx } } : p),
    nova,
  ];
}
