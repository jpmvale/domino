/**
 * HTTP: criar sala, entrar, retomar sessão, saúde e o cliente.
 *
 * O cliente é servido pelo mesmo processo, de `app/build/`. Em `/j/{código}`
 * o HTML ganha título e descrição da mesa, para o link de convite chegar no
 * WhatsApp como um cartão e não como uma URL crua.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, join as caminhoDe } from 'node:path';
import { Hono } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  LIMITS,
  PROTOCOL_VERSION,
  type Avatar,
  type ErrorCode,
} from '@domino/protocol';
import { avatarSchema, nicknameSchema, roomCodeSchema } from '@domino/protocol/validate';
import {
  createRoom,
  foiExpulso,
  generateFreeCode,
  isPresent,
  join,
  seatedPlayers,
  spectators,
} from '@domino/room';
import type { Hub } from './hub.js';
import { createRateLimiter } from './limits.js';
import type { SessionSigner } from './session.js';

export interface HttpOptions {
  hub: Hub;
  signer: SessionSigner;
  clientPath: string;
  now?: () => number;
  allowedOrigin?: string | undefined;
  trustProxy?: boolean;
  version?: string;
  limiteDeSalasPorHora?: number;
}

const PADRAO: Avatar = { emoji: AVATAR_EMOJIS[0]!, color: AVATAR_COLORS[0]! };

function parseIdentity(body: unknown): { ok: true; nickname: string; avatar: Avatar } | { ok: false } {
  const raw = (body ?? {}) as { nickname?: unknown; avatar?: unknown };
  const nickname = nicknameSchema.safeParse(raw.nickname);
  if (!nickname.success) return { ok: false };
  if (raw.avatar === undefined) return { ok: true, nickname: nickname.data, avatar: PADRAO };
  const avatar = avatarSchema.safeParse(raw.avatar);
  if (!avatar.success) return { ok: false };
  return { ok: true, nickname: nickname.data, avatar: avatar.data };
}

export function createHttpApp(options: HttpOptions): Hono<{ Bindings: HttpBindings }> {
  const { hub, signer, clientPath } = options;
  const now = options.now ?? Date.now;
  const version = options.version ?? 'dev';

  const createLimit = createRateLimiter({ limit: options.limiteDeSalasPorHora ?? 20, windowMs: 60 * 60_000 });
  const joinLimit = createRateLimiter({ limit: 60, windowMs: 60 * 60_000 });

  const app = new Hono<{ Bindings: HttpBindings }>();

  const clientIp = (c: { env: HttpBindings; req: { header(name: string): string | undefined } }): string => {
    if (options.trustProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (forwarded) return forwarded;
    }
    return c.env.incoming.socket.remoteAddress ?? 'desconhecido';
  };

  const origemPublica = (c: { req: { header(name: string): string | undefined } }): string => {
    const host = c.req.header('host') ?? 'localhost';
    const proto = (c.req.header('x-forwarded-proto') ?? '').split(',')[0]?.trim();
    return `${proto === 'https' ? 'https' : 'http'}://${host}`;
  };

  const wsUrl = (c: { req: { header(name: string): string | undefined } }, code: string): string =>
    `${origemPublica(c).replace(/^http/, 'ws')}/api/rooms/${code}/ws`;

  app.use('*', async (c, next) => {
    const nonce = randomBytes(16).toString('base64');
    c.set('nonce' as never, nonce as never);
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; '));
  });

  const fail = (code: ErrorCode, params?: Record<string, unknown>) => (params ? { code, params } : { code });

  app.post('/api/rooms', async (c) => {
    const rate = createLimit.check(clientIp(c), now());
    if (!rate.allowed) return c.json(fail('RATE_LIMITED', { motivo: 'SALAS_DEMAIS', retryAfterMs: rate.retryAfterMs }), 429);

    const id = parseIdentity(await c.req.json().catch(() => ({})));
    if (!id.ok) return c.json(fail('VALIDATION_FAILED'), 422);

    const code = generateFreeCode((n) => randomBytes(n), (candidate) => hub.get(candidate) !== undefined);
    const playerId = randomUUID();
    const ctx = hub.ctx();
    hub.adopt(createRoom(code, { playerId, nickname: id.nickname, avatar: id.avatar }, ctx));

    return c.json({
      roomCode: code,
      playerId,
      sessionToken: signer.sign(playerId, code, ctx.now),
      wsUrl: wsUrl(c, code),
      role: 'PLAYER',
    }, 201);
  });

  app.get('/api/rooms/:code', (c) => {
    c.header('Cache-Control', 'no-store');
    const parsed = roomCodeSchema.safeParse(c.req.param('code'));
    if (!parsed.success) return c.json(fail('ROOM_NOT_FOUND'), 404);
    const room = hub.get(parsed.data);
    if (!room || room.status === 'ENCERRADA') return c.json(fail('ROOM_NOT_FOUND'), 404);
    return c.json({
      roomCode: room.code,
      status: room.status,
      modo: room.options.modo,
      playerCount: seatedPlayers(room).length,
      maxPlayers: LIMITS.maxPlayers,
      canJoinAsPlayer: room.status === 'LOBBY' && seatedPlayers(room).length < LIMITS.maxPlayers,
      canJoinAsSpectator: spectators(room).length < LIMITS.maxSpectators,
    });
  });

  app.post('/api/rooms/:code/join', async (c) => {
    const rate = joinLimit.check(clientIp(c), now());
    if (!rate.allowed) return c.json(fail('RATE_LIMITED', { retryAfterMs: rate.retryAfterMs }), 429);

    const parsed = roomCodeSchema.safeParse(c.req.param('code'));
    if (!parsed.success) return c.json(fail('ROOM_NOT_FOUND'), 404);
    const room = hub.get(parsed.data);
    if (!room || room.status === 'ENCERRADA') return c.json(fail('ROOM_NOT_FOUND'), 404);

    const id = parseIdentity(await c.req.json().catch(() => ({})));
    if (!id.ok) return c.json(fail('VALIDATION_FAILED'), 422);

    const playerId = randomUUID();
    const ctx = hub.ctx();
    const result = join(room, { playerId, nickname: id.nickname, avatar: id.avatar }, ctx);
    if (!result.ok) {
      return c.json(fail(result.code, { motivo: result.motivo }), result.code === 'ROOM_FULL' ? 409 : 422);
    }
    hub.commit(result);
    const joined = result.room.players.find((p) => p.id === playerId);

    return c.json({
      roomCode: result.room.code,
      playerId,
      sessionToken: signer.sign(playerId, result.room.code, ctx.now),
      wsUrl: wsUrl(c, result.room.code),
      role: joined?.isSpectator ? 'SPECTATOR' : 'PLAYER',
    });
  });

  /** Retomar: o token salvo no aparelho ainda vale nesta sala? */
  app.post('/api/rooms/:code/session', async (c) => {
    const parsed = roomCodeSchema.safeParse(c.req.param('code'));
    if (!parsed.success) return c.json(fail('ROOM_NOT_FOUND'), 404);
    const body = (await c.req.json().catch(() => ({}))) as { sessionToken?: unknown };
    const token = typeof body.sessionToken === 'string' ? body.sessionToken : '';
    const verified = signer.verify(token, now(), parsed.data);
    if (!verified.ok) return c.json(fail('INVALID_TOKEN'), 401);

    const room = hub.get(parsed.data);
    if (!room || room.status === 'ENCERRADA') return c.json(fail('ROOM_NOT_FOUND'), 404);
    const player = room.players.find((p) => p.id === verified.claims.playerId);
    if (!player || !isPresent(player) || foiExpulso(player)) return c.json(fail('INVALID_TOKEN'), 401);

    return c.json({
      roomCode: room.code,
      playerId: player.id,
      sessionToken: token,
      wsUrl: wsUrl(c, room.code),
      role: player.isSpectator ? 'SPECTATOR' : 'PLAYER',
    });
  });

  app.get('/api/health', (c) =>
    c.json({ ok: true, version, protocolVersion: PROTOCOL_VERSION, rooms: hub.roomCount }));

  const TIPOS: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
    '.txt': 'text/plain; charset=utf-8',
  };

  const RAIZ_PUBLICA = new Set(['/favicon.svg', '/og.png', '/icone.png', '/site.webmanifest', '/robots.txt']);

  app.get('*', (c) => {
    const caminho = new URL(c.req.url).pathname;
    if (caminho.startsWith('/api/')) return c.json(fail('ROOM_NOT_FOUND'), 404);

    if (RAIZ_PUBLICA.has(caminho)) {
      try {
        return c.body(readFileSync(caminhoDe(clientPath, caminho)), 200, {
          'content-type': TIPOS[extname(caminho)] ?? 'application/octet-stream',
          'cache-control': 'public, max-age=3600',
        });
      } catch {
        return c.notFound();
      }
    }

    const ext = extname(caminho);
    if (caminho.startsWith('/assets/') && !caminho.includes('..') && TIPOS[ext]) {
      try {
        return c.body(readFileSync(caminhoDe(clientPath, caminho)), 200, {
          'content-type': TIPOS[ext]!,
          'cache-control': 'public, max-age=31536000, immutable',
        });
      } catch {
        return c.notFound();
      }
    }

    const nonce = c.get('nonce' as never) as unknown as string;
    let html = readFileSync(caminhoDe(clientPath, 'index.html'), 'utf8')
      .replaceAll('<script type="module"', `<script type="module" nonce="${nonce}"`);
    html = trocarMeta(html, 'og:image', `${origemPublica(c)}/og.png`);

    const convite = /^\/j\/([^/]+)$/.exec(caminho);
    if (convite) {
      const alvo = roomCodeSchema.safeParse(convite[1]);
      const sala = alvo.success ? hub.get(alvo.data) : undefined;
      const viva = sala && sala.status !== 'ENCERRADA' ? sala : undefined;
      const modo = viva?.options.modo === 'MULTIPLO_DE_5' ? 'múltiplo de 5' : 'batida';
      const titulo = viva ? `Bora jogar dominó? Mesa ${viva.code}` : 'Dominó';
      const descricao = viva
        ? `${String(seatedPlayers(viva).length)} de ${String(LIMITS.maxPlayers)} na mesa, modo ${modo}. ` +
          'Toque para entrar — sem conta, sem instalar nada.'
        : 'Esta mesa não existe mais. Toque para criar a sua.';
      html = trocarMeta(html, 'og:title', titulo);
      html = trocarMeta(html, 'og:description', descricao);
      html = trocarMeta(html, 'description', descricao, 'name');
      html = html.replace('<title>Dominó</title>', `<title>${escapar(titulo)}</title>`);
    }
    c.header('Cache-Control', 'no-store');
    return c.html(html);
  });

  return app;
}

function escapar(texto: string): string {
  return texto.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function trocarMeta(html: string, chave: string, valor: string, atributo: 'property' | 'name' = 'property'): string {
  const alvo = new RegExp(`<meta ${atributo}="${chave}" content="[^"]*">`);
  return html.replace(alvo, () => `<meta ${atributo}="${chave}" content="${escapar(valor)}">`);
}
