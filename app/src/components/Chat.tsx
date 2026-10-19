import { useEffect, useRef, useState } from 'react';
import { LIMITS, type ChatMessage, type PublicPlayer } from '@domino/protocol';

/**
 * O chat da sala. No lobby e na mesa, com o histórico que a sala guarda.
 * Quem assiste aparece marcado: na mesa, palpite de quem está de fora é outra
 * coisa.
 */
export function Chat({
  mensagens, jogadores, eu, aoEnviar, silenciado, altura = 260,
}: {
  mensagens: ChatMessage[];
  jogadores: PublicPlayer[];
  eu: string | null;
  aoEnviar: (texto: string) => void;
  silenciado: boolean;
  altura?: number;
}) {
  const [texto, setTexto] = useState('');
  const lista = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length]);

  const corDe = (playerId: string) =>
    jogadores.find((p) => p.id === playerId)?.avatar.color ?? 'amber';

  const enviar = () => {
    const t = texto.trim();
    if (!t) return;
    aoEnviar(t);
    setTexto('');
  };

  return (
    <div className="pilha" style={{ gap: 8 }}>
      <div
        ref={lista}
        aria-live="polite"
        style={{
          height: altura,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: 8,
          background: 'var(--poco)',
          borderRadius: 'var(--r-md)',
          border: '1px solid var(--linha)',
        }}
      >
        {mensagens.length === 0 && <span className="fraco" style={{ margin: 'auto' }}>Ninguém falou nada ainda.</span>}
        {mensagens.map((m) => (
          <div key={m.id} style={{ fontSize: 14, lineHeight: 1.35, overflowWrap: 'anywhere' }}>
            <strong style={{ color: `var(--avatar-${corDe(m.playerId)})`, fontWeight: 600 }}>
              {m.playerId === eu ? 'Você' : m.nickname}
            </strong>
            {m.spectator && <span className="fraco" style={{ fontSize: 11 }}> (assistindo)</span>}
            <span style={{ color: 'var(--texto-fraco)' }}>: </span>
            {m.text}
          </div>
        ))}
      </div>
      <form
        className="linha"
        onSubmit={(e) => { e.preventDefault(); enviar(); }}
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value.slice(0, LIMITS.chatTextMax))}
          placeholder={silenciado ? 'O anfitrião silenciou você' : 'Mensagem'}
          disabled={silenciado}
          aria-label="Mensagem para a sala"
          maxLength={LIMITS.chatTextMax}
        />
        <button type="submit" disabled={silenciado || texto.trim().length === 0}>Enviar</button>
      </form>
    </div>
  );
}
