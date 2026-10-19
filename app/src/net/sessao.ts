/**
 * HTTP da sala e o token guardado no aparelho.
 *
 * O token fica no `localStorage` por sala: é o que permite recarregar a página
 * no meio da partida e cair de volta no mesmo assento.
 */

export interface Sessao {
  playerId: string;
  sessionToken: string;
  roomCode: string;
  wsUrl: string;
  role: 'PLAYER' | 'SPECTATOR';
}

const chave = (codigo: string) => `domino.sessao.${codigo}`;

function tentar<T>(f: () => T, padrao: T): T {
  try { return f(); } catch { return padrao; }
}

export const guardado = (codigo: string) => tentar(() => localStorage.getItem(chave(codigo)), null);
export const guardar = (codigo: string, token: string) => tentar(() => localStorage.setItem(chave(codigo), token), undefined);
export const esquecer = (codigo: string) => tentar(() => localStorage.removeItem(chave(codigo)), undefined);
export const ultimaSala = () => tentar(() => localStorage.getItem('domino.ultima'), null);
export const lembrarSala = (codigo: string) => tentar(() => localStorage.setItem('domino.ultima', codigo), undefined);
export const esquecerUltima = () => tentar(() => localStorage.removeItem('domino.ultima'), undefined);

export interface Identidade {
  nickname: string;
  avatar: { emoji: string; color: string };
}

export const identidadeGuardada = (): Identidade | null =>
  tentar(() => JSON.parse(localStorage.getItem('domino.identidade') ?? 'null') as Identidade | null, null);
export const guardarIdentidade = (i: Identidade) =>
  tentar(() => localStorage.setItem('domino.identidade', JSON.stringify(i)), undefined);

export class ErroApi extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(mensagem);
  }
}

async function api<T>(caminho: string, corpo?: unknown): Promise<T> {
  const r = await fetch(caminho, corpo === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  const dados = (await r.json().catch(() => ({}))) as { code?: string; params?: { motivo?: string } };
  if (!r.ok) {
    const codigo = dados.params?.motivo ?? dados.code ?? 'ERRO';
    throw new ErroApi(codigo, codigo);
  }
  return dados as T;
}

export const criarSala = (i: Identidade) => api<Sessao>('/api/rooms', i);
export const entrarNaSala = (codigo: string, i: Identidade) => api<Sessao>(`/api/rooms/${codigo}/join`, i);
export const retomarSessao = (codigo: string, sessionToken: string) =>
  api<Sessao>(`/api/rooms/${codigo}/session`, { sessionToken });
export const infoDaSala = (codigo: string) =>
  api<{ roomCode: string; status: string; playerCount: number; canJoinAsPlayer: boolean }>(`/api/rooms/${codigo}`);

/** Volta para a última sala, se o token ainda vale. */
export async function retomar(codigoDoLink: string | null): Promise<Sessao | null> {
  const codigo = codigoDoLink ?? ultimaSala();
  if (!codigo) return null;
  const token = guardado(codigo);
  if (!token) return null;
  try {
    return await retomarSessao(codigo, token);
  } catch {
    esquecer(codigo);
    return null;
  }
}

/** O código no link de convite: `/j/ABCDE`. */
export function codigoDoConvite(): string | null {
  const m = /^\/j\/([A-Za-z0-9]{5})\/?$/.exec(location.pathname);
  return m ? m[1]!.toUpperCase() : null;
}

export const linkDoConvite = (codigo: string): string => `${location.origin}/j/${codigo}`;
