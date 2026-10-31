// Une carte de Remove One : une plaque émaillée percée, numérotée au pochoir, comme un matricule.
import type { CSSProperties } from 'react';
import { cls } from '../lib/util';

export type PlateMark = 'win' | 'dupe' | 'removed' | 'played' | null;

interface PlateProps {
  value?: number | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Au repos pour cette manche, ou déjà jouée. */
  state?: 'ready' | 'rest' | 'used';
  /** Face cachée : posée, mais personne ne sait laquelle. */
  back?: boolean;
  selected?: boolean;
  mark?: PlateMark;
  className?: string;
  style?: CSSProperties;
}

export function Plate({ value = null, size = 'md', state = 'ready', back = false, selected = false, mark = null, className, style }: PlateProps) {
  if (back || value === null) {
    return (
      <span className={cls('plate', `is-${size}`, 'is-back', className)} style={style} aria-hidden>
        <i className="plate-hole" />
        <span className="plate-back-mark">?</span>
      </span>
    );
  }
  return (
    <span
      className={cls('plate', `is-${size}`, `is-${state}`, selected && 'is-selected', mark && `is-${mark}`, value === 1 && 'is-one', className)}
      style={style}
      data-value={value}
      aria-hidden
    >
      <i className="plate-hole" />
      <b className="plate-num">{value}</b>
      <span className="plate-serial">RO·0{value}</span>
      {state === 'rest' && <span className="plate-tape">repos</span>}
      {mark === 'removed' && <span className="plate-strike">−1</span>}
      {mark === 'dupe' && <span className="plate-stamp is-dupe">double</span>}
      {mark === 'win' && <span className="plate-stamp is-win">seul</span>}
    </span>
  );
}
