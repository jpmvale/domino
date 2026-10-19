/**
 * Invariantes que valem em qualquer estado da partida. A simulação de
 * propriedade confere todos a cada jogada.
 */

import { pontasAbertas } from './mesa.js';
import { TOTAL_DE_PEDRAS } from './pedras.js';
import type { MatchState } from './types.js';

export function checkInvariants(state: MatchState): string[] {
  const erros: string[] = [];
  const mao = state.mao;

  // INV-1: as 28 pedras estão sempre em algum lugar, e em um só.
  const todas = [
    ...Object.values(mao.maos).flat(),
    ...mao.monte,
    ...mao.mesa.map((p) => p.tileId),
  ];
  if (todas.length !== TOTAL_DE_PEDRAS) erros.push(`INV-1: ${todas.length} pedras em vez de 28`);
  if (new Set(todas).size !== todas.length) erros.push('INV-1: pedra repetida');

  // INV-2: toda pedra na mesa encostou num número igual ao dela.
  for (const p of mao.mesa) {
    if (p.parent === null) continue;
    if (p.inValue !== p.a && p.inValue !== p.b) erros.push(`INV-2: pedra ${p.tileId} não encaixa`);
    const pai = mao.mesa[p.parent];
    if (!pai || pai.slots[p.parentSlot!] !== p.idx) erros.push(`INV-2: ligação quebrada em ${p.tileId}`);
  }

  // INV-3: em jogo, há vez e quem está nela tem pedra; no fim da mão, não há vez.
  if (mao.fase === 'JOGANDO') {
    if (state.endReason === null && mao.vez === null) erros.push('INV-3: jogando sem vez');
  } else if (mao.vez !== null) {
    erros.push('INV-3: fim da mão com vez');
  }

  // INV-4: mesa com pedras sempre tem pontas (sem pontas, ninguém jogaria).
  if (mao.mesa.length > 0 && pontasAbertas(mao.mesa).length === 0) erros.push('INV-4: mesa sem pontas');

  // INV-5: no múltiplo de 5 o placar é sempre múltiplo de 5.
  if (state.options.modo === 'MULTIPLO_DE_5' && state.placar.some((p) => p % 5 !== 0)) {
    erros.push('INV-5: placar fora de múltiplo de 5');
  }

  // INV-6: placar nunca diminui abaixo de zero, e vencedor só com partida encerrada.
  if (state.placar.some((p) => p < 0)) erros.push('INV-6: placar negativo');
  if (state.vencedores !== null && state.endReason === null) erros.push('INV-6: vencedor sem fim');

  // INV-7: quem chegou à meta encerrou a partida.
  if (state.endReason === null && state.placar.some((p) => p >= state.options.meta)) {
    erros.push('INV-7: meta atingida sem fim de partida');
  }

  return erros;
}
