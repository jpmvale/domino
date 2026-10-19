/**
 * Estado da sala.
 *
 * A sala é a camada acima do motor: cuida de quem está presente, de quem
 * manda, do relógio e da pausa. Ela **não** decide resultado de jogada — isso
 * é do motor, que ela chama.
 *
 * Determinística como o motor: o tempo entra por `RoomCtx.now`. É o que permite
 * testar 10 minutos de pausa em microssegundos.
 */

import type {
  Avatar,
  BotDifficulty,
  ChatMessage,
  ConnectionStatus,
  ErrorCode,
  PublicPlayer,
  RoomStatus,
  ServerEvent,
} from '@domino/protocol';
import type { MatchOptions, MatchState, PlayerId } from '@domino/rules';

/** `RECONECTANDO`: o socket caiu e a carência ainda corre. Nunca sai no fio. */
export type InternalConnection = ConnectionStatus | 'RECONECTANDO';

export interface RoomPlayer {
  id: PlayerId;
  nickname: string;
  avatar: Avatar;
  connection: InternalConnection;
  /** Entrou com partida em andamento, ou escolheu assistir. */
  isSpectator: boolean;
  joinedAt: number;
  lastSeenAt: number;
  socketLostAt: number | null;
  /**
   * Avisou que saiu da tela (trocou de app, bloqueou o celular). Não é
   * ausência: a mesa não pausa, e a jogada automática cobre a vez.
   */
  emSegundoPlano: boolean;
  pronto: boolean;
  silenciado: boolean;
  /** Expulso no meio da partida: o assento segue com um bot, a pessoa não volta. */
  expulsoEm: number | null;
  lastChatAt: number | null;
  bot: { difficulty: BotDifficulty } | null;
}

export interface PauseState {
  since: number;
  decisionUnlockedAt: number;
  hardDeadline: number;
  decisionAnnounced: boolean;
}

export interface Room {
  code: string;
  status: RoomStatus;
  hostId: PlayerId | null;
  players: RoomPlayer[];
  /** Ordem dos assentos escolhida no lobby. Define as duplas. */
  ordem: PlayerId[];
  options: MatchOptions;
  match: MatchState | null;
  pause: PauseState | null;
  /** Monotônico, nunca reutilizado. */
  stateVersion: number;
  createdAt: number;
  lastActivityAt: number;
  /** Prazo da vez, ou do fim da mão. `null` sempre que pausada. */
  phaseDeadline: number | null;
  chat: ChatMessage[];
}

/** Evento já endereçado. O retrato da sala sai sempre, à parte destes. */
export interface Emission {
  audience: 'ALL' | { playerId: PlayerId };
  event: ServerEvent;
}

export type RoomResult =
  | { ok: true; room: Room; emissions: Emission[] }
  | { ok: false; code: ErrorCode; motivo: string };

export interface RoomCtx {
  now: number;
  randomSeed: () => string;
  newId: () => string;
}

export interface JoinParams {
  playerId: PlayerId;
  nickname: string;
  avatar: Avatar;
}

export function toPublicPlayer(player: RoomPlayer): PublicPlayer {
  return {
    id: player.id,
    nickname: player.nickname,
    avatar: player.avatar,
    connection: player.connection === 'RECONECTANDO' ? 'CONECTADO' : player.connection,
    isSpectator: player.isSpectator,
    joinedAt: player.joinedAt,
    pronto: player.pronto,
    silenciado: player.silenciado,
    emSegundoPlano: player.emSegundoPlano,
    ...(player.bot ? { bot: { difficulty: player.bot.difficulty } } : {}),
  };
}

export const isBot = (player: RoomPlayer): boolean => player.bot !== null;
export const foiExpulso = (player: RoomPlayer): boolean => player.expulsoEm !== null;

export function isPresent(player: RoomPlayer): boolean {
  return player.connection !== 'SAIU' && player.connection !== 'REMOVIDO';
}

export function isOnline(player: RoomPlayer): boolean {
  return player.connection === 'CONECTADO' || player.connection === 'RECONECTANDO';
}

/** Ausente para efeito de jogo: pausa a partida. Segundo plano não conta. */
export function isAbsent(player: RoomPlayer): boolean {
  if (player.emSegundoPlano) return false;
  return player.connection === 'DESCONECTADO';
}
