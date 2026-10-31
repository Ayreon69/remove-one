// Les mots de la table : noms, places, consignes de chaque étape et calendrier.
import { FINAL_SIZE, schedule, type RoomView, type TieBreak } from '../../../shared/protocol';
import { plural } from './util';

export function nameOf(view: RoomView, id: string | undefined | null): string {
  if (!id) return '?';
  if (id === view.me) return 'toi';
  return view.players.find((p) => p.id === id)?.name ?? '?';
}

/** « Léa, Zino et Sam ». */
export function listing(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

export function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « 1re », « 2e ». */
export function placeLabel(n: number): string {
  return n === 1 ? '1re' : `${n}e`;
}

/** Comment l'égalité a été tranchée. */
export function tieText(tie: TieBreak | null): string | null {
  if (tie === 'tokens') return 'Égalité de score : les jetons départagent.';
  if (tie === 'recent') return 'Égalité parfaite : la victoire la plus récente départage.';
  if (tie === 'draw') return 'Égalité parfaite : tirage au sort.';
  return null;
}

/** Le calendrier d'une partie, en une ligne. */
export function calendarText(players: number): string {
  const s = schedule(Math.max(FINAL_SIZE, players));
  const exits = s.releases.length - 1;
  if (!exits) return `${s.total} manches, puis deux sortent et le dernier reste en cellule.`;
  return `${s.total} manches : une sortie toutes les 3 manches (${plural(exits, 'sortie')}), puis une finale à 3 sur 6 manches.`;
}
