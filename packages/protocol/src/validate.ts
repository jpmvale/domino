/**
 * Validação de runtime na fronteira.
 *
 * Entrada de cliente é tratada como hostil: nada chega à lógica de jogo sem
 * passar por aqui. Módulo só do servidor — puxa o zod e nunca entra no bundle
 * do cliente, que usa só os tipos de `@domino/protocol`.
 */

import { z } from 'zod';
import { METAS } from '@domino/rules';
import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  BOT_DIFFICULTIES,
  LIMITS,
  NICKNAME_MAX,
  NICKNAME_MIN,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from './index.js';

/** Caracteres de controle e separadores de linha não passam. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

export const nicknameSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length >= NICKNAME_MIN && value.length <= NICKNAME_MAX, {
    message: `apelido precisa ter de ${NICKNAME_MIN} a ${NICKNAME_MAX} caracteres`,
  })
  .refine((value) => !CONTROL_CHARS.test(value), {
    message: 'apelido não pode conter caracteres de controle',
  });

export const avatarSchema = z.object({
  emoji: z.enum(AVATAR_EMOJIS),
  color: z.enum(AVATAR_COLORS),
}).strict();

/** Minúsculas, espaços e hífens são erro de digitação, não motivo de recusa. */
export const roomCodeSchema = z
  .string()
  .transform((value) => value.trim().toUpperCase().replace(/[\s-]/g, ''))
  .refine((value) => value.length === ROOM_CODE_LENGTH, {
    message: `código precisa ter ${ROOM_CODE_LENGTH} caracteres`,
  })
  .refine((value) => [...value].every((char) => ROOM_CODE_ALPHABET.includes(char)), {
    message: 'código contém caracteres inválidos',
  });

/** A meta precisa ser uma das oferecidas para o modo escolhido. */
export const matchOptionsSchema = z.object({
  modo: z.enum(['BATIDA', 'MULTIPLO_DE_5']),
  duplas: z.boolean(),
  carrocasAbrem: z.boolean(),
  meta: z.int().positive(),
}).strict().refine((o) => METAS[o.modo].includes(o.meta), {
  message: 'meta fora das opções do modo',
});

const empty = z.object({}).strict();
const playerIdSchema = z.string().min(1).max(64);

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('room:resync'), payload: empty }),
  z.object({
    type: z.literal('player:setProfile'),
    payload: z.object({ nickname: nicknameSchema, avatar: avatarSchema }).strict(),
  }),
  z.object({
    type: z.literal('player:background'),
    payload: z.object({ emSegundoPlano: z.boolean() }).strict(),
  }),
  z.object({
    type: z.literal('player:setPronto'),
    payload: z.object({ pronto: z.boolean() }).strict(),
  }),
  z.object({ type: z.literal('player:leave'), payload: empty }),
  z.object({
    type: z.literal('player:setSpectator'),
    payload: z.object({ spectator: z.boolean() }).strict(),
  }),
  z.object({
    type: z.literal('chat:send'),
    // O teto é sobre o texto CRU; o aparo e o piso de 1 caractere ficam na sala.
    payload: z.object({ text: z.string().min(1).max(LIMITS.chatTextMax * 2) }).strict(),
  }),
  z.object({
    type: z.literal('host:silenciar'),
    payload: z.object({ playerId: playerIdSchema, silenciado: z.boolean() }).strict(),
  }),
  z.object({
    type: z.literal('host:kick'),
    payload: z.object({ playerId: playerIdSchema }).strict(),
  }),
  z.object({
    type: z.literal('host:addBot'),
    payload: z.object({ difficulty: z.enum(BOT_DIFFICULTIES) }).strict(),
  }),
  z.object({
    type: z.literal('host:removeBot'),
    payload: z.object({ playerId: playerIdSchema }).strict(),
  }),
  z.object({
    type: z.literal('host:setOptions'),
    payload: z.object({ options: matchOptionsSchema }).strict(),
  }),
  z.object({
    type: z.literal('host:setOrdem'),
    payload: z.object({ ordem: z.array(playerIdSchema).max(LIMITS.maxPlayers) }).strict(),
  }),
  z.object({ type: z.literal('host:startMatch'), payload: empty }),
  z.object({ type: z.literal('host:endMatch'), payload: empty }),
  z.object({ type: z.literal('host:rematch'), payload: empty }),
  z.object({ type: z.literal('host:toLobby'), payload: empty }),
  z.object({
    type: z.literal('host:resolveAbsence'),
    payload: z.object({ action: z.enum(['BOT_ASSUME', 'ENCERRAR']) }).strict(),
  }),
  z.object({
    type: z.literal('move:play'),
    payload: z.object({
      matchId: z.string().min(1).max(64),
      mao: z.int().positive(),
      tileId: z.string().regex(/^[0-6]-[0-6]$/),
      endId: z.string().regex(/^\d{1,2}[EDCLR]$/).nullable(),
    }).strict(),
  }),
]);

export const envelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(64),
  ts: z.number().finite(),
  payload: z.unknown(),
});

export type ParsedCommand = z.infer<typeof commandSchema>;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'PROTOCOL_VERSION' | 'VALIDATION_FAILED'; issues: string[] };

/**
 * Ponto único de entrada de mensagem do cliente. Versão incompatível é
 * separada de payload inválido: a primeira pede "recarregue a página".
 */
export function parseClientMessage(raw: unknown): ParseResult<{
  envelope: z.infer<typeof envelopeSchema>;
  command: ParsedCommand;
}> {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    const wrongVersion =
      typeof raw === 'object' && raw !== null && 'v' in raw &&
      (raw as { v: unknown }).v !== PROTOCOL_VERSION;
    return wrongVersion
      ? { ok: false, code: 'PROTOCOL_VERSION', issues: ['versão de protocolo incompatível'] }
      : { ok: false, code: 'VALIDATION_FAILED', issues: issuesOf(envelope.error) };
  }

  const command = commandSchema.safeParse({ type: envelope.data.type, payload: envelope.data.payload });
  if (!command.success) {
    return { ok: false, code: 'VALIDATION_FAILED', issues: issuesOf(command.error) };
  }
  return { ok: true, value: { envelope: envelope.data, command: command.data } };
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
  );
}

/** Mensagem maior que o teto é descartada antes de qualquer parse. */
export function isWithinSizeLimit(raw: string): boolean {
  return Buffer.byteLength(raw, 'utf8') <= LIMITS.maxMessageBytes;
}
