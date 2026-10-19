/**
 * O motor: distribui, valida jogada, pontua, detecta batida e jogo trancado.
 *
 * Toda função aqui devolve estado novo e nunca muta o anterior.
 */

import { createRng } from './rng.js';
import { colocar, encaixesDe, pontasAbertas, somaDasPontas } from './mesa.js';
import { compararForca, embaralhar, isDouble, parseTile, todasAsPedras, valor } from './pedras.js';
import {
  MAX_JOGADORES,
  MIN_JOGADORES,
  PEDRAS_POR_JOGADOR,
  PONTOS_DA_BATIDA,
  type EndReason,
  type EngineResult,
  type HandState,
  type Lance,
  type MatchOptions,
  type MatchState,
  type Move,
  type PlayerId,
  type ResultadoDaMao,
  type TileId,
  type TipoDeBatida,
} from './types.js';

/** Quantos lances o estado guarda. O resto da história não importa à mesa. */
export const LOG_MAX = 80;

export interface CreateMatchParams {
  matchId: string;
  seed: string;
  playerIds: PlayerId[];
  options: MatchOptions;
}

export function montarEquipes(playerIds: readonly PlayerId[], duplas: boolean): PlayerId[][] {
  if (duplas && playerIds.length === 4) {
    return [[playerIds[0]!, playerIds[2]!], [playerIds[1]!, playerIds[3]!]];
  }
  return playerIds.map((id) => [id]);
}

export const equipeDe = (state: MatchState, playerId: PlayerId): number =>
  state.equipes.findIndex((e) => e.includes(playerId));

export function createMatch({ matchId, seed, playerIds, options }: CreateMatchParams): MatchState {
  if (playerIds.length < MIN_JOGADORES || playerIds.length > MAX_JOGADORES) {
    throw new RangeError(`dominó é de ${MIN_JOGADORES} a ${MAX_JOGADORES} jogadores`);
  }
  const equipes = montarEquipes(playerIds, options.duplas);
  const base: MatchState = {
    id: matchId,
    seed,
    options,
    playerOrder: [...playerIds],
    equipes,
    placar: equipes.map(() => 0),
    // Placeholder substituído por `distribuir` logo abaixo.
    mao: null as unknown as HandState,
    log: [],
    seq: 0,
    endReason: null,
    vencedores: null,
  };
  return distribuir(base, 1, null);
}

function registrar(state: MatchState, lance: Omit<Lance, 'seq' | 'mao'>): MatchState {
  const seq = state.seq + 1;
  const log = [...state.log, { ...lance, seq, mao: state.mao.numero }].slice(-LOG_MAX);
  return { ...state, seq, log };
}

const proximoNaOrdem = (state: MatchState, playerId: PlayerId): PlayerId => {
  const i = state.playerOrder.indexOf(playerId);
  return state.playerOrder[(i + 1) % state.playerOrder.length]!;
};

/**
 * Distribui uma mão nova.
 *
 * Na primeira, começa quem tem a maior carroça — a de sena, se estiver em
 * alguma mão — e é obrigado a jogá-la. Sem carroça em mão nenhuma (só possível
 * com 2 ou 3 jogadores, quando sobra monte), começa a maior pedra.
 *
 * Nas seguintes, começa quem venceu a anterior, com a pedra que quiser.
 */
function distribuir(state: MatchState, numero: number, iniciante: PlayerId | null): MatchState {
  const rng = createRng(`${state.seed}:mao:${numero}`);
  const pedras = embaralhar(todasAsPedras(), rng);
  const maos: Record<PlayerId, TileId[]> = {};
  state.playerOrder.forEach((id, i) => {
    maos[id] = pedras.slice(i * PEDRAS_POR_JOGADOR, (i + 1) * PEDRAS_POR_JOGADOR);
  });
  const monte = pedras.slice(state.playerOrder.length * PEDRAS_POR_JOGADOR);

  let quem = iniciante;
  let obrigatoria: TileId | null = null;
  if (quem === null) {
    let melhor: { id: PlayerId; tile: TileId } | null = null;
    for (const id of state.playerOrder) {
      for (const t of maos[id]!) {
        if (!melhor || compararForca(t, melhor.tile) < 0) melhor = { id, tile: t };
      }
    }
    quem = melhor!.id;
    obrigatoria = melhor!.tile;
  }

  const mao: HandState = {
    numero,
    fase: 'JOGANDO',
    maos,
    monte,
    mesa: [],
    vez: quem,
    iniciante: quem,
    pedraObrigatoria: obrigatoria,
    primeiraCarrocaJogada: false,
    resultado: null,
  };
  return registrar({ ...state, mao }, { tipo: 'NOVA_MAO', playerId: quem });
}

/** As jogadas possíveis de alguém agora. Vazio fora da vez. */
export function jogadasLegais(state: MatchState, playerId: PlayerId): { tileId: TileId; endId: string | null }[] {
  const mao = state.mao;
  if (state.endReason !== null || mao.fase !== 'JOGANDO' || mao.vez !== playerId) return [];
  const pedras = mao.maos[playerId] ?? [];
  const candidatas = mao.pedraObrigatoria && mao.mesa.length === 0
    ? pedras.filter((t) => t === mao.pedraObrigatoria)
    : pedras;
  const out: { tileId: TileId; endId: string | null }[] = [];
  for (const t of candidatas) {
    for (const endId of encaixesDe(mao.mesa, t)) out.push({ tileId: t, endId });
  }
  return out;
}

const temJogada = (mao: HandState, playerId: PlayerId): boolean =>
  (mao.maos[playerId] ?? []).some((t) => encaixesDe(mao.mesa, t).length > 0);

export function applyMove(state: MatchState, move: Move): EngineResult {
  if (state.endReason !== null) return { ok: false, code: 'WRONG_STATUS', motivo: 'PARTIDA_ENCERRADA' };
  const mao = state.mao;
  if (move.mao !== mao.numero) return { ok: false, code: 'STALE_MOVE', motivo: 'MAO_ANTIGA' };
  if (mao.fase !== 'JOGANDO') return { ok: false, code: 'WRONG_STATUS', motivo: 'FORA_DE_JOGO' };
  if (mao.vez !== move.playerId) return { ok: false, code: 'NOT_YOUR_TURN', motivo: 'NAO_E_SUA_VEZ' };

  const pedras = mao.maos[move.playerId] ?? [];
  // Posse antes de regra: tentativa de jogar pedra alheia nunca se disfarça de
  // jogada inválida.
  if (!pedras.includes(move.tileId)) return { ok: false, code: 'FORBIDDEN_CARD', motivo: 'PEDRA_NAO_E_SUA' };

  if (mao.mesa.length === 0 && mao.pedraObrigatoria && move.tileId !== mao.pedraObrigatoria) {
    return { ok: false, code: 'ILLEGAL_MOVE', motivo: 'COMECE_PELA_MAIOR' };
  }

  const pontasAntes = pontasAbertas(mao.mesa);
  const dobra = isDouble(move.tileId);
  const abre = dobra && state.options.carrocasAbrem && mao.primeiraCarrocaJogada;
  const mesa = colocar(mao.mesa, move.tileId, move.endId, move.playerId, abre);
  if (!mesa) return { ok: false, code: 'ILLEGAL_MOVE', motivo: 'NAO_ENCAIXA' };

  const restantes = pedras.filter((t) => t !== move.tileId);
  let next: MatchState = {
    ...state,
    mao: {
      ...mao,
      mesa,
      maos: { ...mao.maos, [move.playerId]: restantes },
      primeiraCarrocaJogada: mao.primeiraCarrocaJogada || dobra,
      pedraObrigatoria: null,
    },
  };
  next = registrar(next, { tipo: 'JOGOU', playerId: move.playerId, tileId: move.tileId, endId: move.endId });

  // Múltiplo de 5: a jogada pontua quando a soma das pontas fecha em 5.
  if (state.options.modo === 'MULTIPLO_DE_5') {
    const soma = somaDasPontas(mesa);
    if (soma > 0 && soma % 5 === 0) {
      next = pontuar(next, move.playerId, soma);
      next = registrar(next, { tipo: 'PONTUOU', playerId: move.playerId, pontos: soma });
      if (next.endReason !== null) return { ok: true, state: encerrarMao(next, null) };
    }
  }

  if (restantes.length === 0) {
    return { ok: true, state: bater(next, move.playerId, move.tileId, pontasAntes.map((e) => e.value)) };
  }

  return { ok: true, state: passarVez(next, move.playerId) };
}

/** Soma pontos à equipe e encerra a partida se ela chegou à meta. */
function pontuar(state: MatchState, playerId: PlayerId, pontos: number): MatchState {
  const equipe = equipeDe(state, playerId);
  const placar = state.placar.map((p, i) => (i === equipe ? p + pontos : p));
  if (placar[equipe]! >= state.options.meta) {
    return { ...state, placar, endReason: 'META', vencedores: [...state.equipes[equipe]!] };
  }
  return { ...state, placar };
}

/**
 * Classifica a batida pelo número de pontas em que a última pedra caberia.
 *
 * Lá-e-lô: a pedra servia nas duas pontas. Cruzada: é carroça e servia nas
 * duas. Contadas sobre as pontas de ANTES da jogada.
 */
export function tipoDeBatida(tile: TileId, valoresDasPontas: readonly number[]): TipoDeBatida {
  const t = parseTile(tile);
  const servia = valoresDasPontas.filter((v) => v === t.a || v === t.b).length;
  const dobra = t.a === t.b;
  if (servia >= 2) return dobra ? 'CRUZADA' : 'LA_E_LO';
  return dobra ? 'CARROCA' : 'SIMPLES';
}

const somaDaMao = (pedras: readonly TileId[]): number =>
  pedras.reduce((s, t) => s + valor(t), 0);

function somas(state: MatchState): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {};
  for (const id of state.playerOrder) out[id] = somaDaMao(state.mao.maos[id] ?? []);
  return out;
}

function bater(state: MatchState, playerId: PlayerId, tile: TileId, pontasAntes: number[]): MatchState {
  const batida = tipoDeBatida(tile, pontasAntes);
  const pontos = state.options.modo === 'BATIDA' ? PONTOS_DA_BATIDA[batida] : 0;
  let next = registrar(state, { tipo: 'BATEU', playerId, tileId: tile, pontos });
  if (pontos > 0) next = pontuar(next, playerId, pontos);

  return encerrarMao(next, {
    tipo: 'BATIDA',
    vencedorId: playerId,
    equipeVencedora: pontos > 0 ? equipeDe(state, playerId) : null,
    pontos,
    batida,
    trancadorId: null,
    somas: somas(state),
    maos: { ...state.mao.maos },
  });
}

/**
 * Jogo trancado.
 *
 * Batida: soma-se a mão de cada equipe; a menor leva 1 ponto. Empate: perde
 * a equipe de quem trancou — se sobrar exatamente uma das empatadas, ela leva;
 * senão ninguém leva.
 *
 * Múltiplo de 5: ninguém pontua, a mão recomeça (decisão de 19/10/2026).
 */
function trancar(state: MatchState, trancadorId: PlayerId): MatchState {
  const porJogador = somas(state);
  const porEquipe = state.equipes.map((e) => e.reduce((s, id) => s + porJogador[id]!, 0));
  const menor = Math.min(...porEquipe);
  let empatadas = porEquipe.map((s, i) => (s === menor ? i : -1)).filter((i) => i >= 0);
  if (empatadas.length > 1) {
    const doTrancador = equipeDe(state, trancadorId);
    empatadas = empatadas.includes(doTrancador) ? empatadas.filter((i) => i !== doTrancador) : [];
  }
  const equipe = empatadas.length === 1 ? empatadas[0]! : null;

  // Quem começa a próxima: o jogador de menor mão na equipe que venceu.
  const vencedorId = equipe === null
    ? null
    : [...state.equipes[equipe]!].sort((x, y) => porJogador[x]! - porJogador[y]!)[0]!;

  const pontos = state.options.modo === 'BATIDA' && equipe !== null ? 1 : 0;
  let next = registrar(state, { tipo: 'TRANCOU', playerId: trancadorId, pontos });
  if (pontos > 0) next = pontuar(next, vencedorId!, pontos);

  return encerrarMao(next, {
    tipo: 'TRANCADA',
    vencedorId,
    equipeVencedora: pontos > 0 ? equipe : null,
    pontos,
    batida: null,
    trancadorId,
    somas: porJogador,
    maos: { ...state.mao.maos },
  });
}

function encerrarMao(state: MatchState, resultado: ResultadoDaMao | null): MatchState {
  return {
    ...state,
    mao: {
      ...state.mao,
      fase: 'FIM_DA_MAO',
      vez: null,
      resultado: resultado ?? {
        // A partida acabou no meio da mão (meta no múltiplo de 5).
        tipo: 'META',
        vencedorId: null,
        equipeVencedora: null,
        pontos: 0,
        batida: null,
        trancadorId: null,
        somas: somas(state),
        maos: { ...state.mao.maos },
      },
    },
  };
}

/**
 * Passa a vez para o próximo que consiga jogar.
 *
 * Quem não tem pedra que encaixe compra do monte até conseguir; com o monte
 * vazio, passa. Se todo mundo passa em sequência, o jogo trancou — e quem
 * trancou foi quem jogou a última pedra.
 */
function passarVez(state: MatchState, quemJogou: PlayerId): MatchState {
  let next = state;
  let candidato = proximoNaOrdem(next, quemJogou);
  let passes = 0;

  for (let guarda = 0; guarda < next.playerOrder.length * 30; guarda++) {
    if (temJogada(next.mao, candidato)) {
      return { ...next, mao: { ...next.mao, vez: candidato } };
    }

    // Compra até encaixar ou o monte acabar.
    let compradas = 0;
    let mao = next.mao;
    while (mao.monte.length > 0 && !temJogada(mao, candidato)) {
      const [topo, ...resto] = mao.monte;
      mao = { ...mao, monte: resto, maos: { ...mao.maos, [candidato]: [...mao.maos[candidato]!, topo!] } };
      compradas++;
    }
    next = { ...next, mao };
    if (compradas > 0) next = registrar(next, { tipo: 'COMPROU', playerId: candidato, quantidade: compradas });

    if (temJogada(next.mao, candidato)) {
      return { ...next, mao: { ...next.mao, vez: candidato } };
    }

    next = registrar(next, { tipo: 'PASSOU', playerId: candidato });
    passes++;
    if (passes >= next.playerOrder.length) return trancar(next, quemJogou);
    candidato = proximoNaOrdem(next, candidato);
  }
  // Inalcançável: cada volta compra ou passa, e ambos acabam.
  return trancar(next, quemJogou);
}

/** Fase automática: do fim da mão para a próxima. */
export function advance(state: MatchState): EngineResult {
  if (state.endReason !== null) return { ok: false, code: 'WRONG_STATUS', motivo: 'PARTIDA_ENCERRADA' };
  if (state.mao.fase !== 'FIM_DA_MAO') return { ok: false, code: 'WRONG_STATUS', motivo: 'MAO_EM_ANDAMENTO' };

  const r = state.mao.resultado;
  // Sem vencedor (empate no trancado): começa o seguinte de quem começou.
  const iniciante = r?.vencedorId ?? proximoNaOrdem(state, state.mao.iniciante);
  return { ok: true, state: distribuir(state, state.mao.numero + 1, iniciante) };
}

export const isAutomaticPhase = (state: MatchState): boolean => state.mao.fase === 'FIM_DA_MAO';

/**
 * A jogada que o sistema faz por quem estourou o tempo: a pedra mais pesada,
 * preferindo a que pontua no múltiplo de 5. Sempre legal por construção.
 */
export function autoMove(state: MatchState): Move {
  const vez = state.mao.vez!;
  const legais = jogadasLegais(state, vez);
  let melhor = legais[0]!;
  let melhorNota = -Infinity;
  for (const j of legais) {
    let nota = valor(j.tileId) + (isDouble(j.tileId) ? 0.5 : 0);
    if (state.options.modo === 'MULTIPLO_DE_5') {
      const mesa = colocar(state.mao.mesa, j.tileId, j.endId, vez,
        isDouble(j.tileId) && state.options.carrocasAbrem && state.mao.primeiraCarrocaJogada);
      const soma = mesa ? somaDasPontas(mesa) : 0;
      if (soma > 0 && soma % 5 === 0) nota += 100 + soma;
    }
    if (nota > melhorNota) { melhorNota = nota; melhor = j; }
  }
  return { playerId: vez, mao: state.mao.numero, tileId: melhor.tileId, endId: melhor.endId };
}

export function endMatch(state: MatchState, reason: EndReason): MatchState {
  if (state.endReason !== null) return state;
  return { ...state, endReason: reason, vencedores: [] };
}
