import type { EstadoConexao } from '../net/socket';

/** Faixa discreta enquanto reconecta: a mesa continua visível embaixo. */
export function FaixaConexao({ estado }: { estado: EstadoConexao }) {
  if (estado !== 'RECONECTANDO' && estado !== 'CONECTANDO') return null;
  return (
    <div
      role="status"
      style={{
        position: 'sticky', top: 0, zIndex: 15, margin: '-12px -16px 8px',
        padding: '6px 16px', textAlign: 'center', fontSize: 13,
        background: '#3a2d12', color: '#ffd88a',
      }}
    >
      {estado === 'CONECTANDO' ? 'Conectando…' : 'Conexão caiu. Reconectando…'}
    </div>
  );
}

/** Bloqueia a tela quando não adianta insistir. Sempre com uma saída. */
export function BloqueioConexao({
  estado, aoJogarAqui, aoVoltar,
}: { estado: EstadoConexao; aoJogarAqui: () => void; aoVoltar: () => void }) {
  if (estado !== 'SESSAO_ASSUMIDA' && estado !== 'ENCERRADA' && estado !== 'DESATUALIZADO') return null;
  const textos = {
    SESSAO_ASSUMIDA: ['Você abriu esta mesa em outra aba.', 'Jogar aqui'],
    ENCERRADA: ['Você não está mais nesta mesa.', null],
    DESATUALIZADO: ['Saiu uma versão nova do jogo.', 'Recarregar'],
  } as const;
  const [titulo, acao] = textos[estado];
  return (
    <div className="gaveta-fundo" style={{ alignItems: 'center' }}>
      <div className="cartao pilha" style={{ maxWidth: 360, margin: 16, textAlign: 'center' }}>
        <p style={{ fontSize: 17, fontWeight: 600 }}>{titulo}</p>
        {acao && (
          <button onClick={estado === 'DESATUALIZADO' ? () => location.reload() : aoJogarAqui}>{acao}</button>
        )}
        <button className="fantasma" onClick={aoVoltar}>Voltar ao início</button>
      </div>
    </div>
  );
}
