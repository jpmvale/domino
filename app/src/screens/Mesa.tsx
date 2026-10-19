import { useEffect, useState } from 'react';
import { LIMITS, type ChatMessage, type PublicPlayer, type RoomView } from '@domino/protocol';
import type { MatchView, TipoDeBatida } from '@domino/rules';
import { Avatar } from '../components/Avatar';
import { Chat } from '../components/Chat';
import { Gaveta } from '../components/Gaveta';
import { MesaDesenhada } from '../components/MesaDesenhada';
import { CostasDaPedra, Pedra } from '../components/Pedra';

type Enviar = (tipo: string, payload?: unknown) => void;

const NOME_BATIDA: Record<TipoDeBatida, string> = {
  SIMPLES: 'batida simples',
  CARROCA: 'batida de carroça',
  LA_E_LO: 'lá-e-lô',
  CRUZADA: 'cruzada',
};

const COR_EQUIPE = ['var(--avatar-sky)', 'var(--avatar-orange)', 'var(--avatar-lime)', 'var(--avatar-rose)'];

function useAgora(intervalo = 250): number {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), intervalo);
    return () => clearInterval(t);
  }, [intervalo]);
  return agora;
}

/** Nome de uma equipe: os apelidos, ou "Você e Fulano". */
function nomeDaEquipe(equipe: string[], porId: Map<string, PublicPlayer>, eu: string | null): string {
  const nomes = equipe.map((id) => (id === eu ? 'Você' : porId.get(id)?.nickname ?? 'Alguém'));
  return nomes.join(' e ');
}

export function Mesa({
  sala, eu, chat, naoLidas, selecionada, enviar, aoSelecionar, aoAbrirRegras, aoSair, aoLerChat,
}: {
  sala: RoomView;
  eu: string;
  chat: ChatMessage[];
  naoLidas: number;
  selecionada: string | null;
  enviar: Enviar;
  aoSelecionar: (tileId: string | null) => void;
  aoAbrirRegras: () => void;
  aoSair: () => void;
  aoLerChat: () => void;
}) {
  const m = sala.match!;
  const agora = useAgora();
  const [chatAberto, setChatAberto] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const porId = new Map(sala.players.map((p) => [p.id, p]));
  const souHost = sala.hostId === eu;
  const euSentado = m.playerOrder.includes(eu);
  const minhaVez = m.vez === eu && sala.status === 'EM_PARTIDA';
  const equipeDe = (id: string) => m.equipes.findIndex((e) => e.includes(id));
  const comEquipes = m.equipes.some((e) => e.length > 1);

  // Quem senta onde, a partir de mim (ou do primeiro, para quem assiste).
  const base = euSentado ? m.playerOrder.indexOf(eu) : 0;
  const n = m.playerOrder.length;
  const rodados = m.playerOrder.map((_, i) => m.playerOrder[(base + i) % n]!);
  const outros = euSentado ? rodados.slice(1) : rodados;
  // Sentido anti-horário: o próximo a jogar senta à direita.
  const posicoes: Record<number, ('direita' | 'topo' | 'esquerda')[]> = {
    1: ['topo'],
    2: ['direita', 'esquerda'],
    3: ['direita', 'topo', 'esquerda'],
  };
  const lugares = posicoes[outros.length] ?? [];

  const legais = m.jogadasLegais;
  const jogaveis = new Set(legais.map((j) => j.tileId));
  const alvos = selecionada ? legais.filter((j) => j.tileId === selecionada && j.endId !== null).map((j) => j.endId!) : [];

  const jogar = (tileId: string, endId: string | null) => {
    aoSelecionar(null);
    enviar('move:play', { matchId: m.matchId, mao: m.maoNumero, tileId, endId });
  };

  const tocarPedra = (tileId: string) => {
    if (!minhaVez || !jogaveis.has(tileId)) return;
    const opcoes = legais.filter((j) => j.tileId === tileId);
    // Uma ponta só (ou a mesa vazia): joga direto. Mais de uma: escolhe na mesa.
    const pontasDistintas = new Set(opcoes.map((o) => o.endId));
    if (pontasDistintas.size === 1) {
      jogar(tileId, opcoes[0]!.endId);
      return;
    }
    aoSelecionar(selecionada === tileId ? null : tileId);
  };

  const ultimaJogada = [...m.log].reverse().find((l) => l.tipo === 'JOGOU');
  const ultimaIdx = ultimaJogada ? m.mesa.find((p) => p.tileId === ultimaJogada.tileId)?.idx ?? null : null;

  const prazo = sala.phaseDeadline;
  const total = m.fase === 'FIM_DA_MAO' ? LIMITS.fimDaMaoMs : LIMITS.playTimeoutMs;
  const restante = prazo ? Math.max(0, prazo - agora) : 0;

  const placar = (
    <div className="linha" style={{ gap: 6, flexWrap: 'wrap' }}>
      {m.equipes.map((e, i) => (
        <span
          key={i}
          className="chip"
          style={{ boxShadow: `inset 0 0 0 1px ${comEquipes ? COR_EQUIPE[i] : 'var(--linha)'}` }}
          title={nomeDaEquipe(e, porId, eu)}
        >
          {comEquipes ? (
            <span style={{ color: COR_EQUIPE[i], fontWeight: 600 }}>{e.includes(eu) ? 'Nós' : 'Eles'}</span>
          ) : (
            <Avatar avatar={porId.get(e[0]!)?.avatar ?? { emoji: '🦊', color: 'amber' }} tamanho={18} />
          )}
          <strong style={{ color: 'var(--texto)' }}>{m.placar[i]}</strong>
        </span>
      ))}
      <span className="fraco" style={{ fontSize: 12 }}>até {m.options.meta}</span>
    </div>
  );

  const cartaoDe = (id: string, lugar: string) => {
    const p = porId.get(id);
    const naVez = m.vez === id;
    const eq = equipeDe(id);
    return (
      <div
        key={id}
        className={`cartao ${naVez ? 'na-vez' : ''}`}
        style={{
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          minWidth: 0,
          borderColor: comEquipes ? COR_EQUIPE[eq] : undefined,
          gridArea: lugar,
        }}
      >
        <div className="linha" style={{ gap: 6, minWidth: 0, maxWidth: '100%' }}>
          {p && <Avatar avatar={p.avatar} tamanho={26} />}
          <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p?.nickname ?? 'saiu'}
          </span>
        </div>
        <div className="linha" style={{ gap: 2, flexWrap: 'wrap', justifyContent: 'center' }} aria-label={`${m.contagem[id] ?? 0} pedras`}>
          {Array.from({ length: Math.min(m.contagem[id] ?? 0, 12) }, (_, i) => <CostasDaPedra key={i} largura={8} />)}
          <span className="fraco" style={{ fontSize: 11, marginLeft: 4 }}>{m.contagem[id]}</span>
        </div>
        <span className="fraco" style={{ fontSize: 11 }}>
          {p?.connection === 'DESCONECTADO' ? 'caiu' : p?.bot ? 'bot' : p?.emSegundoPlano ? 'fora da tela' : comEquipes && eq === equipeDe(eu) ? 'parceiro' : naVez ? 'jogando…' : ' '}
        </span>
      </div>
    );
  };

  const fim = m.fase === 'FIM_DA_MAO' ? m.resultado : null;
  const partidaAcabou = sala.status === 'FIM_DE_PARTIDA';

  return (
    <div className="mesa-layout">
      <div className="pilha" style={{ gap: 10, minWidth: 0 }}>
        <header className="linha" style={{ justifyContent: 'space-between', gap: 8 }}>
          {placar}
          <div className="linha" style={{ gap: 4 }}>
            <button className="fantasma mesa-chat-botao" onClick={() => { setChatAberto(true); aoLerChat(); }} style={{ padding: '0 10px', position: 'relative' }} aria-label="Abrir chat">
              💬
              {naoLidas > 0 && (
                <span style={{ position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, background: 'var(--vidas)', color: '#fff', fontSize: 10, display: 'grid', placeItems: 'center' }}>
                  {naoLidas}
                </span>
              )}
            </button>
            <button className="fantasma" onClick={() => setMenuAberto(true)} style={{ padding: '0 10px' }} aria-label="Menu">☰</button>
          </div>
        </header>

        {euSentado ? (
          <div
            style={{
              display: 'grid',
              gridTemplateAreas: n <= 2 ? '". topo ."' : '"esquerda topo direita"',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 6,
            }}
          >
            {outros.map((id, i) => cartaoDe(id, lugares[i] ?? 'topo'))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)`, gap: 6 }}>
            {outros.map((id) => cartaoDe(id, 'auto'))}
          </div>
        )}

        <div className="feltro" style={{ height: 'min(52dvh, 460px)', minHeight: 240 }}>
          <MesaDesenhada mesa={m.mesa} alvos={alvos} aoEscolherAlvo={(endId) => selecionada && jogar(selecionada, endId)} ultima={ultimaIdx} />
          <div className="linha" style={{ position: 'absolute', left: 8, bottom: 8, gap: 6 }}>
            {m.monte > 0 && <span className="chip">monte {m.monte}</span>}
            {m.options.modo === 'MULTIPLO_DE_5' && m.mesa.length > 0 && (
              <span className="chip" style={{ color: m.soma % 5 === 0 ? 'var(--ponto)' : undefined }}>pontas {m.soma}</span>
            )}
            <span className="chip">mão {m.maoNumero}</span>
          </div>
          {sala.status === 'PAUSADA' && <Pausa sala={sala} eu={eu} agora={agora} enviar={enviar} porId={porId} />}
          {fim && !partidaAcabou && (
            <FimDaMao view={m} porId={porId} eu={eu} />
          )}
        </div>

        {prazo && sala.status === 'EM_PARTIDA' && (
          <div aria-hidden style={{ height: 4, borderRadius: 2, background: 'var(--superficie-2)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, (restante / total) * 100)}%`, background: minhaVez && restante < 8000 ? 'var(--vidas)' : 'var(--acento)', transition: 'width 250ms linear' }} />
          </div>
        )}

        {euSentado && !partidaAcabou && (
          <section className={`cartao ${minhaVez ? 'na-vez' : ''}`} style={{ padding: 8, borderColor: comEquipes ? COR_EQUIPE[equipeDe(eu)] : undefined }}>
            <div className="linha" style={{ justifyContent: 'space-between', padding: '0 4px' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {minhaVez
                  ? selecionada ? 'Escolha a ponta na mesa' : m.pedraObrigatoria ? 'Comece pela maior carroça' : 'Sua vez'
                  : m.vez ? `Vez de ${porId.get(m.vez)?.nickname ?? '…'}` : fim ? 'Fim da mão' : ''}
              </span>
              {minhaVez && <span className="fraco" style={{ fontSize: 12 }}>{Math.ceil(restante / 1000)}s</span>}
            </div>
            <div className="mao">
              {m.minhaMao.map((t) => {
                const pode = minhaVez && jogaveis.has(t);
                return (
                  <button
                    key={t}
                    className={`pedra-botao ${pode ? 'jogavel' : ''} ${selecionada === t ? 'selecionada' : ''}`}
                    disabled={!pode}
                    onClick={() => tocarPedra(t)}
                    aria-pressed={selecionada === t}
                  >
                    <Pedra tileId={t} largura={30} destaque={selecionada === t} />
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {!euSentado && !partidaAcabou && <p className="fraco" style={{ textAlign: 'center' }}>Você está assistindo. Entra na próxima partida.</p>}

        {partidaAcabou && <FimDaPartida sala={sala} m={m} eu={eu} porId={porId} souHost={souHost} enviar={enviar} aoSair={aoSair} />}

        <Historico view={m} porId={porId} eu={eu} />
      </div>

      <aside className="mesa-lateral">
        <div className="cartao pilha mesa-chat-lateral" style={{ gap: 8 }}>
          <span className="rotulo">conversa</span>
          <Chat mensagens={chat} jogadores={sala.players} eu={eu} silenciado={porId.get(eu)?.silenciado ?? false} aoEnviar={(text) => enviar('chat:send', { text })} altura={360} />
        </div>
      </aside>

      {chatAberto && (
        <Gaveta titulo="Conversa" aoFechar={() => { setChatAberto(false); aoLerChat(); }}>
          <Chat mensagens={chat} jogadores={sala.players} eu={eu} silenciado={porId.get(eu)?.silenciado ?? false} aoEnviar={(text) => enviar('chat:send', { text })} altura={320} />
        </Gaveta>
      )}

      {menuAberto && (
        <Gaveta titulo={`Sala ${sala.code}`} aoFechar={() => setMenuAberto(false)}>
          <div className="pilha" style={{ gap: 10 }}>
            <p className="fraco">
              {m.options.modo === 'BATIDA' ? 'Batida' : 'Múltiplo de 5'} até {m.options.meta}
              {m.options.carrocasAbrem ? ' · carroças abrem' : ''}
              {comEquipes ? ' · duplas' : ''}
            </p>
            <button className="fantasma" onClick={() => { setMenuAberto(false); aoAbrirRegras(); }}>Regras</button>
            {souHost && !partidaAcabou && (
              <button className="perigo" onClick={() => { setMenuAberto(false); enviar('host:endMatch'); }}>Encerrar partida</button>
            )}
            <button className="perigo" onClick={aoSair}>Sair da mesa</button>
            {euSentado && !partidaAcabou && <p className="fraco" style={{ fontSize: 12 }}>Se você sair, um bot assume suas pedras e a partida segue.</p>}
          </div>
        </Gaveta>
      )}
    </div>
  );
}

function Pausa({ sala, eu, agora, enviar, porId }: {
  sala: RoomView; eu: string; agora: number; enviar: Enviar; porId: Map<string, PublicPlayer>;
}) {
  const pausa = sala.pause!;
  const nomes = pausa.absentPlayerIds.map((id) => porId.get(id)?.nickname ?? 'alguém').join(', ');
  const liberada = agora >= pausa.decisionUnlockedAt;
  const souHost = sala.hostId === eu;
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(4,6,12,0.82)', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="pilha" style={{ gap: 10, textAlign: 'center', maxWidth: 320 }}>
        <strong style={{ fontSize: 18 }}>Partida pausada</strong>
        <p>Esperando {nomes} voltar.</p>
        {!liberada ? (
          <p className="fraco">Decisão liberada em {Math.ceil((pausa.decisionUnlockedAt - agora) / 1000)}s</p>
        ) : souHost ? (
          <div className="pilha" style={{ gap: 8 }}>
            <button onClick={() => enviar('host:resolveAbsence', { action: 'BOT_ASSUME' })}>Um bot assume</button>
            <button className="perigo" onClick={() => enviar('host:resolveAbsence', { action: 'ENCERRAR' })}>Encerrar partida</button>
          </div>
        ) : (
          <p className="fraco">O anfitrião decide se um bot assume.</p>
        )}
        <p className="fraco" style={{ fontSize: 12 }}>A partida acaba sozinha em {Math.max(0, Math.ceil((pausa.hardDeadline - agora) / 60_000))} min.</p>
      </div>
    </div>
  );
}

function FimDaMao({ view, porId, eu }: { view: MatchView; porId: Map<string, PublicPlayer>; eu: string }) {
  const r = view.resultado!;
  const nome = (id: string | null) => (id === null ? 'Ninguém' : id === eu ? 'Você' : porId.get(id)?.nickname ?? 'Alguém');
  const titulo = r.tipo === 'BATIDA'
    ? `${nome(r.vencedorId)} bateu${r.batida ? ` (${NOME_BATIDA[r.batida]})` : ''}`
    : r.tipo === 'TRANCADA' ? 'Jogo trancado' : 'Fim de jogo';
  const sub = r.pontos > 0
    ? `+${r.pontos} ${r.pontos === 1 ? 'ponto' : 'pontos'} para ${r.equipeVencedora !== null && view.equipes[r.equipeVencedora]!.length > 1 ? 'a dupla de ' : ''}${nome(r.vencedorId)}`
    : view.options.modo === 'MULTIPLO_DE_5' ? 'No múltiplo de 5, a mão só recomeça.' : 'Empate: ninguém pontua.';
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(4,6,12,0.93)', overflowY: 'auto', padding: 14 }}>
      <div className="pilha" style={{ gap: 10, alignItems: 'center', textAlign: 'center' }}>
        <strong style={{ fontSize: 20 }}>{titulo}</strong>
        <span style={{ color: r.pontos > 0 ? 'var(--ponto)' : 'var(--texto-fraco)' }}>{sub}</span>
        <div className="pilha" style={{ gap: 6, width: '100%' }}>
          {view.playerOrder.map((id) => (
            <div key={id} className="linha" style={{ gap: 8, justifyContent: 'space-between' }}>
              <span className="linha" style={{ gap: 6, minWidth: 0 }}>
                {porId.get(id) && <Avatar avatar={porId.get(id)!.avatar} tamanho={22} />}
                <span style={{ fontSize: 13 }}>{nome(id)}</span>
              </span>
              <span className="linha" style={{ gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {(r.maos[id] ?? []).map((t) => <Pedra key={t} tileId={t} largura={12} deitada />)}
                <span className="fraco" style={{ fontSize: 12, minWidth: 24, textAlign: 'right' }}>{r.somas[id]}</span>
              </span>
            </div>
          ))}
        </div>
        <span className="fraco" style={{ fontSize: 12 }}>A próxima mão já vem.</span>
      </div>
    </div>
  );
}

function FimDaPartida({ sala, m, eu, porId, souHost, enviar, aoSair }: {
  sala: RoomView; m: MatchView; eu: string; porId: Map<string, PublicPlayer>; souHost: boolean; enviar: Enviar; aoSair: () => void;
}) {
  const venci = m.vencedores?.includes(eu) ?? false;
  const nomes = (m.vencedores ?? []).map((id) => (id === eu ? 'Você' : porId.get(id)?.nickname ?? 'Alguém'));
  const ordem = m.equipes.map((e, i) => ({ e, i, p: m.placar[i]! })).sort((a, b) => b.p - a.p);
  return (
    <section className="cartao pilha" style={{ gap: 12, textAlign: 'center' }}>
      <strong style={{ fontSize: 22 }}>
        {m.endReason === 'META'
          ? venci ? 'Vitória! 🎉' : `${nomes.join(' e ')} ${nomes.length > 1 ? 'venceram' : 'venceu'}`
          : m.endReason === 'ENCERRADA_POR_AUSENCIA' ? 'Partida encerrada por ausência' : 'Partida encerrada'}
      </strong>
      <div className="pilha" style={{ gap: 6 }}>
        {ordem.map(({ e, i, p }) => (
          <div key={i} className="linha" style={{ justifyContent: 'space-between' }}>
            <span>{nomeDaEquipe(e, porId, eu)}</span>
            <strong>{p}</strong>
          </div>
        ))}
      </div>
      {souHost ? (
        <div className="linha">
          <button style={{ flex: 1 }} onClick={() => enviar('host:rematch')}>Revanche</button>
          <button className="fantasma" onClick={() => enviar('host:toLobby')}>Arrumar a mesa</button>
        </div>
      ) : (
        <p className="fraco">Esperando {porId.get(sala.hostId ?? '')?.nickname ?? 'o anfitrião'} decidir a revanche.</p>
      )}
      <button className="fantasma" onClick={aoSair}>Sair</button>
    </section>
  );
}

function Historico({ view, porId, eu }: { view: MatchView; porId: Map<string, PublicPlayer>; eu: string }) {
  const nome = (id: string | null) => (id === null ? '' : id === eu ? 'Você' : porId.get(id)?.nickname ?? 'Alguém');
  const linhas = [...view.log].reverse().slice(0, 6).map((l) => {
    switch (l.tipo) {
      case 'JOGOU': return `${nome(l.playerId)} jogou ${l.tileId?.replace('-', ':')}`;
      case 'COMPROU': return `${nome(l.playerId)} comprou ${l.quantidade}`;
      case 'PASSOU': return `${nome(l.playerId)} passou`;
      case 'PONTUOU': return `${nome(l.playerId)} fez ${l.pontos} pontos`;
      case 'BATEU': return `${nome(l.playerId)} bateu`;
      case 'TRANCOU': return 'Jogo trancado';
      case 'NOVA_MAO': return `Mão ${l.mao}: ${nome(l.playerId)} começa`;
      default: return '';
    }
  });
  if (linhas.length === 0) return null;
  return (
    <details className="cartao" style={{ padding: '8px 12px' }}>
      <summary className="fraco" style={{ cursor: 'pointer' }}>{linhas[0]}</summary>
      <ul style={{ listStyle: 'none', marginTop: 6 }} className="pilha">
        {linhas.slice(1).map((t, i) => <li key={i} className="fraco">{t}</li>)}
      </ul>
    </details>
  );
}
