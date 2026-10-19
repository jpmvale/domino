/**
 * O que cada jogador tem direito de ver.
 *
 * Montado por allowlist: só sai o que está escrito aqui. A mão dos outros e o
 * monte nunca saem durante o jogo — só a contagem. No fim da mão, todas as
 * mãos ficam públicas (é quando se conta o trancado).
 */

import { jogadasLegais } from './engine.js';
import { pontasAbertas, somaDasPontas } from './mesa.js';
import { compararForca } from './pedras.js';
import type {
  EndReason,
  FaseDaMao,
  Lance,
  MatchOptions,
  OpenEnd,
  Placement,
  PlayerId,
  ResultadoDaMao,
  TileId,
} from './types.js';
import type { MatchState } from './types.js';

export interface MatchView {
  matchId: string;
  options: MatchOptions;
  playerOrder: PlayerId[];
  equipes: PlayerId[][];
  placar: number[];
  maoNumero: number;
  fase: FaseDaMao;
  vez: PlayerId | null;
  iniciante: PlayerId;
  mesa: Placement[];
  pontas: OpenEnd[];
  soma: number;
  monte: number;
  /** Quantas pedras cada um tem. Público. */
  contagem: Record<PlayerId, number>;
  /** A mão de quem vê. Vazia para quem assiste. */
  minhaMao: TileId[];
  /** Só para quem está na vez. */
  jogadasLegais: { tileId: TileId; endId: string | null }[];
  pedraObrigatoria: TileId | null;
  resultado: ResultadoDaMao | null;
  log: Lance[];
  endReason: EndReason | null;
  vencedores: PlayerId[] | null;
}

export function project(state: MatchState, viewerId: PlayerId | null): MatchView {
  const mao = state.mao;
  const contagem: Record<PlayerId, number> = {};
  for (const id of state.playerOrder) contagem[id] = mao.maos[id]?.length ?? 0;

  const sentado = viewerId !== null && state.playerOrder.includes(viewerId);
  const minhaMao = sentado ? [...(mao.maos[viewerId] ?? [])].sort(compararForca) : [];

  return {
    matchId: state.id,
    options: state.options,
    playerOrder: [...state.playerOrder],
    equipes: state.equipes.map((e) => [...e]),
    placar: [...state.placar],
    maoNumero: mao.numero,
    fase: mao.fase,
    vez: mao.vez,
    iniciante: mao.iniciante,
    mesa: mao.mesa,
    pontas: pontasAbertas(mao.mesa),
    soma: somaDasPontas(mao.mesa),
    monte: mao.monte.length,
    contagem,
    minhaMao,
    jogadasLegais: sentado ? jogadasLegais(state, viewerId) : [],
    // A pedra obrigatória é pública: a mesa inteira sabe quem tem a sena.
    pedraObrigatoria: mao.mesa.length === 0 ? mao.pedraObrigatoria : null,
    // `resultado` só existe no fim da mão, quando as mãos já são públicas.
    resultado: mao.resultado,
    // Só a mão corrente: lance de mão passada citaria pedra que hoje está na
    // mão de alguém.
    log: state.log.filter((l) => l.mao === mao.numero),
    endReason: state.endReason,
    vencedores: state.vencedores,
  };
}
