import { describe, expect, it } from 'vitest';
import { LIMITS, type Avatar, type Command } from '@domino/protocol';
import {
  applyCommand,
  createRoom,
  disconnect,
  join,
  nextDeadline,
  reconnect,
  tick,
  viewFor,
  type Room,
  type RoomCtx,
  type RoomResult,
} from '../src/index.js';

const AV: Avatar = { emoji: '🦊', color: 'amber' };

function ctxAt(now: number): RoomCtx {
  let n = 0;
  return { now, randomSeed: () => `seed-${now}-${++n}`, newId: () => `id-${now}-${++n}` };
}

function ok(r: RoomResult): Room {
  if (!r.ok) throw new Error(`${r.code}: ${r.motivo}`);
  return r.room;
}

const cmd = (room: Room, who: string, command: Command, now = 1_000) => applyCommand(room, who, command, ctxAt(now));

/** Sala com `n` pessoas, todas prontas, partida começada. */
function salaComPartida(n: number, modo: 'BATIDA' | 'MULTIPLO_DE_5' = 'BATIDA'): Room {
  let room = createRoom('ABCDE', { playerId: 'p1', nickname: 'Ana', avatar: AV }, ctxAt(0));
  for (let i = 2; i <= n; i++) room = ok(join(room, { playerId: `p${i}`, nickname: `J${i}`, avatar: AV }, ctxAt(i)));
  if (modo === 'MULTIPLO_DE_5') {
    room = ok(cmd(room, 'p1', { type: 'host:setOptions', payload: { options: { modo, duplas: true, carrocasAbrem: true, meta: 200 } } }));
  }
  for (let i = 1; i <= n; i++) room = ok(cmd(room, `p${i}`, { type: 'player:setPronto', payload: { pronto: true } }));
  return ok(cmd(room, 'p1', { type: 'host:startMatch', payload: {} }));
}

/** Avança o relógio até nada mais mudar sozinho, ou até o limite. */
function correrRelogio(room: Room, desde: number, ate: number): { room: Room; agora: number } {
  let agora = desde;
  let atual = room;
  for (let i = 0; i < 10_000 && agora < ate; i++) {
    const prazo = nextDeadline(atual);
    if (prazo === null || prazo > ate) break;
    agora = Math.max(agora, prazo);
    const r = tick(atual, ctxAt(agora));
    atual = r.room;
    if (atual.status === 'ENCERRADA' || atual.status === 'FIM_DE_PARTIDA') break;
  }
  return { room: atual, agora };
}

describe('lobby', () => {
  it('apelido e avatar repetidos ganham desempate na entrada', () => {
    let room = createRoom('ABCDE', { playerId: 'p1', nickname: 'Ana', avatar: AV }, ctxAt(0));
    room = ok(join(room, { playerId: 'p2', nickname: 'Ana', avatar: AV }, ctxAt(1)));
    const p2 = room.players.find((p) => p.id === 'p2')!;
    expect(p2.nickname).toBe('Ana 2');
    expect(p2.avatar.emoji).not.toBe(AV.emoji);
    expect(p2.avatar.color).not.toBe(AV.color);
  });

  it('o quinto entra assistindo', () => {
    let room = createRoom('ABCDE', { playerId: 'p1', nickname: 'Ana', avatar: AV }, ctxAt(0));
    for (let i = 2; i <= 5; i++) room = ok(join(room, { playerId: `p${i}`, nickname: `J${i}`, avatar: AV }, ctxAt(i)));
    expect(room.players.find((p) => p.id === 'p5')!.isSpectator).toBe(true);
  });

  it('só o host manda, e só começa com todo mundo pronto', () => {
    let room = createRoom('ABCDE', { playerId: 'p1', nickname: 'Ana', avatar: AV }, ctxAt(0));
    room = ok(join(room, { playerId: 'p2', nickname: 'Bia', avatar: AV }, ctxAt(1)));
    const naoHost = cmd(room, 'p2', { type: 'host:startMatch', payload: {} });
    expect(naoHost.ok).toBe(false);
    const semPronto = cmd(room, 'p1', { type: 'host:startMatch', payload: {} });
    expect(semPronto.ok).toBe(false);
    if (!semPronto.ok) expect(semPronto.motivo).toBe('FALTA_PRONTO');
  });

  it('a ordem dos assentos define as duplas', () => {
    let room = createRoom('ABCDE', { playerId: 'p1', nickname: 'Ana', avatar: AV }, ctxAt(0));
    for (let i = 2; i <= 4; i++) room = ok(join(room, { playerId: `p${i}`, nickname: `J${i}`, avatar: AV }, ctxAt(i)));
    room = ok(cmd(room, 'p1', { type: 'host:setOrdem', payload: { ordem: ['p1', 'p3', 'p2', 'p4'] } }));
    for (let i = 1; i <= 4; i++) room = ok(cmd(room, `p${i}`, { type: 'player:setPronto', payload: { pronto: true } }));
    room = ok(cmd(room, 'p1', { type: 'host:startMatch', payload: {} }));
    expect(room.match!.equipes).toEqual([['p1', 'p2'], ['p3', 'p4']]);
  });

  it('ordem que não é permutação de quem está sentado é recusada', () => {
    let room = createRoom('ABCDE', { playerId: 'p1', nickname: 'Ana', avatar: AV }, ctxAt(0));
    room = ok(join(room, { playerId: 'p2', nickname: 'Bia', avatar: AV }, ctxAt(1)));
    expect(cmd(room, 'p1', { type: 'host:setOrdem', payload: { ordem: ['p1', 'intruso'] } }).ok).toBe(false);
  });

  it('bots completam a mesa e nascem prontos', () => {
    let room = createRoom('ABCDE', { playerId: 'p1', nickname: 'Ana', avatar: AV }, ctxAt(0));
    for (let i = 0; i < 3; i++) room = ok(cmd(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }));
    expect(cmd(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }).ok).toBe(false);
    room = ok(cmd(room, 'p1', { type: 'player:setPronto', payload: { pronto: true } }));
    room = ok(cmd(room, 'p1', { type: 'host:startMatch', payload: {} }));
    expect(room.status).toBe('EM_PARTIDA');
  });
});

describe('chat', () => {
  it('apara, limita o tamanho, o ritmo e respeita o silêncio', () => {
    let room = createRoom('ABCDE', { playerId: 'p1', nickname: 'Ana', avatar: AV }, ctxAt(0));
    room = ok(join(room, { playerId: 'p2', nickname: 'Bia', avatar: AV }, ctxAt(1)));
    room = ok(cmd(room, 'p2', { type: 'chat:send', payload: { text: '  oi  ' } }, 1_000));
    expect(room.chat.at(-1)!.text).toBe('oi');
    expect(cmd(room, 'p2', { type: 'chat:send', payload: { text: 'de novo' } }, 1_500).ok).toBe(false);
    expect(cmd(room, 'p2', { type: 'chat:send', payload: { text: 'x'.repeat(LIMITS.chatTextMax + 1) } }, 5_000).ok).toBe(false);
    room = ok(cmd(room, 'p1', { type: 'host:silenciar', payload: { playerId: 'p2', silenciado: true } }));
    expect(cmd(room, 'p2', { type: 'chat:send', payload: { text: 'oi' } }, 9_000).ok).toBe(false);
  });
});

describe('partida', () => {
  it('a mão alheia não aparece no retrato de ninguém', () => {
    const room = salaComPartida(4);
    const m = room.match!;
    for (const viewer of m.playerOrder) {
      const visto = JSON.stringify(viewFor(room, viewer));
      for (const outro of m.playerOrder.filter((id) => id !== viewer)) {
        for (const t of m.mao.maos[outro]!) {
          if (t === m.mao.pedraObrigatoria) continue;
          expect(visto).not.toContain(`"${t}"`);
        }
      }
    }
  });

  it('jogada fora da vez é recusada', () => {
    const room = salaComPartida(2);
    const m = room.match!;
    const fora = m.playerOrder.find((id) => id !== m.mao.vez)!;
    const r = cmd(room, fora, {
      type: 'move:play',
      payload: { matchId: m.id, mao: 1, tileId: m.mao.maos[fora]![0]!, endId: null },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_YOUR_TURN');
  });

  it('o relógio joga por quem demora, e a partida termina sozinha', () => {
    const room = salaComPartida(4, 'MULTIPLO_DE_5');
    const { room: fim } = correrRelogio(room, 1_000, 1_000 + 3 * 60 * 60_000);
    expect(fim.status).toBe('FIM_DE_PARTIDA');
    expect(fim.match!.endReason).toBe('META');
  });

  it('queda pausa a partida, a volta retoma', () => {
    let room = salaComPartida(2);
    room = ok(disconnect(room, 'p2', ctxAt(2_000)));
    // Ainda na carência: nada muda para os outros.
    expect(room.status).toBe('EM_PARTIDA');
    room = tick(room, ctxAt(2_000 + LIMITS.transportGraceMs)).room;
    expect(room.status).toBe('PAUSADA');
    expect(room.phaseDeadline).toBeNull();
    room = ok(reconnect(room, 'p2', ctxAt(20_000)));
    expect(room.status).toBe('EM_PARTIDA');
    expect(room.phaseDeadline).not.toBeNull();
  });

  it('o host decide que um bot assume quem sumiu, depois da carência', () => {
    let room = salaComPartida(2);
    room = ok(disconnect(room, 'p2', ctxAt(2_000)));
    room = tick(room, ctxAt(2_000 + LIMITS.transportGraceMs)).room;
    const cedo = cmd(room, 'p1', { type: 'host:resolveAbsence', payload: { action: 'BOT_ASSUME' } }, 15_000);
    expect(cedo.ok).toBe(false);
    room = ok(cmd(room, 'p1', { type: 'host:resolveAbsence', payload: { action: 'BOT_ASSUME' } }, 2_000 + LIMITS.transportGraceMs + LIMITS.reconnectGraceMs));
    expect(room.status).toBe('EM_PARTIDA');
    expect(room.players.find((p) => p.id === 'p2')!.bot).not.toBeNull();
  });

  it('a pausa tem teto: ninguém fica preso', () => {
    let room = salaComPartida(2);
    room = ok(disconnect(room, 'p2', ctxAt(2_000)));
    const { room: fim } = correrRelogio(room, 2_000, 2_000 + LIMITS.transportGraceMs + LIMITS.pauseMaxMs + 1_000);
    expect(fim.status).toBe('FIM_DE_PARTIDA');
    expect(fim.match!.endReason).toBe('ENCERRADA_POR_AUSENCIA');
  });

  it('sair no meio deixa um bot no assento, e a mão segue', () => {
    let room = salaComPartida(3);
    room = ok(cmd(room, 'p3', { type: 'player:leave', payload: {} }));
    const assento = room.players.find((p) => p.id === 'p3')!;
    expect(assento.bot).not.toBeNull();
    expect(room.match!.playerOrder).toContain('p3');
    expect(reconnect(room, 'p3', ctxAt(9_000)).ok).toBe(false);
  });

  it('expulsar no meio também passa o assento para um bot', () => {
    let room = salaComPartida(3);
    room = ok(cmd(room, 'p1', { type: 'host:kick', payload: { playerId: 'p2' } }));
    expect(room.players.find((p) => p.id === 'p2')!.bot).not.toBeNull();
  });

  it('revanche começa outra partida com a mesma mesa; voltar ao lobby zera o pronto', () => {
    let room = salaComPartida(2);
    room = ok(cmd(room, 'p1', { type: 'host:endMatch', payload: {} }));
    expect(room.status).toBe('FIM_DE_PARTIDA');
    const revanche = ok(cmd(room, 'p1', { type: 'host:rematch', payload: {} }, 2_000));
    expect(revanche.status).toBe('EM_PARTIDA');
    expect(revanche.match!.id).not.toBe(room.match!.id);
    const lobby = ok(cmd(room, 'p1', { type: 'host:toLobby', payload: {} }));
    expect(lobby.status).toBe('LOBBY');
    expect(lobby.players.every((p) => !p.pronto)).toBe(true);
  });

  it('quem chega no meio assiste e não vê mão de ninguém', () => {
    let room = salaComPartida(2);
    room = ok(join(room, { playerId: 'v', nickname: 'Vera', avatar: AV }, ctxAt(5_000)));
    expect(room.players.find((p) => p.id === 'v')!.isSpectator).toBe(true);
    expect(viewFor(room, 'v').match!.minhaMao).toEqual([]);
  });
});

describe('sala', () => {
  it('sala sem ninguém morre depois do ócio', () => {
    let room = createRoom('ABCDE', { playerId: 'p1', nickname: 'Ana', avatar: AV }, ctxAt(0));
    room = ok(disconnect(room, 'p1', ctxAt(1)));
    const { room: fim } = correrRelogio(room, 1, LIMITS.lobbyIdleMs + LIMITS.transportGraceMs + 10);
    expect(fim.status).toBe('ENCERRADA');
  });

  it('o host que sai passa a mesa para uma pessoa, nunca para bot', () => {
    let room = createRoom('ABCDE', { playerId: 'p1', nickname: 'Ana', avatar: AV }, ctxAt(0));
    room = ok(cmd(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'FACIL' } }));
    room = ok(join(room, { playerId: 'p2', nickname: 'Bia', avatar: AV }, ctxAt(5)));
    room = ok(cmd(room, 'p1', { type: 'player:leave', payload: {} }));
    expect(room.hostId).toBe('p2');
  });
});
