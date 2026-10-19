/**
 * Onde cada pedra fica na mesa desenhada.
 *
 * A regra (o que encosta em quê) é do motor; aqui é só geometria. A mesa é
 * desenhada em meias-unidades: uma pedra deitada ocupa 4×2, em pé 2×4. Cada
 * braço anda reto até bater na borda ou em outra pedra, e aí faz a curva em U,
 * como se faz numa mesa de verdade quando a fila chega na beirada.
 *
 * Determinístico: o mesmo estado sempre desenha a mesma mesa, em qualquer
 * aparelho — todo mundo vê a mesma fila no mesmo lugar.
 */

import type { Placement, Slot } from '@domino/rules';

export interface Dir { dx: number; dy: number }

const R: Dir = { dx: 1, dy: 0 };
const L: Dir = { dx: -1, dy: 0 };
const U: Dir = { dx: 0, dy: -1 };
const D: Dir = { dx: 0, dy: 1 };

const neg = (d: Dir): Dir => ({ dx: -d.dx, dy: -d.dy });
const perp = (d: Dir): Dir => ({ dx: -d.dy, dy: d.dx });
const horizontal = (d: Dir): boolean => d.dy === 0;
const igual = (a: Dir, b: Dir): boolean => a.dx === b.dx && a.dy === b.dy;

interface Ponto { x: number; y: number }
const mais = (p: Ponto, d: Dir, k: number): Ponto => ({ x: p.x + d.dx * k, y: p.y + d.dy * k });

/** Uma pedra desenhada: retângulo em meias-unidades e o que mostra em cada metade. */
export interface PedraDesenhada {
  idx: number;
  tileId: string;
  x: number; // canto superior esquerdo
  y: number;
  w: number;
  h: number;
  /** Número na metade de cima/esquerda e na de baixo/direita. */
  primeiro: number;
  segundo: number;
  vertical: boolean;
}

/** Onde a próxima pedra encostaria naquela ponta. */
export interface Saida {
  endId: string;
  x: number;
  y: number;
  dir: Dir;
}

interface Braco {
  /** Último sentido horizontal do braço, para saber para onde voltar na curva. */
  horiz: Dir | null;
  /** Para que lado o braço desce quando chega na borda. */
  vert: Dir;
  /** Pedras em pé seguidas desde a última deitada: a curva em U usa duas. */
  emPe: number;
}

interface SaidaInterna { ponto: Ponto; dir: Dir; braco: Braco }

export interface Layout {
  pedras: PedraDesenhada[];
  saidas: Saida[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Meia largura útil da mesa, em meias-unidades. ~7 pedras de ponta a ponta. */
export const LARGURA = 15;

/** Pedras em pé na curva em U. */
export const CURVA = 2;

export function layoutDaMesa(mesa: readonly Placement[], largura = LARGURA): Layout {
  const pedras: PedraDesenhada[] = [];
  const saidas = new Map<string, SaidaInterna>();
  const ocupadas = new Set<string>();

  /** Quantas células já ocupadas o retângulo cobriria. */
  const colisoes = (x0: number, y0: number, w: number, h: number): number => {
    let n = 0;
    for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) {
      if (ocupadas.has(`${x},${y}`)) n++;
    }
    return n;
  };
  /** Dentro da largura; a curva ganha folga, senão a fila nunca vira na beirada. */
  const dentro = (x0: number, w: number, folga: number): boolean =>
    x0 >= -largura - folga && x0 + w <= largura + folga;

  const ocupar = (x0: number, y0: number, w: number, h: number): void => {
    for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + h; y++) ocupadas.add(`${x},${y}`);
  };

  /** Retângulo de uma pedra que começa em `s` e anda em `c`. */
  const retangulo = (s: Ponto, c: Dir, comprimento: number, meiaLargura: number) => {
    const fim = mais(s, c, comprimento);
    const p = perp(c);
    const a = mais(s, p, meiaLargura);
    const b = mais(fim, p, -meiaLargura);
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    return { x: x0, y: y0, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  };

  const registrarSaida = (idx: number, slot: Slot, ponto: Ponto, dir: Dir, braco: Braco) =>
    saidas.set(`${idx}${slot}`, { ponto, dir, braco });

  for (const p of mesa) {
    if (p.parent === null) {
      // A primeira pedra, no centro. Carroça em pé, comum deitada.
      if (p.isDouble) {
        ocupar(-1, -2, 2, 4);
        pedras.push({ idx: p.idx, tileId: p.tileId, x: -1, y: -2, w: 2, h: 4, primeiro: p.a, segundo: p.b, vertical: true });
        registrarSaida(p.idx, 'E', { x: -1, y: 0 }, L, { horiz: L, vert: U, emPe: 0 });
        registrarSaida(p.idx, 'D', { x: 1, y: 0 }, R, { horiz: R, vert: D, emPe: 0 });
      } else {
        ocupar(-2, -1, 4, 2);
        pedras.push({ idx: p.idx, tileId: p.tileId, x: -2, y: -1, w: 4, h: 2, primeiro: p.a, segundo: p.b, vertical: false });
        registrarSaida(p.idx, 'E', { x: -2, y: 0 }, L, { horiz: L, vert: U, emPe: 0 });
        registrarSaida(p.idx, 'D', { x: 2, y: 0 }, R, { horiz: R, vert: D, emPe: 0 });
      }
      continue;
    }

    const saida = saidas.get(`${p.parent}${p.parentSlot}`);
    if (!saida) continue;
    saidas.delete(`${p.parent}${p.parentSlot}`);
    const { ponto: P, dir: d, braco } = saida;

    // Ordem de preferência de direção.
    const candidatas: Dir[] = [];
    // Fecha o U depois de duas pedras em pé: o vão entre as filas fica com
    // espaço para as carroças que abrem para cima e para baixo.
    if (!horizontal(d) && braco.horiz && braco.emPe >= CURVA) candidatas.push(neg(braco.horiz));
    candidatas.push(d);
    if (horizontal(d)) candidatas.push(braco.vert, neg(braco.vert));
    else candidatas.push(braco.horiz ? neg(braco.horiz) : R, braco.horiz ?? L);

    const comprimento = p.isDouble ? 2 : 4;
    const meia = p.isDouble ? 2 : 1;

    // Cada direção é tentada reta e, na curva, avançando a meia largura da
    // pedra nova, para ela encostar de quina sem cobrir a anterior. Fica a primeira que cabe; se nenhuma couber, a que
    // menos cobre outras pedras.
    type Opcao = { s: Ponto; c: Dir; r: ReturnType<typeof retangulo>; custo: number };
    let escolhido: Opcao | null = null;
    let melhor: Opcao | null = null;
    // Primeiro dentro da largura; se não houver como, aceita passar da borda —
    // mesa um pouco mais larga é melhor que pedra por cima de pedra.
    for (const respeitaBorda of [true, false]) {
      for (const c of candidatas) {
        if (igual(c, neg(d))) continue;
        const inicios = igual(c, d)
          // Reta: no eixo, ou com um degrau de lado quando o eixo está tomado.
          ? [P, ...(respeitaBorda ? [] : [mais(P, perp(d), 1), mais(P, perp(d), -1), mais(P, perp(d), 2), mais(P, perp(d), -2)])]
          : [mais(P, d, meia), mais(P, d, meia + 1), ...(respeitaBorda ? [] : [mais(P, d, meia + 2), mais(P, d, meia + 3)])];
        for (const s of inicios) {
          const r = retangulo(s, c, comprimento, meia);
          const curva = !igual(c, d);
          if (respeitaBorda && !dentro(r.x, r.w, curva ? 3 : meia - 1)) continue;
          const custo = colisoes(r.x, r.y, r.w, r.h);
          if (custo === 0) { escolhido = { s, c, r, custo }; break; }
          if (!melhor || custo < melhor.custo) melhor = { s, c, r, custo };
        }
        if (escolhido) break;
      }
      if (escolhido) break;
    }
    if (!escolhido) {
      const c = candidatas[0]!;
      const s = igual(c, d) ? P : mais(P, d, meia);
      escolhido = melhor ?? { s, c, r: retangulo(s, c, comprimento, meia), custo: 0 };
    }
    const { s, c, r } = escolhido;
    ocupar(r.x, r.y, r.w, r.h);

    const vertical = r.h > r.w;
    // O número que encostou fica do lado de onde a pedra veio.
    const inicioPrimeiro = c.dx > 0 || c.dy > 0;
    const entra = p.inValue ?? p.a;
    const sai = p.outValue ?? p.b;
    pedras.push({
      idx: p.idx, tileId: p.tileId, ...r, vertical,
      primeiro: inicioPrimeiro ? entra : sai,
      segundo: inicioPrimeiro ? sai : entra,
    });

    const novoBraco: Braco = {
      horiz: horizontal(c) ? c : braco.horiz,
      vert: braco.vert,
      emPe: horizontal(c) ? 0 : braco.emPe + 1,
    };
    registrarSaida(p.idx, 'C', mais(s, c, comprimento), c, novoBraco);
    if (p.branches) {
      const meio = mais(s, c, 1);
      const lado = perp(c);
      for (const [slot, dir] of [['L', lado], ['R', neg(lado)]] as const) {
        registrarSaida(p.idx, slot, mais(meio, dir, 2), dir, {
          horiz: horizontal(dir) ? dir : null,
          vert: horizontal(dir) ? braco.vert : dir,
          emPe: 0,
        });
      }
    }
  }

  let minX = -4; let minY = -3; let maxX = 4; let maxY = 3;
  for (const p of pedras) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w); maxY = Math.max(maxY, p.y + p.h);
  }
  const listaDeSaidas: Saida[] = [...saidas].map(([endId, s]) => ({ endId, x: s.ponto.x, y: s.ponto.y, dir: s.dir }));
  for (const s of listaDeSaidas) {
    // Cabe o alvo inteiro: ele fica duas meias-unidades à frente da saída.
    minX = Math.min(minX, s.x - 4); maxX = Math.max(maxX, s.x + 4);
    minY = Math.min(minY, s.y - 4); maxY = Math.max(maxY, s.y + 4);
  }
  return { pedras, saidas: listaDeSaidas, minX, minY, maxX, maxY };
}
