/**
 * As 28 pedras do jogo duplo-seis.
 */

import type { Rng } from './rng.js';
import type { Tile, TileId } from './types.js';

export const tileId = (a: number, b: number): TileId =>
  a <= b ? `${a}-${b}` : `${b}-${a}`;

export function parseTile(id: TileId): Tile {
  const [x, y] = id.split('-').map(Number) as [number, number];
  return { id, a: Math.min(x, y), b: Math.max(x, y) };
}

export const isDouble = (id: TileId): boolean => {
  const t = parseTile(id);
  return t.a === t.b;
};

/** Valor da pedra: a soma dos dois lados. */
export const valor = (id: TileId): number => {
  const t = parseTile(id);
  return t.a + t.b;
};

export function todasAsPedras(): TileId[] {
  const ids: TileId[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) ids.push(tileId(a, b));
  return ids;
}

export const TOTAL_DE_PEDRAS = 28;

/** Fisher–Yates com o gerador da partida. */
export function embaralhar(ids: readonly TileId[], rng: Rng): TileId[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Encaixa naquele número? */
export const encaixa = (id: TileId, numero: number): boolean => {
  const t = parseTile(id);
  return t.a === numero || t.b === numero;
};

/**
 * Ordena para exibir e para decidir: carroças maiores primeiro, depois pelo
 * valor. É a ordem de "quem começa" quando ninguém tem a carroça de sena.
 */
export function compararForca(x: TileId, y: TileId): number {
  const dx = isDouble(x) ? 1 : 0;
  const dy = isDouble(y) ? 1 : 0;
  if (dx !== dy) return dy - dx;
  const vx = valor(x);
  const vy = valor(y);
  if (vx !== vy) return vy - vx;
  return parseTile(y).b - parseTile(x).b;
}
