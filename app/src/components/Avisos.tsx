import type { Aviso } from '../state/loja';

/** Os avisos de passagem: quem pontuou, quem passou, o que deu errado. */
export function Avisos({ avisos }: { avisos: Aviso[] }) {
  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed', top: 10, left: 0, right: 0, zIndex: 30,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, pointerEvents: 'none',
      }}
    >
      {avisos.map((a) => (
        <div
          key={a.id}
          className="aviso"
          style={{
            maxWidth: 'calc(100% - 32px)',
            padding: '8px 14px',
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 500,
            background: a.tipo === 'erro' ? '#3a1820' : a.tipo === 'ponto' ? '#3a2d12' : 'var(--superficie-2)',
            color: a.tipo === 'erro' ? '#ffb3bb' : a.tipo === 'ponto' ? '#ffd88a' : 'var(--texto)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.35), inset 0 0 0 1px var(--linha)',
          }}
        >
          {a.texto}
        </div>
      ))}
    </div>
  );
}
