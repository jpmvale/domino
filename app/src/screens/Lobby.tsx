import { useState } from 'react';
import { BOT_DIFFICULTIES, LIMITS, type BotDifficulty, type ChatMessage, type PublicPlayer, type RoomView } from '@domino/protocol';
import { METAS, opcoesDoModo, type MatchOptions } from '@domino/rules';
import { Avatar } from '../components/Avatar';
import { Chat } from '../components/Chat';
import { linkDoConvite } from '../net/sessao';
import { avisar } from '../state/loja';

const NOME_DIFICULDADE: Record<BotDifficulty, string> = { FACIL: 'fácil', MEDIO: 'médio', DIFICIL: 'difícil' };

type Enviar = (tipo: string, payload?: unknown) => void;

/** A sala de espera: convite, quem senta onde, as regras da partida e o pronto. */
export function Lobby({
  sala, eu, chat, enviar, aoSair, aoAbrirRegras,
}: {
  sala: RoomView;
  eu: string;
  chat: ChatMessage[];
  enviar: Enviar;
  aoSair: () => void;
  aoAbrirRegras: () => void;
}) {
  const souHost = sala.hostId === eu;
  const euJogador = sala.players.find((p) => p.id === eu);
  const porId = new Map(sala.players.map((p) => [p.id, p]));
  const sentados = sala.ordem.map((id) => porId.get(id)).filter((p): p is PublicPlayer => p !== undefined);
  const assistindo = sala.players.filter((p) => p.isSpectator);
  const duplas = sala.options.duplas && sentados.length === 4;
  const faltaPronto = sentados.filter((p) => !p.pronto);
  const podeComecar = sentados.length >= LIMITS.minPlayers && faltaPronto.length === 0 && sentados.some((p) => !p.bot);
  const [dificuldade, setDificuldade] = useState<BotDifficulty>('MEDIO');

  const link = linkDoConvite(sala.code);
  const compartilhar = async () => {
    const texto = `Bora jogar dominó? Entra na mesa ${sala.code}:`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Dominó', text: texto, url: link });
        return;
      }
    } catch { /* cancelou: tenta copiar */ }
    try {
      await navigator.clipboard.writeText(link);
      avisar('Link copiado');
    } catch {
      avisar(link);
    }
  };

  const mudarOpcoes = (o: Partial<MatchOptions>) => enviar('host:setOptions', { options: { ...sala.options, ...o } });
  const mover = (id: string, delta: number) => {
    const ordem = [...sala.ordem];
    const i = ordem.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= ordem.length) return;
    [ordem[i], ordem[j]] = [ordem[j]!, ordem[i]!];
    enviar('host:setOrdem', { ordem });
  };

  const host = porId.get(sala.hostId ?? '');

  return (
    <div className="pilha" style={{ gap: 16 }}>
      <header className="linha" style={{ justifyContent: 'space-between', paddingTop: 8 }}>
        <div className="pilha" style={{ gap: 2 }}>
          <span className="rotulo">sala</span>
          <strong style={{ fontSize: 28, letterSpacing: '0.18em', fontWeight: 600 }}>{sala.code}</strong>
        </div>
        <div className="linha">
          <button className="fantasma" onClick={aoAbrirRegras} style={{ padding: '0 12px' }}>Regras</button>
          <button className="fantasma" onClick={aoSair} style={{ padding: '0 12px' }}>Sair</button>
        </div>
      </header>

      <button onClick={() => void compartilhar()} style={{ height: 48 }}>Convidar pelo link</button>

      <section className="cartao pilha" style={{ gap: 10 }}>
        <div className="linha" style={{ justifyContent: 'space-between' }}>
          <span className="rotulo">na mesa · {sentados.length}/{LIMITS.maxPlayers}</span>
          {duplas && <span className="fraco" style={{ fontSize: 12 }}>1º e 3º contra 2º e 4º</span>}
        </div>
        {sentados.map((p, i) => (
          <div key={p.id} className="linha" style={{ gap: 10, minHeight: 44 }}>
            {duplas && (
              <span
                className="chip"
                style={{ padding: '2px 8px', fontSize: 12, color: i % 2 === 0 ? 'var(--avatar-sky)' : 'var(--avatar-orange)' }}
              >
                {i % 2 === 0 ? 'A' : 'B'}
              </span>
            )}
            <Avatar avatar={p.avatar} />
            <div className="pilha" style={{ gap: 0, flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.nickname}{p.id === eu && ' (você)'}
              </span>
              <span className="fraco" style={{ fontSize: 12 }}>
                {p.bot ? `bot ${NOME_DIFICULDADE[p.bot.difficulty]}` : p.id === sala.hostId ? 'anfitrião' : p.connection === 'DESCONECTADO' ? 'caiu' : ''}
                {p.silenciado && ' · silenciado'}
              </span>
            </div>
            <span className="chip" style={{ color: p.pronto ? 'var(--nota-alta)' : 'var(--texto-apagado)' }}>
              {p.pronto ? 'pronto' : 'esperando'}
            </span>
            {souHost && (
              <div className="linha" style={{ gap: 4 }}>
                {sentados.length > 1 && (
                  <>
                    <button className="fantasma" aria-label={`Subir ${p.nickname}`} disabled={i === 0} onClick={() => mover(p.id, -1)} style={{ padding: '0 8px', minHeight: 34 }}>↑</button>
                    <button className="fantasma" aria-label={`Descer ${p.nickname}`} disabled={i === sentados.length - 1} onClick={() => mover(p.id, 1)} style={{ padding: '0 8px', minHeight: 34 }}>↓</button>
                  </>
                )}
                {p.bot ? (
                  <button className="fantasma" aria-label={`Tirar ${p.nickname}`} onClick={() => enviar('host:removeBot', { playerId: p.id })} style={{ padding: '0 8px', minHeight: 34 }}>✕</button>
                ) : p.id !== eu ? (
                  <MenuDoHost jogador={p} enviar={enviar} />
                ) : null}
              </div>
            )}
          </div>
        ))}
        {sentados.length < LIMITS.maxPlayers && (
          <p className="fraco">Lugar vago. Mande o link ou chame um bot.</p>
        )}
        {souHost && sentados.length < LIMITS.maxPlayers && (
          <div className="linha">
            <div className="segmentado" style={{ flex: 1 }}>
              {BOT_DIFFICULTIES.map((d) => (
                <button key={d} aria-pressed={dificuldade === d} onClick={() => setDificuldade(d)}>{NOME_DIFICULDADE[d]}</button>
              ))}
            </div>
            <button className="fantasma" onClick={() => enviar('host:addBot', { difficulty: dificuldade })}>+ Bot</button>
          </div>
        )}
        {assistindo.length > 0 && (
          <p className="fraco">Assistindo: {assistindo.map((p) => p.nickname).join(', ')}</p>
        )}
      </section>

      <section className="cartao pilha" style={{ gap: 12 }}>
        <span className="rotulo">regras da partida{!souHost && host ? ` · quem escolhe é ${host.nickname}` : ''}</span>
        <div className="segmentado" role="group" aria-label="Modo">
          {(['BATIDA', 'MULTIPLO_DE_5'] as const).map((m) => (
            <button
              key={m}
              aria-pressed={sala.options.modo === m}
              disabled={!souHost}
              onClick={() => enviar('host:setOptions', { options: opcoesDoModo(m) })}
            >
              {m === 'BATIDA' ? 'Batida' : 'Múltiplo de 5'}
            </button>
          ))}
        </div>
        <div className="linha" style={{ justifyContent: 'space-between' }}>
          <span>Partida até</span>
          <div className="segmentado">
            {METAS[sala.options.modo].map((m) => (
              <button key={m} aria-pressed={sala.options.meta === m} disabled={!souHost} onClick={() => mudarOpcoes({ meta: m })} style={{ minWidth: 40 }}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <Interruptor
          rotulo="Duplas com 4 jogadores"
          ligado={sala.options.duplas}
          desabilitado={!souHost}
          aoMudar={(v) => mudarOpcoes({ duplas: v })}
        />
        <Interruptor
          rotulo="Carroças abrem (a partir da segunda)"
          ligado={sala.options.carrocasAbrem}
          desabilitado={!souHost}
          aoMudar={(v) => mudarOpcoes({ carrocasAbrem: v })}
        />
      </section>

      {euJogador && !euJogador.isSpectator ? (
        <div className="linha">
          <button
            className={euJogador.pronto ? 'fantasma' : undefined}
            style={{ flex: 1, height: 48 }}
            onClick={() => enviar('player:setPronto', { pronto: !euJogador.pronto })}
          >
            {euJogador.pronto ? 'Não estou pronto' : 'Estou pronto'}
          </button>
          <button className="fantasma" onClick={() => enviar('player:setSpectator', { spectator: true })}>Assistir</button>
        </div>
      ) : (
        <button className="fantasma" disabled={sentados.length >= LIMITS.maxPlayers} onClick={() => enviar('player:setSpectator', { spectator: false })}>
          Sentar na mesa
        </button>
      )}

      {souHost && (
        <div className="pilha" style={{ gap: 6 }}>
          <button style={{ height: 52 }} disabled={!podeComecar} onClick={() => enviar('host:startMatch')}>
            Começar partida
          </button>
          {!podeComecar && (
            <span className="fraco" style={{ textAlign: 'center' }}>
              {sentados.length < LIMITS.minPlayers
                ? 'Precisa de pelo menos 2 na mesa.'
                : `Esperando: ${faltaPronto.map((p) => p.nickname).join(', ')}`}
            </span>
          )}
        </div>
      )}
      {!souHost && host && <p className="fraco" style={{ textAlign: 'center' }}>Quem começa a partida é {host.nickname}.</p>}

      <section className="pilha" style={{ gap: 8 }}>
        <span className="rotulo">conversa</span>
        <Chat
          mensagens={chat}
          jogadores={sala.players}
          eu={eu}
          silenciado={euJogador?.silenciado ?? false}
          aoEnviar={(text) => enviar('chat:send', { text })}
          altura={180}
        />
      </section>
    </div>
  );
}

function Interruptor({ rotulo, ligado, desabilitado, aoMudar }: {
  rotulo: string; ligado: boolean; desabilitado: boolean; aoMudar: (v: boolean) => void;
}) {
  return (
    <label className="linha" style={{ justifyContent: 'space-between', cursor: desabilitado ? 'default' : 'pointer' }}>
      <span>{rotulo}</span>
      <input
        type="checkbox"
        role="switch"
        checked={ligado}
        disabled={desabilitado}
        onChange={(e) => aoMudar(e.target.checked)}
        style={{ width: 44, minHeight: 24, accentColor: 'var(--acento)' }}
      />
    </label>
  );
}

function MenuDoHost({ jogador, enviar }: { jogador: PublicPlayer; enviar: Enviar }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button className="fantasma" aria-label={`Opções para ${jogador.nickname}`} aria-expanded={aberto} onClick={() => setAberto((v) => !v)} style={{ padding: '0 8px', minHeight: 34 }}>⋯</button>
      {aberto && (
        <div className="cartao pilha" style={{ position: 'absolute', right: 0, top: 38, zIndex: 5, gap: 6, padding: 8, width: 170 }}>
          <button className="fantasma" onClick={() => { setAberto(false); enviar('host:silenciar', { playerId: jogador.id, silenciado: !jogador.silenciado }); }}>
            {jogador.silenciado ? 'Liberar chat' : 'Silenciar'}
          </button>
          <button className="perigo" onClick={() => { setAberto(false); enviar('host:kick', { playerId: jogador.id }); }}>
            Expulsar
          </button>
        </div>
      )}
    </div>
  );
}
