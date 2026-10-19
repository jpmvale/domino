import type { Avatar as AvatarProto } from '@domino/protocol';

/** Cor E emoji, sempre os dois: a cor sozinha não identifica ninguém. */
export function Avatar({ avatar, tamanho = 34 }: { avatar: AvatarProto | { emoji: string; color: string }; tamanho?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: tamanho,
        height: tamanho,
        flex: `0 0 ${tamanho}px`,
        borderRadius: tamanho / 3,
        background: `var(--avatar-${avatar.color})`,
        display: 'grid',
        placeItems: 'center',
        fontSize: tamanho * 0.55,
      }}
    >
      {avatar.emoji}
    </span>
  );
}
