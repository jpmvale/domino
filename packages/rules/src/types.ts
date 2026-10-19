/**
 * Tipos do motor de regras do dominó.
 *
 * O motor é puro e determinístico: tempo e aleatoriedade entram por parâmetro
 * (a semente da partida), nunca de `Date.now()` ou `Math.random()`. É o que
 * permite simular mil partidas num teste e reproduzir qualquer bug pela
 * semente.
 *
 * Regras completas e as escolhas de cada variação em `docs/regras.md`.
 */

export type PlayerId = string;

/** `"a-b"` com `a <= b`. Ex.: `"0-0"`, `"3-5"`, `"6-6"`. */
export type TileId = string;

export interface Tile {
  id: TileId;
  a: number;
  b: number;
}

/**
 * Os dois modos.
 *
 * `BATIDA` é o padrão: pontua só o fim da mão — quem bate, ou a menor mão no
 * jogo trancado.
 *
 * `MULTIPLO_DE_5` pontua a cada jogada cuja soma das pontas dá múltiplo de 5.
 * Bater ou trancar não vale nada: a mão recomeça (decisão de 19/10/2026).
 */
export type Modo = 'BATIDA' | 'MULTIPLO_DE_5';

export interface MatchOptions {
  modo: Modo;
  /** Com 4 jogadores, duplas fixas: assentos 1 e 3 contra 2 e 4. */
  duplas: boolean;
  /**
   * Carroças depois da primeira abrem as laterais e viram três pontas.
   * A primeira carroça da mão nunca abre (decisão de 19/10/2026).
   */
  carrocasAbrem: boolean;
  /** Pontos para vencer a partida. */
  meta: number;
}

export const METAS: Record<Modo, readonly number[]> = {
  BATIDA: [3, 4, 6, 8, 10],
  MULTIPLO_DE_5: [100, 150, 200, 250, 300],
};

export function opcoesDoModo(modo: Modo): MatchOptions {
  return modo === 'BATIDA'
    ? { modo, duplas: true, carrocasAbrem: false, meta: 6 }
    : { modo, duplas: true, carrocasAbrem: true, meta: 200 };
}

export const DEFAULT_OPTIONS: MatchOptions = opcoesDoModo('BATIDA');

/** Peças por jogador, em qualquer número de jogadores (2 a 4). */
export const PEDRAS_POR_JOGADOR = 7;
export const MIN_JOGADORES = 2;
export const MAX_JOGADORES = 4;

/**
 * Lados de uma pedra na mesa onde outra pode encostar.
 *
 * `E`/`D`: as duas pontas da primeira pedra (esquerda e direita).
 * `C`: a continuação de qualquer outra pedra, do lado oposto ao que encostou.
 * `L`/`R`: as laterais de uma carroça que abre.
 */
export type Slot = 'E' | 'D' | 'C' | 'L' | 'R';

export interface Placement {
  /** Posição na ordem em que as pedras foram jogadas. 0 = a primeira. */
  idx: number;
  tileId: TileId;
  a: number;
  b: number;
  /** Em que pedra encostou, e em qual lado dela. `null` na primeira. */
  parent: number | null;
  parentSlot: Slot | null;
  /** O número do lado que encostou. `null` na primeira. */
  inValue: number | null;
  /** O número que fica para fora na continuação. `null` na primeira. */
  outValue: number | null;
  isDouble: boolean;
  /** Carroça que abre as laterais. */
  branches: boolean;
  /** Lados disponíveis: `null` aberto, número = índice da pedra que encostou. */
  slots: Partial<Record<Slot, number | null>>;
  playerId: PlayerId;
}

export interface OpenEnd {
  /** `${idx}${slot}`, ex.: `"0E"`, `"4C"`, `"7L"`. */
  id: string;
  placement: number;
  slot: Slot;
  value: number;
}

export type TipoDeBatida = 'SIMPLES' | 'CARROCA' | 'LA_E_LO' | 'CRUZADA';

export const PONTOS_DA_BATIDA: Record<TipoDeBatida, number> = {
  SIMPLES: 1,
  CARROCA: 2,
  LA_E_LO: 3,
  CRUZADA: 4,
};

export interface ResultadoDaMao {
  /** `META`: a partida acabou no meio da mão, no múltiplo de 5. */
  tipo: 'BATIDA' | 'TRANCADA' | 'META';
  /** Quem bateu, ou quem tinha a menor mão no trancado. */
  vencedorId: PlayerId | null;
  /** Índice da equipe que pontuou, se alguém pontuou. */
  equipeVencedora: number | null;
  pontos: number;
  batida: TipoDeBatida | null;
  /** Quem jogou a última pedra antes de trancar. */
  trancadorId: PlayerId | null;
  /** Soma das pedras que sobraram, por jogador. */
  somas: Record<PlayerId, number>;
  /** Mãos de todo mundo no fim — pública a partir daqui. */
  maos: Record<PlayerId, TileId[]>;
}

export type FaseDaMao = 'JOGANDO' | 'FIM_DA_MAO';

export interface HandState {
  numero: number;
  fase: FaseDaMao;
  maos: Record<PlayerId, TileId[]>;
  monte: TileId[];
  mesa: Placement[];
  vez: PlayerId | null;
  iniciante: PlayerId;
  /** Na primeira mão, quem começa joga a maior carroça (ou a maior pedra). */
  pedraObrigatoria: TileId | null;
  primeiraCarrocaJogada: boolean;
  resultado: ResultadoDaMao | null;
}

export type TipoDeLance =
  | 'JOGOU' | 'COMPROU' | 'PASSOU' | 'PONTUOU' | 'BATEU' | 'TRANCOU' | 'NOVA_MAO';

export interface Lance {
  seq: number;
  mao: number;
  tipo: TipoDeLance;
  playerId: PlayerId | null;
  tileId?: TileId;
  endId?: string | null;
  pontos?: number;
  quantidade?: number;
  automatico?: boolean;
}

export type EndReason = 'META' | 'ENCERRADA_PELO_HOST' | 'ENCERRADA_POR_AUSENCIA';

export interface MatchState {
  id: string;
  seed: string;
  options: MatchOptions;
  playerOrder: PlayerId[];
  /** Cada equipe é uma lista de jogadores. Sem duplas, uma por jogador. */
  equipes: PlayerId[][];
  placar: number[];
  mao: HandState;
  log: Lance[];
  seq: number;
  endReason: EndReason | null;
  vencedores: PlayerId[] | null;
}

export interface Move {
  playerId: PlayerId;
  /** Número da mão: jogada atrasada de mão anterior é recusada. */
  mao: number;
  tileId: TileId;
  /** Ponta onde encaixar. `null` só na primeira pedra da mão. */
  endId: string | null;
}

export type EngineError =
  | 'WRONG_STATUS' | 'STALE_MOVE' | 'NOT_YOUR_TURN' | 'FORBIDDEN_CARD' | 'ILLEGAL_MOVE';

export type EngineResult =
  | { ok: true; state: MatchState }
  | { ok: false; code: EngineError; motivo: string };
