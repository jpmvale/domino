# Dominó

Dominó com os amigos, direto no navegador — cada um no seu aparelho, numa sala com link
de convite. De 2 a 4 pessoas, em dupla ou cada um por si, em dois modos:

- **Batida** (padrão): só o fim da mão pontua — batida simples, de carroça, lá-e-lô e
  cruzada, ou a menor mão no jogo trancado.
- **Múltiplo de 5:** pontua quem deixa a soma das pontas num múltiplo de 5.

Regras completas e as escolhas de cada variação em [`docs/regras.md`](docs/regras.md).

Irmão do [FDP](https://github.com/jpmvale/fdp): mesma arquitetura, mesmo design system
(Nocturne) e o mesmo jeito de publicar na VPS.

## O que tem

- Sala com código de 5 letras e link `/j/{código}` que chega no WhatsApp como cartão.
- Lobby com pronto, ordem dos assentos (é como se escolhe a dupla), modo e meta.
- Bots em três níveis para completar a mesa.
- Chat da sala, com silenciar e expulsar.
- Espectadores: quem chega com a partida rolando assiste e joga a próxima.
- Reconexão sozinha, recarregar a página volta para o mesmo assento, e pausa por ausência
  com prazo e decisão do anfitrião (um bot assume, ou encerra).
- Quem sai ou é expulso no meio da partida deixa um bot no assento: a mão segue.
- Revanche com a mesma mesa, ou volta ao lobby para arrumar.

Fica para uma segunda leva (dependem de Postgres e OAuth): contas, histórico, perfil e
filas/ranqueada, como no FDP.

## Desenvolvimento

Requer Node 22+ (a imagem de produção usa o 24).

```bash
npm install
npm run build:client   # obrigatório antes do primeiro `npm start`
npm start              # http://localhost:3000
npm test
npm run typecheck
```

O servidor serve o cliente de `app/build/`. Para mexer na interface com recarga
automática, rode `npm run dev:client` junto com `npm start`.

Sem `REDIS_URL` as salas ficam em memória e morrem com o processo; com ele, uma partida
atravessa um reinício exatamente onde estava (`npm run redis` sobe um local).

## Arquitetura

```
packages/rules/      motor de regras — puro e determinístico, sem I/O
packages/bot/        decisão dos bots, alimentada pela mesma projeção do humano
packages/protocol/   contrato cliente ↔ servidor + validação (zod, só no servidor)
packages/room/       sala: lobby, host, pausa, relógio, chat, bots no assento
packages/store/      RoomStore em memória e Redis (o mesmo do FDP)
server/              HTTP (Hono) + WebSocket (ws) num processo só
app/                 cliente Vite + React
```

- **O servidor é a única autoridade.** O cliente é uma tela.
- **Sincronização por retrato:** a cada mudança, cada pessoa recebe o estado da sala já
  projetado para ela. A mão dos outros e o monte nunca saem do servidor — só a contagem.
- **A partida nunca fica sem saída:** toda pausa tem prazo, e a vez estourada é jogada
  pelo sistema.

O código copiado do FDP (store, sessão, limites, identidade, código de sala, rede do
cliente) mantém nos comentários as referências aos requisitos de lá (`RNF-`, `CA-`, `RJ-`),
documentados em [`jpmvale/fdp/docs`](https://github.com/jpmvale/fdp/tree/main/docs).

## Testes

- `packages/rules`: 1.000 partidas simuladas em todas as combinações de modo, jogadores,
  duplas e carroças, conferindo os invariantes a cada jogada e o vazamento de pedra
  oculta para cada jogador.
- `packages/room`: lobby, chat, pausa e teto da pausa, bot assumindo assento, revanche.
- `server`: HTTP e WebSocket reais, com uma mesa jogando de ponta a ponta.
- `app`: o desenho da mesa — nenhuma pedra por cima de outra.

## Produção

`https://domino.imp-software.cloud`, na VPS dos outros projetos. Push na `main` roda o CI;
passando, o workflow `Deploy` publica a imagem no GHCR e chama o `deploy.sh` da VPS.
Detalhes em [`deploy/README.md`](deploy/README.md).
