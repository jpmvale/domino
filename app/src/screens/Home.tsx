import { useState } from 'react';
import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  NICKNAME_MAX,
  NICKNAME_MIN,
  ROOM_CODE_LENGTH,
  type Avatar as AvatarProto,
} from '@domino/protocol';
import { Avatar } from '../components/Avatar';
import { Pedra } from '../components/Pedra';
import type { Identidade } from '../net/sessao';

/**
 * A porta de entrada: quem você é e para que mesa vai. Uma tela só — entre o
 * link e a mesa, o mínimo de toques.
 */
export function Home({
  codigoDoConvite, identidade, ocupado, aoCriar, aoEntrar, aoAbrirRegras,
}: {
  codigoDoConvite: string | null;
  identidade: Identidade | null;
  ocupado: boolean;
  aoCriar: (i: Identidade) => void;
  aoEntrar: (codigo: string, i: Identidade) => void;
  aoAbrirRegras: () => void;
}) {
  const [nickname, setNickname] = useState(identidade?.nickname ?? '');
  const [avatar, setAvatar] = useState<AvatarProto>(
    (identidade?.avatar as AvatarProto | undefined) ?? {
      emoji: AVATAR_EMOJIS[Math.floor(Math.random() * 8)]!,
      color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!,
    },
  );
  const [codigo, setCodigo] = useState(codigoDoConvite ?? '');
  const [escolhendo, setEscolhendo] = useState(false);

  const apelidoOk = nickname.trim().length >= NICKNAME_MIN && nickname.trim().length <= NICKNAME_MAX;
  const codigoOk = codigo.length === ROOM_CODE_LENGTH;
  const eu: Identidade = { nickname: nickname.trim(), avatar };

  return (
    <div className="pilha" style={{ gap: 18 }}>
      <header className="linha" style={{ justifyContent: 'space-between', paddingTop: 16 }}>
        <div className="pilha" style={{ gap: 6 }}>
          <h1 style={{ fontSize: 42, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1 }}>Dominó</h1>
          <span className="fraco">Batida ou múltiplo de 5 · 2 a 4 pessoas</span>
        </div>
        <div className="linha" aria-hidden style={{ gap: 4, transform: 'rotate(-8deg)' }}>
          <Pedra tileId="6-6" largura={22} />
          <Pedra tileId="5-0" largura={22} />
        </div>
      </header>

      <section className="cartao pilha" style={{ gap: 12 }}>
        <span className="rotulo">quem é você na mesa</span>
        <div className="linha" style={{ gap: 10 }}>
          <button
            className="fantasma"
            onClick={() => setEscolhendo((v) => !v)}
            aria-label="Trocar avatar"
            aria-expanded={escolhendo}
            style={{ padding: 4, minHeight: 0, borderRadius: 14 }}
          >
            <Avatar avatar={avatar} tamanho={44} />
          </button>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value.slice(0, NICKNAME_MAX))}
            placeholder="Seu apelido"
            aria-label="Seu apelido"
            autoComplete="nickname"
            maxLength={NICKNAME_MAX}
          />
        </div>
        {escolhendo && (
          <div className="pilha" style={{ gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
              {AVATAR_EMOJIS.map((e) => (
                <button
                  key={e}
                  className="fantasma"
                  aria-pressed={avatar.emoji === e}
                  onClick={() => setAvatar({ ...avatar, emoji: e })}
                  style={{
                    minHeight: 38, padding: 0, fontSize: 20,
                    boxShadow: avatar.emoji === e ? 'inset 0 0 0 2px var(--acento)' : undefined,
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6 }}>
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`cor ${c}`}
                  aria-pressed={avatar.color === c}
                  onClick={() => setAvatar({ ...avatar, color: c })}
                  style={{
                    minHeight: 32, padding: 0, background: `var(--avatar-${c})`,
                    boxShadow: avatar.color === c ? '0 0 0 2px var(--fundo), 0 0 0 4px var(--texto)' : undefined,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {codigoDoConvite ? (
        <section className="pilha" style={{ gap: 10 }}>
          <p style={{ fontSize: 16 }}>
            Você foi chamado para a mesa <strong style={{ letterSpacing: '0.12em' }}>{codigoDoConvite}</strong>.
          </p>
          <button
            style={{ height: 52 }}
            disabled={!apelidoOk || ocupado}
            onClick={() => aoEntrar(codigoDoConvite, eu)}
          >
            Entrar na mesa
          </button>
          <button className="fantasma" disabled={!apelidoOk || ocupado} onClick={() => aoCriar(eu)}>
            Criar outra sala
          </button>
        </section>
      ) : (
        <>
          <button style={{ height: 52 }} disabled={!apelidoOk || ocupado} onClick={() => aoCriar(eu)}>
            Criar sala
          </button>
          <div className="linha" style={{ gap: 10 }}>
            <span style={{ flex: 1, height: 1, background: 'var(--linha)' }} />
            <span className="fraco">ou entre com o código</span>
            <span style={{ flex: 1, height: 1, background: 'var(--linha)' }} />
          </div>
          <div className="linha">
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH))}
              placeholder="ABCDE"
              aria-label="Código da sala"
              autoCapitalize="characters"
              style={{ letterSpacing: '0.3em', fontWeight: 600, textAlign: 'center' }}
            />
            <button className="fantasma" disabled={!apelidoOk || !codigoOk || ocupado} onClick={() => aoEntrar(codigo, eu)}>
              Entrar
            </button>
          </div>
        </>
      )}

      {!apelidoOk && nickname.length > 0 && (
        <span className="fraco">O apelido precisa ter de {NICKNAME_MIN} a {NICKNAME_MAX} letras.</span>
      )}

      <button className="fantasma" onClick={aoAbrirRegras}>Como se joga</button>
    </div>
  );
}
