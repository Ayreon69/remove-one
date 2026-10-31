// Briques d'interface communes : boutons, fenêtres, pastilles, sélecteurs, logo, avatars et mur de béton.
import { X } from 'lucide-react';
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cls } from '../lib/util';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'soft';
  icon?: ReactNode;
}

export function Button({ variant = 'default', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cls('btn', `btn-${variant}`, className)} {...rest}>
      {icon}
      {children && <span className="btn-label">{children}</span>}
    </button>
  );
}

/** Le titre : « REMOVE » peint au pochoir, et « ONE » sur une étiquette orange, percée comme une plaque de matricule. */
export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={cls('logo', `logo-${size}`)} role="img" aria-label="Remove One">
      <span className="logo-remove" aria-hidden>
        REMOVE
      </span>
      <span className="logo-one" aria-hidden>
        <i className="logo-hole" />
        ONE
      </span>
    </div>
  );
}

/** Le décor : un mur de béton banché, ses joints et ses trous de banche. */
export function Backdrop({ children, className, quiet = false }: { children: ReactNode; className?: string; quiet?: boolean }) {
  return (
    <div className={cls('backdrop', quiet && 'is-quiet', className)}>
      <div className="wall" aria-hidden>
        {!quiet && (
          <>
            <span className="wall-mark is-a">CELLULE 07</span>
            <span className="wall-mark is-b">D-1</span>
            <span className="wall-tally" />
          </>
        )}
      </div>
      <div className="backdrop-body">{children}</div>
    </div>
  );
}

export function Pill({ tone, children, className }: { tone?: 'orange' | 'ink' | 'steel' | 'plate'; children: ReactNode; className?: string }) {
  return <span className={cls('pill', tone && `pill-${tone}`, className)}>{children}</span>;
}

interface SegmentedOption<T> {
  value: T;
  label: string;
  sub?: string;
  disabled?: boolean;
}

export function Segmented<T extends string | number | boolean>({ options, value, onChange, disabled, label }: { options: SegmentedOption<T>[]; value: T; onChange: (v: T) => void; disabled?: boolean; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled || o.disabled}
          className={cls('seg', o.value === value && 'is-on')}
          onClick={() => onChange(o.value)}
        >
          <b>{o.label}</b>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

/**
 * Une fenêtre, rendue à la racine du document pour ne dépendre d'aucun parent.
 * Elle s'ouvre avec un petit mouvement en CSS et se ferme d'un coup.
 */
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => box.current?.querySelector<HTMLElement>('[data-autofocus], .modal-body button, .modal-body input')?.focus({ preventScroll: true }), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      before?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="modal-back" onClick={onClose}>
      <div ref={box} className={cls('modal', wide && 'is-wide')} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Fermer" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export const AVATAR_EMOJI: Record<string, string> = {
  renard: '🦊',
  loup: '🐺',
  chouette: '🦉',
  serpent: '🐍',
  raton: '🦝',
  rat: '🐀',
  aigle: '🦅',
  sanglier: '🐗',
  requin: '🦈',
  ours: '🐻',
  scorpion: '🦂',
  crocodile: '🐊',
};

export const AVATAR_LABELS: Record<string, string> = {
  renard: 'Renard',
  loup: 'Loup',
  chouette: 'Chouette',
  serpent: 'Serpent',
  raton: 'Raton laveur',
  rat: 'Rat',
  aigle: 'Aigle',
  sanglier: 'Sanglier',
  requin: 'Requin',
  ours: 'Ours',
  scorpion: 'Scorpion',
  crocodile: 'Crocodile',
};

export function Avatar({ avatar, className }: { avatar: string; className?: string }) {
  return (
    <span className={cls('avatar', className)} aria-hidden>
      {AVATAR_EMOJI[avatar] ?? '🦊'}
    </span>
  );
}

/** Les jetons de victoire : de petites pastilles orange, comptées une à une. */
export function Tokens({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span className={cls('tokens', className)} aria-label={`${n} jeton${n > 1 ? 's' : ''}`} title={`${n} jeton${n > 1 ? 's' : ''} de victoire`}>
      {n <= 5 ? Array.from({ length: n }, (_, i) => <i key={i} />) : (
        <>
          <i />×{n}
        </>
      )}
    </span>
  );
}
