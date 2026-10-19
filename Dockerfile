# Imagem de produção do Dominó — o mesmo desenho da do FDP.
#
# Duas etapas: a primeira constrói o cliente (Vite precisa das devDependencies),
# a segunda leva só o resultado e as dependências de produção.

# --- etapa 1: o cliente ------------------------------------------------------
FROM node:24-alpine AS cliente
WORKDIR /app
COPY package.json package-lock.json ./
# `packages/` inteiro: uma lista de COPY por pacote envelhece em silêncio, e o
# npm não linka o workspace que ficou de fora.
COPY packages ./packages
RUN npm ci
COPY . .
RUN npm run build:client

# --- etapa 2: o que roda -----------------------------------------------------
FROM node:24-alpine

# `tini` como PID 1: o desligamento gracioso depende do SIGTERM chegar inteiro.
RUN apk add --no-cache tini

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --omit=dev
COPY . .

# O cliente vem da etapa anterior, nunca do contexto: um checkout limpo não tem
# `app/build/`, e o sintoma seria um 500 na raiz sem causa aparente.
COPY --from=cliente /app/app/build ./app/build

# Roda dos fontes TypeScript sob `tsx`: os pacotes exportam `.ts`.
USER node
ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "server/src/main.ts"]
