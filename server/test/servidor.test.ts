/**
 * O servidor de ponta a ponta: HTTP real, WebSocket real, sala real.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as caminho } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serve } from '@hono/node-server';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type RoomView } from '@domino/protocol';
import { createMemoryStore } from '@domino/store';
import { createHub } from '../src/hub.js';
import { createHttpApp } from '../src/http.js';
import { createPersistence } from '../src/persistence.js';
import { createSigner } from '../src/session.js';
import { attachWebSocket } from '../src/ws.js';

const cliente = caminho(tmpdir(), `domino-teste-${process.pid}`);
mkdirSync(cliente, { recursive: true });
writeFileSync(caminho(cliente, 'index.html'),
  '<html><head><title>Dominó</title><meta property="og:title" content="Dominó"><meta property="og:description" content=""><meta name="description" content=""><meta property="og:image" content="/og.png"></head><body><script type="module" src="/x.js"></script></body></html>');

let base = '';
let fechar: () => void = () => {};

beforeAll(async () => {
  const hub = createHub({ persistence: createPersistence({ store: createMemoryStore() }), randomSeed: () => 'semente' });
  const signer = createSigner('x'.repeat(40));
  const app = createHttpApp({ hub, signer, clientPath: cliente });
  const server = serve({ fetch: app.fetch, port: 0 });
  await new Promise((r) => server.once('listening', r));
  const ws = attachWebSocket(server, { hub, signer });
  const relogio = setInterval(() => hub.advance(Date.now()), 50);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fechar = () => { clearInterval(relogio); ws.close(); server.close(); };
});

afterAll(() => fechar());

interface Sessao { roomCode: string; playerId: string; sessionToken: string; wsUrl: string }

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as T };
}

/** Um cliente de socket que guarda o último retrato e espera por condição. */
function conectar(s: Sessao) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/api/rooms/${s.roomCode}/ws?token=${encodeURIComponent(s.sessionToken)}`);
  let sala: RoomView | null = null;
  const mensagens: { type: string; payload: unknown }[] = [];
  const espera: (() => void)[] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString()) as { type: string; payload: unknown };
    mensagens.push(m);
    if (m.type === 'room:snapshot' || m.type === 'room:state') sala = m.payload as RoomView;
    for (const f of [...espera]) f();
  });
  let n = 0;
  return {
    ws,
    mensagens,
    get sala() { return sala; },
    enviar(type: string, payload: unknown = {}) {
      ws.send(JSON.stringify({ v: PROTOCOL_VERSION, id: `c${++n}`, type, ts: Date.now(), payload }));
    },
    ate(cond: () => boolean, ms = 4_000): Promise<void> {
      return new Promise((ok, falha) => {
        if (cond()) return ok();
        const t = setTimeout(() => falha(new Error('tempo esgotado esperando condição')), ms);
        const f = () => { if (cond()) { clearTimeout(t); espera.splice(espera.indexOf(f), 1); ok(); } };
        espera.push(f);
      });
    },
  };
}

describe('servidor', () => {
  it('cria sala, entra pelo convite e a mesa joga com bots', async () => {
    const criada = await post<Sessao>('/api/rooms', { nickname: 'Ana', avatar: { emoji: '🦊', color: 'amber' } });
    expect(criada.status).toBe(201);
    const ana = conectar(criada.body);
    await ana.ate(() => ana.sala !== null);

    const convidada = await post<Sessao>(`/api/rooms/${criada.body.roomCode.toLowerCase()}/join`, { nickname: 'Bia' });
    expect(convidada.status).toBe(200);
    const bia = conectar(convidada.body);
    await bia.ate(() => bia.sala !== null);
    await ana.ate(() => ana.sala!.players.length === 2);

    ana.enviar('host:addBot', { difficulty: 'FACIL' });
    ana.enviar('host:addBot', { difficulty: 'DIFICIL' });
    ana.enviar('player:setPronto', { pronto: true });
    bia.enviar('player:setPronto', { pronto: true });
    await ana.ate(() => ana.sala!.players.filter((p) => p.pronto).length === 4);
    ana.enviar('host:startMatch');
    await ana.ate(() => ana.sala!.status === 'EM_PARTIDA');
    await bia.ate(() => bia.sala!.status === 'EM_PARTIDA');

    // Cada uma vê a própria mão, e só ela.
    const maoAna = ana.sala!.match!.minhaMao;
    const maoBia = bia.sala!.match!.minhaMao;
    expect(maoAna).toHaveLength(7);
    expect(maoBia.some((t) => maoAna.includes(t))).toBe(false);

    // Joga quando for a vez, até a mesa andar algumas pedras.
    const jogarSeForMinhaVez = (c: ReturnType<typeof conectar>) => {
      const m = c.sala?.match;
      if (!m || m.jogadasLegais.length === 0) return;
      const j = m.jogadasLegais[0]!;
      c.enviar('move:play', { matchId: m.matchId, mao: m.maoNumero, tileId: j.tileId, endId: j.endId });
    };
    for (let i = 0; i < 40 && (ana.sala!.match!.mesa.length < 6); i++) {
      jogarSeForMinhaVez(ana);
      jogarSeForMinhaVez(bia);
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(ana.sala!.match!.mesa.length).toBeGreaterThanOrEqual(6);

    // O chat chega para as duas.
    bia.enviar('chat:send', { text: 'boa!' });
    await ana.ate(() => ana.mensagens.some((m) => m.type === 'chat:message'));

    ana.ws.close();
    bia.ws.close();
  }, 20_000);

  it('a segunda aba assume a sessão e a primeira é avisada', async () => {
    const criada = await post<Sessao>('/api/rooms', { nickname: 'Ana' });
    const a = conectar(criada.body);
    await a.ate(() => a.sala !== null);
    const b = conectar(criada.body);
    await b.ate(() => b.sala !== null);
    await a.ate(() => a.mensagens.some((m) => m.type === 'error' && (m.payload as { code: string }).code === 'SESSION_TAKEN'));
    b.ws.close();
  });

  it('token de outra sala não abre socket', async () => {
    const uma = await post<Sessao>('/api/rooms', { nickname: 'Ana' });
    const outra = await post<Sessao>('/api/rooms', { nickname: 'Bia' });
    const c = conectar({ ...outra.body, sessionToken: uma.body.sessionToken });
    await c.ate(() => c.mensagens.some((m) => m.type === 'error'));
    expect((c.mensagens[0]!.payload as { code: string }).code).toBe('INVALID_TOKEN');
  });

  it('o link de convite chega com cartão da mesa', async () => {
    const criada = await post<Sessao>('/api/rooms', { nickname: 'Ana' });
    const html = await (await fetch(`${base}/j/${criada.body.roomCode}`)).text();
    expect(html).toContain(`Mesa ${criada.body.roomCode}`);
    expect(html).toMatch(/<script type="module" nonce="[^"]+"/);
  });

  it('apelido inválido é recusado', async () => {
    const r = await post('/api/rooms', { nickname: 'x' });
    expect(r.status).toBe(422);
  });

  it('saúde responde a versão do protocolo', async () => {
    const r = await (await fetch(`${base}/api/health`)).json() as { protocolVersion: number };
    expect(r.protocolVersion).toBe(PROTOCOL_VERSION);
  });
});
