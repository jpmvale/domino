/**
 * O hub: as salas vivas na memória do processo e os sockets de cada uma.
 *
 * Um processo só, como no FDP: com todas as conexões de uma sala no mesmo
 * processo, o broadcast é um laço sobre um `Map`, e o laço de eventos do Node
 * dá atomicidade de mutação sem lock.
 *
 * A cada mudança de versão, cada socket recebe o retrato da sala projetado
 * para quem está do outro lado. É a única forma de estado sair daqui.
 */

import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { CLOSE_CODES, PROTOCOL_VERSION, type ErrorPayload, type ServerEvent } from '@domino/protocol';
import {
  nextDeadline,
  tick,
  viewFor,
  type Emission,
  type Room,
  type RoomCtx,
  type RoomResult,
} from '@domino/room';
import type { PlayerId } from '@domino/rules';
import type { Persistence } from './persistence.js';

export interface Hub {
  get(code: string): Room | undefined;
  adopt(room: Room): void;
  commit(result: RoomResult): void;
  attach(code: string, playerId: PlayerId, socket: WebSocket): void;
  detach(code: string, playerId: PlayerId, socket: WebSocket): void;
  socketOf(code: string, playerId: PlayerId): WebSocket | undefined;
  send(socket: WebSocket | undefined, event: ServerEvent, stateVersion: number): void;
  sendError(socket: WebSocket | undefined, payload: ErrorPayload, stateVersion: number): void;
  ctx(): RoomCtx;
  advance(now: number): void;
  closeAll(code: number): void;
  readonly roomCount: number;
}

export interface HubOptions {
  persistence: Persistence;
  now?: () => number;
  randomSeed: () => string;
  newId?: () => string;
}

export function createHub({ persistence, now = Date.now, randomSeed, newId = randomUUID }: HubOptions): Hub {
  const rooms = new Map<string, Room>();
  const sockets = new Map<string, Map<PlayerId, WebSocket>>();

  const send: Hub['send'] = (socket, event, stateVersion) => {
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, id: newId(), ts: now(), stateVersion, ...event }));
  };

  const deliver = (room: Room, emissions: Emission[], stateChanged: boolean): void => {
    const peers = sockets.get(room.code);
    if (!peers) return;

    if (stateChanged) {
      for (const [playerId, socket] of peers) {
        send(socket, { type: 'room:state', payload: viewFor(room, playerId) }, room.stateVersion);
      }
    }
    for (const emission of emissions) {
      if (emission.audience === 'ALL') {
        for (const socket of peers.values()) send(socket, emission.event, room.stateVersion);
      } else {
        send(peers.get(emission.audience.playerId), emission.event, room.stateVersion);
      }
    }

    // Quem saiu da sala (expulso, ou trocado por bot) não tem mais o que ver.
    for (const [playerId, socket] of peers) {
      const p = room.players.find((x) => x.id === playerId);
      const fora = !p || p.connection === 'REMOVIDO' || p.connection === 'SAIU' || p.expulsoEm !== null;
      if (fora) {
        send(socket, { type: 'error', payload: { code: 'INVALID_TOKEN', params: { motivo: 'FORA_DA_SALA' } } }, room.stateVersion);
        socket.close(CLOSE_CODES.INVALID_TOKEN, 'fora da sala');
        peers.delete(playerId);
      }
    }
  };

  const retire = (code: string): void => {
    const peers = sockets.get(code);
    for (const socket of peers?.values() ?? []) socket.close(CLOSE_CODES.ROOM_NOT_FOUND, 'sala encerrada');
    rooms.delete(code);
    sockets.delete(code);
    persistence.forget(code);
  };

  const settle = (room: Room, emissions: Emission[]): void => {
    const before = rooms.get(room.code);
    rooms.set(room.code, room);
    deliver(room, emissions, before?.stateVersion !== room.stateVersion);
    if (room.status === 'ENCERRADA') retire(room.code);
    else persistence.schedule(room);
  };

  return {
    get: (code) => rooms.get(code),

    adopt(room) {
      rooms.set(room.code, room);
      if (!sockets.has(room.code)) sockets.set(room.code, new Map());
      persistence.schedule(room);
    },

    commit(result) {
      if (!result.ok) return;
      settle(result.room, result.emissions);
    },

    attach(code, playerId, socket) {
      const peers = sockets.get(code) ?? new Map<PlayerId, WebSocket>();
      peers.set(playerId, socket);
      sockets.set(code, peers);
    },

    detach(code, playerId, socket) {
      if (sockets.get(code)?.get(playerId) === socket) sockets.get(code)?.delete(playerId);
    },

    socketOf: (code, playerId) => sockets.get(code)?.get(playerId),

    send,

    sendError(socket, payload, stateVersion) {
      send(socket, { type: 'error', payload }, stateVersion);
    },

    ctx: () => ({ now: now(), randomSeed, newId }),

    advance(at) {
      for (const [code, room] of [...rooms]) {
        const deadline = nextDeadline(room);
        if (deadline !== null && at < deadline) continue;
        const result = tick(room, { now: at, randomSeed, newId });
        if (!result.changed) continue;
        if (rooms.get(code) !== room) continue;
        settle(result.room, result.emissions);
      }
    },

    closeAll(code) {
      for (const peers of sockets.values()) {
        for (const socket of peers.values()) {
          if (socket.readyState === socket.OPEN) socket.close(code, 'reconecte');
        }
      }
    },

    get roomCount() {
      return rooms.size;
    },
  };
}

export { CLOSE_CODES };
