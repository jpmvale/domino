import { useEffect, type ReactNode } from 'react';

/** Folha que sobe de baixo no celular e vira modal no desktop. Esc fecha. */
export function Gaveta({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [aoFechar]);
  return (
    <div className="gaveta-fundo" onClick={aoFechar}>
      <div className="gaveta" role="dialog" aria-modal="true" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <div className="linha" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>{titulo}</h2>
          <button className="fantasma" onClick={aoFechar} aria-label="Fechar" style={{ minHeight: 36, padding: '0 12px' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
