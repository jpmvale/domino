/**
 * Decisão dos bots.
 *
 * O bot recebe a MESMA projeção de um humano (`MatchView`): a mão dele, a mesa
 * e as contagens. A mão dos outros não existe deste lado, então não há como
 * ele trapacear nem por descuido.
 *
 * Três dificuldades:
 * - `FACIL`: joga qualquer pedra que encaixe.
 * - `MEDIO`: pontua quando pode (múltiplo de 5) e larga as pedras pesadas cedo.
 * - `DIFICIL`: além disso, evita deixar a soma pronta para o próximo e guarda
 *   variedade de números na mão para não ficar sem jogada.
 */

import {
  colocar,
  isDouble,
  parseTile,
  somaDasPontas,
  valor,
  type MatchView,
  type Rng,
  type TileId,
} from '@domino/rules';

export const BOT_DIFFICULTIES = ['FACIL', 'MEDIO', 'DIFICIL'] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];

export interface Decisao {
  tileId: TileId;
  endId: string | null;
}

function mesaDepois(visao: MatchView, j: Decisao, eu: string) {
  const primeiraCarroca = visao.mesa.some((p) => p.isDouble);
  return colocar(
    visao.mesa, j.tileId, j.endId, eu,
    isDouble(j.tileId) && visao.options.carrocasAbrem && primeiraCarroca,
  );
}

/** Pontos que a jogada faz no múltiplo de 5. */
function pontosDa(visao: MatchView, j: Decisao, eu: string): number {
  if (visao.options.modo !== 'MULTIPLO_DE_5') return 0;
  const mesa = mesaDepois(visao, j, eu);
  if (!mesa) return 0;
  const soma = somaDasPontas(mesa);
  return soma > 0 && soma % 5 === 0 ? soma : 0;
}

/**
 * O quanto a jogada deixa o próximo pontuar: o maior múltiplo de 5 que uma
 * pedra qualquer ainda fora da mesa e da minha mão faria. Estimativa — o bot
 * não sabe onde as pedras estão, só quais não viu.
 */
function perigo(visao: MatchView, j: Decisao, eu: string, minhas: Set<TileId>): number {
  if (visao.options.modo !== 'MULTIPLO_DE_5') return 0;
  const mesa = mesaDepois(visao, j, eu);
  if (!mesa) return 0;
  const naMesa = new Set(mesa.map((p) => p.tileId));
  let pior = 0;
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      const t = `${a}-${b}`;
      if (naMesa.has(t) || minhas.has(t)) continue;
      for (const ponta of mesa.flatMap((p) => Object.entries(p.slots)
        .filter(([, f]) => f === null).map(([slot]) => `${p.idx}${slot}`))) {
        const depois = colocar(mesa, t, ponta, 'outro', a === b && visao.options.carrocasAbrem);
        if (!depois) continue;
        const s = somaDasPontas(depois);
        if (s > 0 && s % 5 === 0) pior = Math.max(pior, s);
      }
    }
  }
  return pior;
}

/** Quantos números diferentes sobram na mão: mais variedade, menos passe. */
function variedade(restantes: TileId[]): number {
  const numeros = new Set<number>();
  for (const t of restantes) {
    const p = parseTile(t);
    numeros.add(p.a);
    numeros.add(p.b);
  }
  return numeros.size;
}

export function decidirJogada(visao: MatchView, eu: string, difficulty: BotDifficulty, rng: Rng): Decisao {
  const legais = visao.jogadasLegais;
  if (legais.length === 0) throw new Error('bot sem jogada legal');
  if (difficulty === 'FACIL') return legais[rng.nextInt(legais.length)]!;

  const minhas = new Set(visao.minhaMao);
  let melhor = legais[0]!;
  let melhorNota = -Infinity;

  for (const j of legais) {
    let nota = 0;
    nota += pontosDa(visao, j, eu) * 10;
    // Larga peso cedo: no trancado, e na batida, pedra pesada na mão é perda.
    nota += valor(j.tileId) * 1.5;
    // Carroça só encaixa num número: quanto antes sair, menos ela tranca a mão.
    if (isDouble(j.tileId)) nota += 4;

    if (difficulty === 'DIFICIL') {
      nota -= perigo(visao, j, eu, minhas) * 4;
      const restantes = visao.minhaMao.filter((t) => t !== j.tileId);
      nota += variedade(restantes) * 2;
    }

    // Desempate aleatório: dois bots iguais não jogam sempre igual.
    nota += rng.nextInt(100) / 1000;
    if (nota > melhorNota) { melhorNota = nota; melhor = j; }
  }
  return melhor;
}
