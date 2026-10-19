/**
 * Ciclo de vida da sala, conexão e comandos.
 *
 * Mesma arquitetura do FDP: toda mudança passa por `commit`, que sobe a versão;
 * o tempo entra por `ctx.now`; a regra de jogo é do motor.
 */

import { apelidoLivre, avatarLivre, conflitosDe } from './identidade.js';
import { garantirHost, passarHost } from './anfitriao.js';
import {
  LIMITS,
  NICKNAME_MAX,
  type BotDifficulty,
  type ChatMessage,
  type Command,
  type RoomView,
} from '@domino/protocol';
import {
  applyMove,
  createMatch,
  DEFAULT_OPTIONS,
  endMatch,
  project,
  type PlayerId,
} from '@domino/rules';
import {
  isAbsent,
  isOnline,
  isPresent,
  foiExpulso,
  toPublicPlayer,
  type Emission,
  type JoinParams,
  type Room,
  type RoomCtx,
  type RoomPlayer,
  type RoomResult,
} from './types.js';

type FailCode =
  | 'ROOM_FULL' | 'NOT_HOST' | 'WRONG_STATUS' | 'VALIDATION_FAILED'
  | 'MATCH_PAUSED' | 'DECISION_LOCKED';

const failWith = (code: FailCode, motivo: string): RoomResult => ({ ok: false, code, motivo });

const all = (event: Emission['event']): Emission => ({ audience: 'ALL', event });
const notice = (code: string, params?: Record<string, unknown>): Emission =>
  all({ type: 'system:notice', payload: params ? { code, params } : { code } });

/** Toda mudança de estado passa por aqui: `stateVersion` nunca é esquecido. */
export function commit(room: Room, ctx: RoomCtx, emissions: Emission[]): RoomResult {
  const sealed = sealMatchEnd(room);
  return {
    ok: true,
    room: { ...sealed, stateVersion: sealed.stateVersion + 1, lastActivityAt: ctx.now },
    emissions,
  };
}

/** O motor encerra a partida; é aqui que a sala vai junto para o fim. */
export function sealMatchEnd(room: Room): Room {
  if (room.status !== 'EM_PARTIDA' && room.status !== 'PAUSADA') return room;
  if (!room.match || room.match.endReason === null) return room;
  return { ...room, status: 'FIM_DE_PARTIDA', phaseDeadline: null, pause: null };
}

const replace = (players: RoomPlayer[], id: PlayerId, patch: Partial<RoomPlayer>): RoomPlayer[] =>
  players.map((p) => (p.id === id ? { ...p, ...patch } : p));

// ---------------------------------------------------------------------------
// Criação e entrada
// ---------------------------------------------------------------------------

export function createRoom(code: string, host: JoinParams, ctx: RoomCtx): Room {
  return {
    code,
    status: 'LOBBY',
    hostId: host.playerId,
    players: [newPlayer(host, ctx.now, false)],
    ordem: [host.playerId],
    options: { ...DEFAULT_OPTIONS },
    match: null,
    pause: null,
    stateVersion: 1,
    createdAt: ctx.now,
    lastActivityAt: ctx.now,
    phaseDeadline: null,
    chat: [],
  };
}

function newPlayer(params: JoinParams, now: number, isSpectator: boolean): RoomPlayer {
  return {
    id: params.playerId,
    nickname: params.nickname,
    avatar: params.avatar,
    connection: 'CONECTADO',
    isSpectator,
    joinedAt: now,
    lastSeenAt: now,
    socketLostAt: null,
    emSegundoPlano: false,
    pronto: false,
    silenciado: false,
    expulsoEm: null,
    lastChatAt: null,
    bot: null,
  };
}

const NOMES_DE_BOT = ['Bot Carroça', 'Bot Sena', 'Bot Quina', 'Bot Duque', 'Bot Terno'] as const;

function newBot(room: Room, difficulty: BotDifficulty, ctx: RoomCtx): RoomPlayer {
  const usados = new Set(room.players.filter(isPresent).map((p) => p.nickname));
  const nickname = apelidoLivre(room, NOMES_DE_BOT.find((n) => !usados.has(n)) ?? 'Bot');
  const existentes = new Set(room.players.map((p) => p.id));
  let id = ctx.newId();
  for (let n = 2; existentes.has(id); n++) id = `${ctx.newId()}-${n}`;
  return {
    ...newPlayer({ playerId: id, nickname, avatar: avatarLivre(room, undefined) }, ctx.now, false),
    // Bot nasce pronto: não tem o que confirmar.
    pronto: true,
    bot: { difficulty },
  };
}

export const seatedPlayers = (room: Room): RoomPlayer[] =>
  room.players.filter((p) => isPresent(p) && !p.isSpectator);

export const spectators = (room: Room): RoomPlayer[] =>
  room.players.filter((p) => isPresent(p) && p.isSpectator);

const botsOf = (room: Room): RoomPlayer[] => room.players.filter((p) => isPresent(p) && p.bot !== null);

/**
 * Os assentos na ordem escolhida. Quem senta e ainda não está na `ordem` vai
 * para o fim; quem saiu some. Derivado sempre, para a ordem nunca apontar para
 * um fantasma.
 */
export function ordemDosAssentos(room: Room): PlayerId[] {
  const sentados = seatedPlayers(room);
  const ids = new Set(sentados.map((p) => p.id));
  const ordem = room.ordem.filter((id) => ids.has(id));
  for (const p of [...sentados].sort((a, b) => a.joinedAt - b.joinedAt)) {
    if (!ordem.includes(p.id)) ordem.push(p.id);
  }
  return ordem;
}

const comOrdem = (room: Room): Room => ({ ...room, ordem: ordemDosAssentos(room) });

export function join(room: Room, params: JoinParams, ctx: RoomCtx): RoomResult {
  if (room.status === 'ENCERRADA') return failWith('WRONG_STATUS', 'SALA_ENCERRADA');

  const existing = room.players.find((p) => p.id === params.playerId);
  if (existing) return reconnect(room, params.playerId, ctx);

  // Mesa cheia ou partida em andamento: entra para assistir e joga na próxima.
  const emJogo = room.status !== 'LOBBY';
  const cheia = seatedPlayers(room).length >= LIMITS.maxPlayers;
  const asSpectator = emJogo || cheia;
  if (asSpectator && spectators(room).length >= LIMITS.maxSpectators) {
    return failWith('ROOM_FULL', 'SALA_LOTADA');
  }

  const player = newPlayer(
    { ...params, nickname: apelidoLivre(room, params.nickname), avatar: avatarLivre(room, params.avatar) },
    ctx.now,
    asSpectator,
  );
  return commit(comOrdem({ ...room, players: [...room.players, player] }), ctx, []);
}

// ---------------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------------

export function reconnect(room: Room, playerId: PlayerId, ctx: RoomCtx): RoomResult {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return failWith('VALIDATION_FAILED', 'JOGADOR_DESCONHECIDO');
  if (!isPresent(player)) return failWith('WRONG_STATUS', 'JOGADOR_SAIU');
  if (foiExpulso(player)) return failWith('WRONG_STATUS', 'EXPULSO');

  const players = replace(room.players, playerId, {
    connection: 'CONECTADO',
    socketLostAt: null,
    lastSeenAt: ctx.now,
    emSegundoPlano: false,
  });
  const emissions: Emission[] = [];
  let next = garantirHost({ ...room, players }, emissions);
  next = maybeResume(next, ctx);
  return commit(next, ctx, emissions);
}

/** Socket caiu. Ainda não é ausência: o `tick` decide depois da carência. */
export function disconnect(room: Room, playerId: PlayerId, ctx: RoomCtx): RoomResult {
  const player = room.players.find((p) => p.id === playerId);
  if (!player || !isPresent(player)) return failWith('VALIDATION_FAILED', 'JOGADOR_DESCONHECIDO');
  if (!isOnline(player)) return { ok: true, room, emissions: [] };
  const players = replace(room.players, playerId, {
    connection: 'RECONECTANDO',
    socketLostAt: ctx.now,
    lastSeenAt: ctx.now,
  });
  // Sem versão nova: para o resto da mesa, nada mudou ainda.
  return { ok: true, room: { ...room, players }, emissions: [] };
}

const emPartida = (room: Room): boolean => room.status === 'EM_PARTIDA' || room.status === 'PAUSADA';

const sentadoNaPartida = (room: Room, id: PlayerId): boolean =>
  room.match !== null && room.match.playerOrder.includes(id);

export function leave(room: Room, playerId: PlayerId, ctx: RoomCtx): RoomResult {
  const player = room.players.find((p) => p.id === playerId);
  if (!player || !isPresent(player)) return failWith('VALIDATION_FAILED', 'JOGADOR_DESCONHECIDO');

  const emissions: Emission[] = [];
  let next: Room;

  // Sair no meio da partida não desfaz a mão de ninguém: um bot assume o
  // assento, com as pedras e o placar, e o jogo segue.
  if (emPartida(room) && sentadoNaPartida(room, playerId) && player.bot === null) {
    const trocado = trocarPorBot(room, player, ctx);
    next = trocado.room;
    emissions.push(notice('BOT_ASSUMIU', { apelido: player.nickname, bot: trocado.assento.nickname, motivo: 'SAIU' }));
    // A pessoa sai; o assento fica com o bot, sob o mesmo id.
  } else {
    next = { ...room, players: replace(room.players, playerId, { connection: 'SAIU' }) };
  }

  next = garantirHost(comOrdem(next), emissions);
  next = maybeResume(next, ctx);
  next = refazerPrazoSeVezDe(next, playerId, ctx);
  return commit(next, ctx, emissions);
}

// ---------------------------------------------------------------------------
// Pausa
// ---------------------------------------------------------------------------

export function absentMatchPlayers(room: Room): PlayerId[] {
  if (!room.match) return [];
  return room.players
    .filter((p) => isAbsent(p) && sentadoNaPartida(room, p.id))
    .map((p) => p.id);
}

export function pauseMatch(room: Room, ctx: RoomCtx): Room {
  if (room.status !== 'EM_PARTIDA') return room;
  return {
    ...room,
    status: 'PAUSADA',
    phaseDeadline: null,
    pause: {
      since: ctx.now,
      decisionUnlockedAt: ctx.now + LIMITS.reconnectGraceMs,
      hardDeadline: ctx.now + LIMITS.pauseMaxMs,
      decisionAnnounced: false,
    },
  };
}

/** Retoma se ninguém mais está ausente. O prazo da vez reinicia do zero. */
export function maybeResume(room: Room, ctx: RoomCtx): Room {
  if (room.status !== 'PAUSADA' || !room.match) return room;
  if (absentMatchPlayers(room).length > 0) return room;
  const resumed: Room = { ...room, status: 'EM_PARTIDA', pause: null };
  return { ...resumed, phaseDeadline: deadlineFor(resumed, ctx.now) };
}

/** Prazo da fase corrente. */
export function deadlineFor(room: Room, now: number): number | null {
  const m = room.match;
  if (!m || m.endReason !== null) return null;
  if (m.mao.fase === 'FIM_DA_MAO') return now + LIMITS.fimDaMaoMs;
  const vez = m.mao.vez;
  if (vez === null) return null;
  const jogador = room.players.find((p) => p.id === vez);
  // Bot não esquece de jogar: o prazo dele é o tempo de "pensar".
  if (jogador?.bot) return now + LIMITS.botThinkMs;
  return now + LIMITS.playTimeoutMs;
}

/** O relógio só é refeito se a vez era de quem mudou — senão seria brinde. */
function refazerPrazoSeVezDe(room: Room, playerId: PlayerId, ctx: RoomCtx): Room {
  if (room.status === 'EM_PARTIDA' && room.match?.mao.vez === playerId) {
    return { ...room, phaseDeadline: deadlineFor(room, ctx.now) };
  }
  return room;
}

// ---------------------------------------------------------------------------
// Bot assumindo assento
// ---------------------------------------------------------------------------

/** O substituto joga no nível médio: termina a mão sem virar vantagem para ninguém. */
const DIFICULDADE_DO_SUBSTITUTO: BotDifficulty = 'MEDIO';

/**
 * Troca a PESSOA pelo bot no assento. O `playerId` continua o mesmo — é ele
 * que o motor usa para achar as pedras e a equipe.
 */
export function trocarPorBot(
  room: Room,
  alvo: RoomPlayer,
  ctx: RoomCtx,
): { room: Room; assento: RoomPlayer } {
  const cabe = `Bot (${alvo.nickname})`;
  const nickname = apelidoLivre(
    room,
    cabe.length <= NICKNAME_MAX ? cabe : `Bot (${alvo.nickname.slice(0, NICKNAME_MAX - 6)})`,
    alvo.id,
  );
  const assento: RoomPlayer = {
    ...alvo,
    nickname,
    bot: { difficulty: DIFICULDADE_DO_SUBSTITUTO },
    // Marca o token da pessoa como inválido para este assento.
    expulsoEm: ctx.now,
    connection: 'CONECTADO',
    socketLostAt: null,
    emSegundoPlano: false,
    pronto: true,
    silenciado: false,
  };
  return { room: { ...room, players: replace(room.players, alvo.id, assento) }, assento };
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

export function applyCommand(room: Room, playerId: PlayerId, command: Command, ctx: RoomCtx): RoomResult {
  const player = room.players.find((p) => p.id === playerId);
  if (!player || !isPresent(player)) return failWith('VALIDATION_FAILED', 'JOGADOR_DESCONHECIDO');
  if (command.type.startsWith('host:') && room.hostId !== playerId) {
    return failWith('NOT_HOST', 'COMANDO_EXIGE_HOST');
  }

  switch (command.type) {
    case 'room:resync':
      return { ok: true, room, emissions: [] };

    case 'player:leave':
      return leave(room, playerId, ctx);

    case 'player:background': {
      if (player.emSegundoPlano === command.payload.emSegundoPlano) return { ok: true, room, emissions: [] };
      const players = replace(room.players, playerId, {
        emSegundoPlano: command.payload.emSegundoPlano,
        lastSeenAt: ctx.now,
      });
      return commit(maybeResume({ ...room, players }, ctx), ctx, []);
    }

    case 'player:setPronto': {
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      if (player.isSpectator) return failWith('VALIDATION_FAILED', 'ESPECTADOR_NAO_JOGA');
      if (player.pronto === command.payload.pronto) return { ok: true, room, emissions: [] };
      return commit({ ...room, players: replace(room.players, playerId, { pronto: command.payload.pronto }) }, ctx, []);
    }

    case 'player:setProfile': {
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      const conflito = conflitosDe(room, playerId, command.payload.nickname, command.payload.avatar);
      if (conflito.apelido) return failWith('VALIDATION_FAILED', 'APELIDO_TOMADO');
      if (conflito.emoji) return failWith('VALIDATION_FAILED', 'EMOJI_TOMADO');
      if (conflito.cor) return failWith('VALIDATION_FAILED', 'COR_TOMADA');
      return commit({
        ...room,
        players: replace(room.players, playerId, { nickname: command.payload.nickname, avatar: command.payload.avatar }),
      }, ctx, []);
    }

    case 'player:setSpectator': {
      // Só no lobby: no meio da partida, sair da mesa é `player:leave`.
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      if (player.bot !== null) return failWith('VALIDATION_FAILED', 'BOT_NAO_ASSISTE');
      const quer = command.payload.spectator;
      if (quer === player.isSpectator) return { ok: true, room, emissions: [] };
      if (quer && spectators(room).length >= LIMITS.maxSpectators) return failWith('ROOM_FULL', 'ESPECTADORES_LOTADOS');
      if (!quer && seatedPlayers(room).length >= LIMITS.maxPlayers) return failWith('ROOM_FULL', 'MESA_CHEIA');
      const players = replace(room.players, playerId, { isSpectator: quer, pronto: false });
      const emissions: Emission[] = [];
      // O host que vai assistir passa a mesa: quem assiste não pode começar nada.
      const next = quer && room.hostId === playerId
        ? passarHost({ ...room, players }, playerId, emissions)
        : { ...room, players };
      return commit(comOrdem(next), ctx, emissions);
    }

    case 'chat:send': {
      if (room.status === 'ENCERRADA') return failWith('WRONG_STATUS', 'SALA_ENCERRADA');
      if (player.bot !== null) return failWith('VALIDATION_FAILED', 'BOT_NAO_FALA');
      // Recusado no servidor, não só escondido na tela.
      if (player.silenciado) return failWith('VALIDATION_FAILED', 'SILENCIADO');
      const texto = command.payload.text.trim();
      if (texto.length === 0 || texto.length > LIMITS.chatTextMax) {
        return failWith('VALIDATION_FAILED', 'MENSAGEM_INVALIDA');
      }
      if (player.lastChatAt !== null && ctx.now - player.lastChatAt < LIMITS.chatMinIntervalMs) {
        return failWith('VALIDATION_FAILED', 'RAPIDO_DEMAIS');
      }
      const mensagem: ChatMessage = {
        id: ctx.newId(),
        playerId,
        nickname: player.nickname,
        text: texto,
        at: ctx.now,
        spectator: player.isSpectator,
      };
      return commit({
        ...room,
        chat: [...room.chat, mensagem].slice(-LIMITS.chatHistoryMax),
        players: replace(room.players, playerId, { lastChatAt: ctx.now }),
      }, ctx, [all({ type: 'chat:message', payload: { message: mensagem } })]);
    }

    case 'host:silenciar': {
      const alvoId = command.payload.playerId;
      if (alvoId === playerId) return failWith('VALIDATION_FAILED', 'HOST_NAO_SE_SILENCIA');
      const alvo = room.players.find((p) => p.id === alvoId && isPresent(p));
      if (!alvo) return failWith('VALIDATION_FAILED', 'JOGADOR_DESCONHECIDO');
      if (alvo.bot !== null) return failWith('VALIDATION_FAILED', 'BOT_NAO_FALA');
      if (alvo.silenciado === command.payload.silenciado) return { ok: true, room, emissions: [] };
      return commit({ ...room, players: replace(room.players, alvoId, { silenciado: command.payload.silenciado }) }, ctx, []);
    }

    case 'host:kick': {
      const alvoId = command.payload.playerId;
      if (alvoId === playerId) return failWith('VALIDATION_FAILED', 'HOST_NAO_SE_EXPULSA');
      const alvo = room.players.find((p) => p.id === alvoId && isPresent(p));
      if (!alvo) return failWith('VALIDATION_FAILED', 'JOGADOR_DESCONHECIDO');
      if (alvo.bot !== null && !emPartida(room)) return failWith('VALIDATION_FAILED', 'USE_REMOVER_BOT');

      // Expulsar da partida não tira o assento: um bot assume e a mão segue.
      if (emPartida(room) && sentadoNaPartida(room, alvoId)) {
        if (alvo.bot !== null) return failWith('VALIDATION_FAILED', 'BOT_NAO_SAI_NA_PARTIDA');
        const trocado = trocarPorBot(room, alvo, ctx);
        const emissions: Emission[] = [
          notice('BOT_ASSUMIU', { apelido: alvo.nickname, bot: trocado.assento.nickname, motivo: 'EXPULSO' }),
        ];
        let next = maybeResume(trocado.room, ctx);
        next = refazerPrazoSeVezDe(next, alvoId, ctx);
        return commit(next, ctx, emissions);
      }

      const next = { ...room, players: replace(room.players, alvoId, { connection: 'REMOVIDO' as const, expulsoEm: ctx.now }) };
      return commit(comOrdem(next), ctx, [notice('EXPULSO', { apelido: alvo.nickname, playerId: alvoId })]);
    }

    case 'host:addBot': {
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      if (botsOf(room).length >= LIMITS.maxBots) return failWith('ROOM_FULL', 'BOTS_DEMAIS');
      if (seatedPlayers(room).length >= LIMITS.maxPlayers) return failWith('ROOM_FULL', 'MESA_CHEIA');
      const bot = newBot(room, command.payload.difficulty, ctx);
      return commit(comOrdem({ ...room, players: [...room.players, bot] }), ctx, []);
    }

    case 'host:removeBot': {
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      const alvo = room.players.find((p) => p.id === command.payload.playerId && isPresent(p));
      if (!alvo || alvo.bot === null) return failWith('VALIDATION_FAILED', 'NAO_E_BOT');
      return commit(comOrdem({ ...room, players: room.players.filter((p) => p.id !== alvo.id) }), ctx, []);
    }

    case 'host:setOptions': {
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      return commit({ ...room, options: command.payload.options }, ctx, []);
    }

    case 'host:setOrdem': {
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      const atual = ordemDosAssentos(room);
      const pedida = command.payload.ordem;
      // Tem de ser uma permutação exata de quem está sentado.
      if (pedida.length !== atual.length || !atual.every((id) => pedida.includes(id))) {
        return failWith('VALIDATION_FAILED', 'ORDEM_INVALIDA');
      }
      return commit({ ...room, ordem: [...pedida] }, ctx, []);
    }

    case 'host:startMatch':
      return startMatch(room, ctx);

    case 'host:endMatch': {
      if (!emPartida(room)) return failWith('WRONG_STATUS', 'SEM_PARTIDA');
      return finishMatch(room, ctx, 'ENCERRADA_PELO_HOST');
    }

    case 'host:rematch': {
      if (room.status !== 'FIM_DE_PARTIDA') return failWith('WRONG_STATUS', 'SEM_FIM_DE_PARTIDA');
      // Revanche com o mesmo grupo: preserva o pronto, não pede seis toques.
      const players = room.players.map((p) => (isPresent(p) ? { ...p, pronto: true } : p));
      return startMatch({ ...room, status: 'LOBBY', match: null, pause: null, phaseDeadline: null, players }, ctx);
    }

    case 'host:toLobby': {
      if (room.status !== 'FIM_DE_PARTIDA') return failWith('WRONG_STATUS', 'SEM_FIM_DE_PARTIDA');
      // Voltar para arrumar a mesa zera o pronto: a mesa vai mudar.
      const players = room.players.map((p) => (isPresent(p) && p.bot === null ? { ...p, pronto: false } : p));
      return commit(comOrdem({ ...room, status: 'LOBBY', match: null, pause: null, phaseDeadline: null, players }), ctx, []);
    }

    case 'host:resolveAbsence':
      return resolveAbsence(room, command.payload.action, ctx);

    case 'move:play':
      return applyGameMove(room, playerId, command.payload, ctx);

    default:
      return failWith('VALIDATION_FAILED', 'COMANDO_DESCONHECIDO');
  }
}

export function startMatch(room: Room, ctx: RoomCtx): RoomResult {
  if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
  const ordem = ordemDosAssentos(room);
  const sentados = seatedPlayers(room);
  if (ordem.length < LIMITS.minPlayers) return failWith('WRONG_STATUS', 'JOGADORES_INSUFICIENTES');
  if (!sentados.some((p) => p.bot === null)) return failWith('WRONG_STATUS', 'SO_BOTS_NA_MESA');
  if (sentados.some((p) => !p.pronto)) return failWith('WRONG_STATUS', 'FALTA_PRONTO');

  const match = createMatch({
    matchId: ctx.newId(),
    seed: ctx.randomSeed(),
    playerIds: ordem,
    options: room.options,
  });
  const started: Room = { ...room, ordem, status: 'EM_PARTIDA', match, pause: null };
  return commit({ ...started, phaseDeadline: deadlineFor(started, ctx.now) }, ctx, []);
}

function applyGameMove(
  room: Room,
  playerId: PlayerId,
  payload: Extract<Command, { type: 'move:play' }>['payload'],
  ctx: RoomCtx,
): RoomResult {
  if (room.status === 'PAUSADA') return failWith('MATCH_PAUSED', 'PARTIDA_PAUSADA');
  if (room.status !== 'EM_PARTIDA' || !room.match) return failWith('WRONG_STATUS', 'SEM_PARTIDA');
  if (payload.matchId !== room.match.id) return { ok: false, code: 'STALE_MOVE', motivo: 'PARTIDA_ANTIGA' };

  const result = applyMove(room.match, {
    playerId,
    mao: payload.mao,
    tileId: payload.tileId,
    endId: payload.endId,
  });
  if (!result.ok) return { ok: false, code: result.code, motivo: result.motivo };

  const next: Room = { ...room, match: result.state };
  return commit({ ...next, phaseDeadline: deadlineFor(next, ctx.now) }, ctx, []);
}

function resolveAbsence(room: Room, action: 'BOT_ASSUME' | 'ENCERRAR', ctx: RoomCtx): RoomResult {
  if (room.status !== 'PAUSADA' || !room.pause) return failWith('WRONG_STATUS', 'SEM_PAUSA');
  if (ctx.now < room.pause.decisionUnlockedAt) return failWith('DECISION_LOCKED', 'DECISAO_AINDA_BLOQUEADA');
  if (action === 'ENCERRAR') return finishMatch(room, ctx, 'ENCERRADA_POR_AUSENCIA');

  const ausentes = absentMatchPlayers(room);
  if (ausentes.length === 0) return failWith('WRONG_STATUS', 'NINGUEM_AUSENTE');
  let next = room;
  const emissions: Emission[] = [];
  for (const id of ausentes) {
    const alvo = next.players.find((p) => p.id === id)!;
    const trocado = trocarPorBot(next, alvo, ctx);
    next = trocado.room;
    emissions.push(notice('BOT_ASSUMIU', { apelido: alvo.nickname, bot: trocado.assento.nickname, motivo: 'AUSENTE' }));
  }
  next = garantirHost(next, emissions);
  next = maybeResume(next, ctx);
  return commit(next, ctx, emissions);
}

function finishMatch(room: Room, ctx: RoomCtx, reason: 'ENCERRADA_PELO_HOST' | 'ENCERRADA_POR_AUSENCIA'): RoomResult {
  const match = room.match ? endMatch(room.match, reason) : null;
  return commit({ ...room, status: 'FIM_DE_PARTIDA', match, pause: null, phaseDeadline: null }, ctx, []);
}

// ---------------------------------------------------------------------------
// Retrato
// ---------------------------------------------------------------------------

/** O que aquele jogador tem direito de ver. Sem o chat — ver `snapshotFor`. */
export function viewFor(room: Room, viewerId: PlayerId | null): RoomView {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    options: room.options,
    stateVersion: room.stateVersion,
    players: room.players.filter(isPresent).map(toPublicPlayer),
    ordem: room.match && room.status !== 'LOBBY' ? room.match.playerOrder : ordemDosAssentos(room),
    pause: room.pause
      ? {
          since: room.pause.since,
          absentPlayerIds: absentMatchPlayers(room),
          decisionUnlockedAt: room.pause.decisionUnlockedAt,
          hardDeadline: room.pause.hardDeadline,
        }
      : null,
    phaseDeadline: room.phaseDeadline,
    match: room.match ? project(room.match, viewerId) : null,
  };
}

export function snapshotFor(room: Room, viewerId: PlayerId | null): Emission['event'] {
  return { type: 'room:snapshot', payload: { ...viewFor(room, viewerId), chat: room.chat } };
}
