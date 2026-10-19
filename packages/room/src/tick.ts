/**
 * O relógio da sala: carência de conexão, pausa, vez estourada, bots, fim da
 * mão e expiração. Chamado pelo servidor a cada poucos milissegundos, só quando
 * algum prazo venceu (`nextDeadline`).
 */

import { LIMITS } from '@domino/protocol';
import { advance, applyMove, autoMove, createRng, project, type Move } from '@domino/rules';
import { decidirJogada } from '@domino/bot';
import { garantirHost } from './anfitriao.js';
import { absentMatchPlayers, deadlineFor, pauseMatch, sealMatchEnd } from './room.js';
import {
  isAbsent,
  isOnline,
  isPresent,
  type Emission,
  type Room,
  type RoomCtx,
} from './types.js';

export interface TickResult {
  room: Room;
  emissions: Emission[];
  changed: boolean;
}

const notice = (code: string, params?: Record<string, unknown>): Emission => ({
  audience: 'ALL',
  event: { type: 'system:notice', payload: params ? { code, params } : { code } },
});

/** O próximo instante em que algo pode mudar sozinho. */
export function nextDeadline(room: Room): number | null {
  const candidates: number[] = [];
  for (const p of room.players) {
    if (p.connection === 'RECONECTANDO' && p.socketLostAt !== null) {
      candidates.push(p.socketLostAt + LIMITS.transportGraceMs);
    }
  }
  if (room.pause) {
    if (!room.pause.decisionAnnounced) candidates.push(room.pause.decisionUnlockedAt);
    candidates.push(room.pause.hardDeadline);
  }
  if (room.phaseDeadline !== null && room.status === 'EM_PARTIDA') candidates.push(room.phaseDeadline);
  candidates.push(room.createdAt + LIMITS.roomMaxLifeMs);
  if (!room.players.some((p) => isPresent(p) && isOnline(p) && p.bot === null)) {
    candidates.push(room.lastActivityAt + LIMITS.lobbyIdleMs);
  }
  return Math.min(...candidates);
}

export function tick(room: Room, ctx: RoomCtx): TickResult {
  let current = room;
  const emissions: Emission[] = [];
  let changed = false;

  const step = (result: { room: Room; emissions: Emission[] }): void => {
    if (result.room !== current || result.emissions.length > 0) changed = true;
    current = result.room;
    emissions.push(...result.emissions);
  };

  step(expireTransportGrace(current, ctx));
  step(advancePause(current, ctx));
  step(advanceMatchClock(current, ctx));
  step(expireRoom(current, ctx));

  const sealed = sealMatchEnd(current);
  if (sealed !== current) {
    current = sealed;
    changed = true;
  }

  return {
    room: changed ? { ...current, stateVersion: current.stateVersion + 1 } : current,
    emissions,
    changed,
  };
}

/** A carência acabou: quem não voltou está ausente, e a partida pausa. */
function expireTransportGrace(room: Room, ctx: RoomCtx): { room: Room; emissions: Emission[] } {
  let players = room.players;
  let any = false;
  for (const p of room.players) {
    if (p.connection !== 'RECONECTANDO' || p.socketLostAt === null) continue;
    if (ctx.now < p.socketLostAt + LIMITS.transportGraceMs) continue;
    any = true;
    players = players.map((x) => (x.id === p.id ? { ...x, connection: 'DESCONECTADO' as const } : x));
  }
  if (!any) return { room, emissions: [] };

  const emissions: Emission[] = [];
  let next: Room = { ...room, players };
  if (next.status === 'EM_PARTIDA' && absentMatchPlayers(next).length > 0) next = pauseMatch(next, ctx);
  next = garantirHost(next, emissions);
  return { room: next, emissions };
}

function advancePause(room: Room, ctx: RoomCtx): { room: Room; emissions: Emission[] } {
  if (room.status !== 'PAUSADA' || !room.pause || !room.match) return { room, emissions: [] };

  // Teto da pausa: ninguém fica preso numa mesa parada.
  if (ctx.now >= room.pause.hardDeadline) {
    return {
      room: {
        ...room,
        status: 'FIM_DE_PARTIDA',
        pause: null,
        phaseDeadline: null,
        match: { ...room.match, endReason: 'ENCERRADA_POR_AUSENCIA', vencedores: [] },
      },
      emissions: [notice('PAUSA_ESGOTADA')],
    };
  }

  if (!room.pause.decisionAnnounced && ctx.now >= room.pause.decisionUnlockedAt) {
    return {
      room: { ...room, pause: { ...room.pause, decisionAnnounced: true } },
      emissions: [notice('DECISAO_LIBERADA')],
    };
  }
  return { room, emissions: [] };
}

function advanceMatchClock(room: Room, ctx: RoomCtx): { room: Room; emissions: Emission[] } {
  const m = room.match;
  if (room.status !== 'EM_PARTIDA' || !m || m.endReason !== null) return { room, emissions: [] };
  if (room.phaseDeadline === null || ctx.now < room.phaseDeadline) return { room, emissions: [] };

  // Fim da mão: distribui a próxima.
  if (m.mao.fase === 'FIM_DA_MAO') {
    const r = advance(m);
    if (!r.ok) return { room, emissions: [] };
    const next: Room = { ...room, match: r.state };
    return { room: { ...next, phaseDeadline: deadlineFor(next, ctx.now) }, emissions: [] };
  }

  const vez = m.mao.vez;
  if (vez === null) return { room, emissions: [] };
  const jogador = room.players.find((p) => p.id === vez);
  // Ausente: a pausa cuida. Não se joga por quem caiu.
  if (!jogador || isAbsent(jogador)) return { room, emissions: [] };

  let move: Move;
  const emissions: Emission[] = [];
  if (jogador.bot) {
    try {
      const d = decidirJogada(project(m, vez), vez, jogador.bot.difficulty, createRng(ctx.randomSeed()));
      move = { playerId: vez, mao: m.mao.numero, tileId: d.tileId, endId: d.endId };
    } catch {
      move = autoMove(m);
    }
  } else {
    // Gente conectada que estourou o tempo: o sistema joga por ela.
    move = autoMove(m);
    emissions.push(notice('JOGADA_AUTOMATICA', { playerId: vez }));
  }

  let r = applyMove(m, move);
  if (!r.ok) r = applyMove(m, autoMove(m));
  if (!r.ok) return { room, emissions: [] };

  const next: Room = { ...room, match: r.state };
  return { room: { ...next, phaseDeadline: deadlineFor(next, ctx.now) }, emissions };
}

function expireRoom(room: Room, ctx: RoomCtx): { room: Room; emissions: Emission[] } {
  if (room.status === 'ENCERRADA') return { room, emissions: [] };
  const tooOld = ctx.now >= room.createdAt + LIMITS.roomMaxLifeMs;
  const nobodyOnline = !room.players.some((p) => isPresent(p) && isOnline(p) && p.bot === null);
  const idle = nobodyOnline && ctx.now >= room.lastActivityAt + LIMITS.lobbyIdleMs;
  if (!tooOld && !idle) return { room, emissions: [] };
  return { room: { ...room, status: 'ENCERRADA', phaseDeadline: null, pause: null }, emissions: [] };
}
