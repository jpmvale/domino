/**
 * Contrato cliente ↔ servidor. Fonte única de tipos.
 *
 * Só tipos e constantes: os schemas de runtime moram em
 * `@domino/protocol/validate`, que puxa o zod e nunca entra no bundle do
 * cliente.
 *
 * O modelo de sincronização é por retrato: a cada mudança, o servidor manda a
 * cada pessoa o retrato da sala já projetado para ela (`room:state`). Nada de
 * estado oculto trafega, e o cliente nunca precisa reconstruir regra a partir
 * de eventos soltos. O estado do dominó é pequeno o bastante para isso.
 */

import type { MatchOptions, MatchView, PlayerId, TileId } from '@domino/rules';
import type { BotDifficulty } from '@domino/bot';

export type { BotDifficulty } from '@domino/bot';
export { BOT_DIFFICULTIES } from '@domino/bot';

export const PROTOCOL_VERSION = 1;

export interface Envelope<T = unknown> {
  v: typeof PROTOCOL_VERSION;
  /** uuid do cliente; ecoado em ack/erro. Base da idempotência. */
  id: string;
  type: string;
  ts: number;
  payload: T;
}

// ---------------------------------------------------------------------------
// Identidade e sala
// ---------------------------------------------------------------------------

export const AVATAR_EMOJIS = [
  '🦊', '🐙', '🐸', '🦁', '🐼', '🦉', '🐺', '🦝',
  '🐨', '🐯', '🦄', '🐢', '🦈', '🐝', '🦋', '🐌',
  '🦖', '🐳', '🦩', '🦔', '🐧', '🦜', '🐴', '🦥',
] as const;
export type AvatarEmoji = (typeof AVATAR_EMOJIS)[number];

/** Paleta fechada, a mesma do FDP: distinguível sob deuteranopia e protanopia. */
export const AVATAR_COLORS = [
  'amber', 'teal', 'rose', 'indigo', 'lime', 'sky', 'orange', 'violet',
] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export interface Avatar {
  emoji: AvatarEmoji;
  color: AvatarColor;
}

export type RoomStatus = 'LOBBY' | 'EM_PARTIDA' | 'PAUSADA' | 'FIM_DE_PARTIDA' | 'ENCERRADA';

/** `RECONECTANDO` é interno ao servidor e nunca sai para o cliente. */
export type ConnectionStatus = 'CONECTADO' | 'DESCONECTADO' | 'REMOVIDO' | 'SAIU';

export interface PublicPlayer {
  id: PlayerId;
  nickname: string;
  avatar: Avatar;
  connection: ConnectionStatus;
  isSpectator: boolean;
  joinedAt: number;
  pronto: boolean;
  silenciado: boolean;
  emSegundoPlano: boolean;
  /** Presente só em bot. Uma mesa que não sabe quem é bot não sabe o que joga. */
  bot?: { difficulty: BotDifficulty };
}

/** O apelido é COPIADO no envio: histórico não muda de autor depois de dito. */
export interface ChatMessage {
  id: string;
  playerId: PlayerId;
  nickname: string;
  text: string;
  at: number;
  spectator: boolean;
}

export interface PauseInfo {
  since: number;
  absentPlayerIds: PlayerId[];
  decisionUnlockedAt: number;
  hardDeadline: number;
}

/** O retrato da sala, já projetado para quem recebe. */
export interface RoomView {
  code: string;
  status: RoomStatus;
  hostId: PlayerId | null;
  options: MatchOptions;
  stateVersion: number;
  players: PublicPlayer[];
  /** Ordem dos assentos no lobby: quem senta onde, e portanto quem é dupla. */
  ordem: PlayerId[];
  pause: PauseInfo | null;
  phaseDeadline: number | null;
  match: MatchView | null;
}

// ---------------------------------------------------------------------------
// Comandos: cliente → servidor
// ---------------------------------------------------------------------------

export type Command =
  | { type: 'room:resync'; payload: Record<string, never> }
  | { type: 'player:setProfile'; payload: { nickname: string; avatar: Avatar } }
  /** O celular avisando que foi para segundo plano (não pausa a mesa). */
  | { type: 'player:background'; payload: { emSegundoPlano: boolean } }
  | { type: 'player:setPronto'; payload: { pronto: boolean } }
  | { type: 'player:leave'; payload: Record<string, never> }
  | { type: 'player:setSpectator'; payload: { spectator: boolean } }
  | { type: 'chat:send'; payload: { text: string } }
  | { type: 'host:silenciar'; payload: { playerId: PlayerId; silenciado: boolean } }
  | { type: 'host:kick'; payload: { playerId: PlayerId } }
  | { type: 'host:addBot'; payload: { difficulty: BotDifficulty } }
  | { type: 'host:removeBot'; payload: { playerId: PlayerId } }
  | { type: 'host:setOptions'; payload: { options: MatchOptions } }
  /** Reordena os assentos — é assim que se escolhe a dupla. */
  | { type: 'host:setOrdem'; payload: { ordem: PlayerId[] } }
  | { type: 'host:startMatch'; payload: Record<string, never> }
  | { type: 'host:endMatch'; payload: Record<string, never> }
  | { type: 'host:rematch'; payload: Record<string, never> }
  | { type: 'host:toLobby'; payload: Record<string, never> }
  | { type: 'host:resolveAbsence'; payload: { action: 'BOT_ASSUME' | 'ENCERRAR' } }
  | { type: 'move:play'; payload: { matchId: string; mao: number; tileId: TileId; endId: string | null } };

export type CommandType = Command['type'];

// ---------------------------------------------------------------------------
// Eventos: servidor → cliente
// ---------------------------------------------------------------------------

export type ServerEvent =
  /** Retrato completo, projetado para quem recebe. Inclui o chat no `snapshot`. */
  | { type: 'room:snapshot'; payload: RoomView & { chat: ChatMessage[] } }
  /** Retrato depois de uma mudança. Sem o chat, que chega por `chat:message`. */
  | { type: 'room:state'; payload: RoomView }
  | { type: 'chat:message'; payload: { message: ChatMessage } }
  | { type: 'system:notice'; payload: { code: string; params?: Record<string, unknown> } }
  | { type: 'ack'; payload: { commandId: string } }
  | { type: 'error'; payload: ErrorPayload };

export type ServerEventType = ServerEvent['type'];

export interface ServerEnvelope<T = unknown> extends Envelope<T> {
  stateVersion: number;
}

export const ERROR_CODES = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  INVALID_TOKEN: 'INVALID_TOKEN',
  NOT_HOST: 'NOT_HOST',
  WRONG_STATUS: 'WRONG_STATUS',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  ILLEGAL_MOVE: 'ILLEGAL_MOVE',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  FORBIDDEN_CARD: 'FORBIDDEN_CARD',
  SESSION_TAKEN: 'SESSION_TAKEN',
  STALE_MOVE: 'STALE_MOVE',
  MATCH_PAUSED: 'MATCH_PAUSED',
  DECISION_LOCKED: 'DECISION_LOCKED',
  PROTOCOL_VERSION: 'PROTOCOL_VERSION',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorPayload {
  commandId?: string;
  code: ErrorCode;
  params?: Record<string, unknown>;
}

/**
 * Fechamentos do WebSocket. Dizem ao cliente se deve insistir: um deploy pede
 * reconexão imediata; um token inválido pede recomeçar.
 */
export const CLOSE_CODES = {
  SERVER_RESTART: 4001,
  INVALID_TOKEN: 4003,
  ROOM_NOT_FOUND: 4004,
  SESSION_TAKEN: 4009,
} as const;

export type CloseCode = (typeof CLOSE_CODES)[keyof typeof CLOSE_CODES];

export function shouldReconnect(closeCode: number): boolean {
  return closeCode !== CLOSE_CODES.SESSION_TAKEN &&
    closeCode !== CLOSE_CODES.INVALID_TOKEN &&
    closeCode !== CLOSE_CODES.ROOM_NOT_FOUND;
}

// ---------------------------------------------------------------------------
// Limites
// ---------------------------------------------------------------------------

export const LIMITS = {
  commandsPerWindow: 20,
  commandWindowMs: 10_000,
  maxMessageBytes: 32 * 1024,
  maxPlayers: 4,
  minPlayers: 2,
  /** Uma mesa só de bots não é jogo, é demonstração. */
  maxBots: 3,
  maxSpectators: 6,
  /** Quanto um bot "pensa" antes de jogar: sem pausa, ninguém vê o que houve. */
  botThinkMs: 1_100,
  idempotencyWindowMs: 30_000,
  chatTextMax: 280,
  chatMinIntervalMs: 1_000,
  chatHistoryMax: 200,
  transportGraceMs: 10_000,
  reconnectGraceMs: 60_000,
  pauseMaxMs: 10 * 60_000,
  playTimeoutMs: 30_000,
  /** Fim da mão: tempo para ver as mãos reveladas e a contagem. */
  fimDaMaoMs: 6_000,
  roomMaxLifeMs: 4 * 60 * 60_000,
  lobbyIdleMs: 15 * 60_000,
} as const;

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;
export const ROOM_CODE_LENGTH = 5;
/** Sem `I`, `O`, `0`, `1`: confundem ao ditar por voz. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
