# Instalação na VPS

O mesmo arranjo do FDP: a VPS (`srv1876937`, 187.77.242.128) tem um Caddy em container
segurando 80/443 e roteando por subdomínio pela rede `edge`, e cada app sobe por GitHub
Actions → chave com forced command → `~/bin/deploy.sh <app> <sha>`, puxando a imagem do
GHCR. A configuração compartilhada mora no repositório `vps-infra`.

| Peça | Onde |
|---|---|
| Fonte na VPS | `~/apps/domino`, clone deste repositório |
| Stack | `docker-compose.prod.yml` na raiz |
| Containers | `domino-api` e `domino-redis`, nenhum publicando porta no host |
| Redes | `internal` (Redis) e `edge` (só a API, para o Caddy) |
| Segredo | `~/apps/domino/.env`, modo 600, com `DOMINO_SESSION_SECRET` |
| Roteamento | bloco `domino.imp-software.cloud` em `~/caddy/Caddyfile` (cópia em [`Caddyfile`](Caddyfile)) |

O Redis é próprio do Dominó e roda sem persistência em disco: sala tem TTL de 4 h.

## Primeira instalação

1. **DNS:** registro `A domino → 187.77.242.128` no painel da Hostinger. Sem ele, o Caddy
   configurado dá "site não encontrado".
2. **Código e segredo:**

   ```bash
   ssh vps 'git clone https://github.com/jpmvale/domino.git ~/apps/domino'
   ssh vps 'cd ~/apps/domino && umask 077 && printf "DOMINO_SESSION_SECRET=%s\n" "$(openssl rand -hex 32)" > .env'
   ```

3. **vps-infra:** acrescentar `domino` à lista fechada e um ramo no `case` de
   `bin/deploy.sh`, o bloco do Caddy ao fim de `caddy/Caddyfile`, e a linha em
   `bin/checkup-apps.conf`; copiar para a VPS e recarregar o Caddy:

   ```bash
   ssh vps 'docker exec caddy caddy validate --config /etc/caddy/Caddyfile && \
            docker exec caddy caddy reload --config /etc/caddy/Caddyfile'
   ```

4. **Segredos do repositório** (Settings → Secrets and variables → Actions), os mesmos
   dos outros apps: `VPS_HOST`, `VPS_DEPLOY_KEY`, `VPS_HOST_KEY`.
5. Push na `main`: o CI roda e o `Deploy` publica.

## Verificar

```bash
curl -s https://domino.imp-software.cloud/api/health
```

E o teste que importa: abrir a mesa em duas abas, começar a partida, e
`ssh vps 'docker restart domino-api'`. As abas reconectam sozinhas e a partida continua
na mesma mão.
