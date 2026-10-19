import { useCallback, useEffect, useRef, useState } from 'react';
import { PROTOCOL_VERSION, type ChatMessage, type RoomView } from '@domino/protocol';
import type { Lance } from '@domino/rules';
import { conectar, type Conexao } from './net/socket';
import * as sessao from './net/sessao';
import { frase } from './net/mensagens';
import { avisar, definir, errar, ler, pontuou, useEstado } from './state/loja';
import { Avisos } from './components/Avisos';
import { BloqueioConexao, FaixaConexao } from './components/Conexao';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Mesa } from './screens/Mesa';
import { Regras } from './screens/Regras';

const NOME_BATIDA: Record<string, string> = {
  SIMPLES: 'batida simples', CARROCA: 'batida de carroça', LA_E_LO: 'lá-e-lô', CRUZADA: 'cruzada',
};

export function App() {
  const estado = useEstado();
  const conexao = useRef<Conexao | null>(null);
  const ultimoLance = useRef<{ matchId: string; seq: number } | null>(null);
  const chatVisivel = useRef(false);
  const [regras, setRegras] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [convite, setConvite] = useState<string | null>(() => sessao.codigoDoConvite());

  const nomeDe = (sala: RoomView, id: string | null): string => {
    if (id === null) return 'Alguém';
    if (id === ler().eu) return 'Você';
    return sala.players.find((p) => p.id === id)?.nickname ?? 'Alguém';
  };

  /** Os avisos de passagem saem do histórico da mão: o que é novo desde o último retrato. */
  const narrar = (sala: RoomView) => {
    const m = sala.match;
    if (!m) { ultimoLance.current = null; return; }
    const anterior = ultimoLance.current;
    const ultimo = m.log.at(-1)?.seq ?? 0;
    ultimoLance.current = { matchId: m.matchId, seq: Math.max(ultimo, anterior?.matchId === m.matchId ? anterior.seq : 0) };
    if (!anterior || anterior.matchId !== m.matchId) return;
    const novos: Lance[] = m.log.filter((l) => l.seq > anterior.seq);
    for (const l of novos) {
      const quem = nomeDe(sala, l.playerId);
      if (l.tipo === 'PONTUOU') pontuou(`${quem} fez ${l.pontos} pontos!`);
      else if (l.tipo === 'BATEU') {
        const tipo = m.resultado?.batida ? NOME_BATIDA[m.resultado.batida] : null;
        pontuou(`${quem} bateu${tipo ? ` (${tipo})` : ''}${l.pontos ? ` +${l.pontos}` : ''}`);
      } else if (l.tipo === 'TRANCOU') avisar('O jogo trancou!');
      else if (l.tipo === 'PASSOU') avisar(`${quem} passou`);
      else if (l.tipo === 'COMPROU') avisar(`${quem} comprou ${l.quantidade}`);
    }
  };

  const voltarAoInicio = useCallback(() => {
    const codigo = ler().codigo;
    if (codigo) sessao.esquecer(codigo);
    sessao.esquecerUltima();
    conexao.current?.fechar();
    conexao.current = null;
    history.replaceState(null, '', '/');
    setConvite(null);
    definir({ tela: 'home', sala: null, chat: [], codigo: null, eu: null, conexao: 'CONECTADO', selecionada: null, naoLidas: 0 });
  }, []);

  const receber = (msg: { type: string; payload: unknown; stateVersion?: number }) => {
    switch (msg.type) {
      case 'room:snapshot': {
        const { chat, ...sala } = msg.payload as RoomView & { chat: ChatMessage[] };
        narrar(sala);
        definir({ sala, chat });
        break;
      }
      case 'room:state': {
        const sala = msg.payload as RoomView;
        const atual = ler().sala;
        if (atual && sala.stateVersion < atual.stateVersion) break;
        narrar(sala);
        const sel = ler().selecionada;
        definir({ sala, selecionada: sel && sala.match?.minhaMao.includes(sel) && sala.match.vez === ler().eu ? sel : null });
        break;
      }
      case 'chat:message': {
        const { message } = msg.payload as { message: ChatMessage };
        const atual = ler();
        definir({
          chat: [...atual.chat, message].slice(-200),
          naoLidas: chatVisivel.current || message.playerId === atual.eu ? atual.naoLidas : atual.naoLidas + 1,
        });
        break;
      }
      case 'system:notice': {
        const { code, params } = msg.payload as { code: string; params?: Record<string, unknown> };
        const sala = ler().sala;
        if (code === 'BOT_ASSUMIU') avisar(`Um bot assumiu as pedras de ${String(params?.apelido)}`);
        else if (code === 'JOGADA_AUTOMATICA' && sala) avisar(`${nomeDe(sala, String(params?.playerId))} demorou: jogada automática`);
        else if (code === 'EXPULSO') avisar(`${String(params?.apelido)} foi expulso`);
        else if (code === 'NOVO_HOST' && sala) avisar(`${nomeDe(sala, String(params?.hostId))} agora é o anfitrião`);
        break;
      }
      case 'error': {
        const { code, params } = msg.payload as { code: string; params?: { motivo?: string } };
        if (code === 'INVALID_TOKEN' || code === 'ROOM_NOT_FOUND') {
          if (params?.motivo === 'FORA_DA_SALA') errar('Você saiu da mesa.');
          else if (code === 'ROOM_NOT_FOUND') errar('Essa sala não existe mais.');
          voltarAoInicio();
          return;
        }
        if (code === 'SESSION_TAKEN') return;
        errar(frase(params?.motivo ?? code));
        break;
      }
      default:
        break;
    }
  };

  const entrar = (s: sessao.Sessao) => {
    sessao.guardar(s.roomCode, s.sessionToken);
    sessao.lembrarSala(s.roomCode);
    history.replaceState(null, '', `/j/${s.roomCode}`);
    ultimoLance.current = null;
    definir({ tela: 'sala', eu: s.playerId, codigo: s.roomCode, sala: null, chat: [], naoLidas: 0 });
    conexao.current?.fechar();
    conexao.current = conectar(s.wsUrl, s.sessionToken, {
      aoReceber: (m) => receber(m as never),
      aoMudarEstado: (c) => definir({ conexao: c }),
    });
  };

  useEffect(() => {
    void sessao.retomar(convite).then((s) => { if (s) entrar(s); });
    return () => conexao.current?.fechar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Versão nova no ar: o cliente velho pede para recarregar em vez de errar calado.
  useEffect(() => {
    const conferir = async () => {
      try {
        const r = await fetch('/api/health');
        const d = (await r.json()) as { protocolVersion?: number };
        if (typeof d.protocolVersion === 'number' && d.protocolVersion !== PROTOCOL_VERSION) definir({ conexao: 'DESATUALIZADO' });
      } catch { /* offline: a faixa de conexão já avisa */ }
    };
    void conferir();
    const aoVoltar = () => { if (document.visibilityState === 'visible') void conferir(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, []);

  const enviar = (tipo: string, payload?: unknown) => conexao.current?.enviar(tipo as never, payload ?? {});

  const criar = async (i: sessao.Identidade) => {
    setOcupado(true);
    sessao.guardarIdentidade(i);
    try {
      entrar(await sessao.criarSala(i));
    } catch (e) {
      errar(frase(e instanceof sessao.ErroApi ? e.codigo : 'ERRO'));
    } finally {
      setOcupado(false);
    }
  };

  const juntar = async (codigo: string, i: sessao.Identidade) => {
    setOcupado(true);
    sessao.guardarIdentidade(i);
    try {
      const token = sessao.guardado(codigo);
      const retomada = token ? await sessao.retomarSessao(codigo, token).catch(() => null) : null;
      entrar(retomada ?? await sessao.entrarNaSala(codigo, i));
    } catch (e) {
      errar(frase(e instanceof sessao.ErroApi ? e.codigo : 'ERRO'));
      if (e instanceof sessao.ErroApi && e.codigo === 'ROOM_NOT_FOUND') { setConvite(null); history.replaceState(null, '', '/'); }
    } finally {
      setOcupado(false);
    }
  };

  const sair = () => {
    enviar('player:leave');
    setTimeout(voltarAoInicio, 150);
  };

  const jogarAqui = () => {
    const codigo = estado.codigo;
    const token = codigo ? sessao.guardado(codigo) : null;
    if (!codigo || !token) return voltarAoInicio();
    void sessao.retomarSessao(codigo, token).then(entrar).catch(voltarAoInicio);
  };

  const sala = estado.sala;
  const naMesa = estado.tela === 'sala' && sala !== null && sala.match !== null && sala.status !== 'LOBBY';

  return (
    <div className={`casca ${naMesa ? 'casca--mesa' : ''}`}>
      <FaixaConexao estado={estado.tela === 'sala' ? estado.conexao : 'CONECTADO'} />
      <Avisos avisos={estado.avisos} />

      {estado.tela === 'home' && (
        <Home
          codigoDoConvite={convite}
          identidade={sessao.identidadeGuardada()}
          ocupado={ocupado}
          aoCriar={(i) => void criar(i)}
          aoEntrar={(c, i) => void juntar(c, i)}
          aoAbrirRegras={() => setRegras(true)}
        />
      )}

      {estado.tela === 'sala' && !sala && <p className="fraco" style={{ textAlign: 'center', paddingTop: 40 }}>Entrando na mesa…</p>}

      {estado.tela === 'sala' && sala && estado.eu && !naMesa && (
        <Lobby
          sala={sala}
          eu={estado.eu}
          chat={estado.chat}
          enviar={enviar}
          aoSair={sair}
          aoAbrirRegras={() => setRegras(true)}
        />
      )}

      {naMesa && estado.eu && (
        <Mesa
          sala={sala}
          eu={estado.eu}
          chat={estado.chat}
          naoLidas={estado.naoLidas}
          selecionada={estado.selecionada}
          enviar={enviar}
          aoSelecionar={(t) => definir({ selecionada: t })}
          aoAbrirRegras={() => setRegras(true)}
          aoSair={sair}
          aoLerChat={() => { chatVisivel.current = !chatVisivel.current; definir({ naoLidas: 0 }); }}
        />
      )}

      {regras && <Regras aoFechar={() => setRegras(false)} />}

      <BloqueioConexao estado={estado.tela === 'sala' ? estado.conexao : 'CONECTADO'} aoJogarAqui={jogarAqui} aoVoltar={voltarAoInicio} />
    </div>
  );
}
