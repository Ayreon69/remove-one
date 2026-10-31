// Contrat partagé entre le serveur et le client : vues de table, réglages, constantes et calendrier de la partie.

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

/** Chacun a les mêmes huit cartes, de 1 à 8. */
export const CARDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
/** Une sortie toutes les trois manches. */
export const LEG = 3;
/** Les cartes reviennent toutes les six manches. */
export const CYCLE = 6;
/** Les trois derniers jouent une finale de six manches : deux sortent, le dernier reste en cellule. */
export const FINAL_SIZE = 3;
export const FINAL_ROUNDS = 6;

export interface Schedule {
  /** Les manches après lesquelles on fait les comptes (la dernière est la finale). */
  releases: number[];
  /** Les manches au début desquelles chacun récupère ses huit cartes (la première n'y figure pas). */
  refills: number[];
  finalStart: number;
  total: number;
}

/** Le calendrier, selon le nombre de joueurs : une sortie toutes les 3 manches jusqu'à ce qu'il en reste 3, puis la finale. */
export function schedule(players: number): Schedule {
  const before = Math.max(0, players - FINAL_SIZE);
  const releases = Array.from({ length: before }, (_, i) => (i + 1) * LEG);
  const finalStart = before * LEG + 1;
  const total = before * LEG + FINAL_ROUNDS;
  releases.push(total);
  const refills: number[] = [];
  for (let r = CYCLE + 1; r < finalStart; r += CYCLE) refills.push(r);
  if (finalStart > 1 && !refills.includes(finalStart)) refills.push(finalStart);
  return { releases, refills, finalStart, total };
}

/** Temps pour chaque choix, en secondes (0 : sans limite). */
export const THINK_OPTIONS = [0, 30, 60] as const;
export type ThinkTime = (typeof THINK_OPTIONS)[number];

export interface Settings {
  think: ThinkTime;
}

export const AVATARS = ['renard', 'loup', 'chouette', 'serpent', 'raton', 'rat', 'aigle', 'sanglier', 'requin', 'ours', 'scorpion', 'crocodile'] as const;
export const EMOTES = ['🤐', '😈', '😱', '🙏', '🔥', '🫡'] as const;
export const TAUNTS = ['Je joue le 1 !', 'Je joue le 2 !', 'On s’arrange ?', 'Fais-moi confiance', 'Bien joué', 'Traître !'] as const;

export type PlayerStatus = 'lobby' | 'playing' | 'spectator';
/** En cellule, sorti, ou resté en cellule à la fin. */
export type Fate = 'in' | 'free' | 'out';

export interface PlayerView {
  id: string;
  name: string;
  avatar: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  autopilot: boolean;
  status: PlayerStatus;
  /** Parties terminées à la première place, à cette table. */
  wins: number;
  /** null hors partie. */
  fate: Fate | null;
  /** Son rang de sortie (1 : le premier sorti), null tant qu'il est en cellule. */
  place: number | null;
  /** Points marqués depuis les derniers comptes. */
  points: number;
  /** Jetons de victoire : un par manche gagnée, gardés jusqu'au bout. */
  tokens: number;
  /** Il a déjà fait son choix pour l'étape en cours. */
  ready: boolean;
}

/**
 * pick : chacun pose deux cartes face cachée.
 * keep : les paires sont dévoilées, chacun garde en secret celle qu'il joue.
 * result : les cartes jouées sont dévoilées, le plus petit nombre seul gagne.
 * release : les comptes, et qui sort.
 */
export type Stage = 'pick' | 'keep' | 'result' | 'release' | 'over';

/** Une de mes cartes : prête, au repos pour cette manche, ou déjà jouée depuis que les cartes sont revenues. */
export type CardState = 'ready' | 'rest' | 'used';
export interface MyCard {
  value: number;
  state: CardState;
}

export interface RoundResult {
  /** La carte jouée par chacun. */
  plays: Record<string, number>;
  /** Celui qui gagne la manche, ou null si aucun nombre n'est joué une seule fois. */
  winner: string | null;
  value: number | null;
  /** Les nombres joués par plusieurs joueurs. */
  dupes: number[];
}

/** Comment s'est tranchée l'égalité décisive des comptes. */
export type TieBreak = 'tokens' | 'recent' | 'draw';

export interface ReleaseLine {
  id: string;
  points: number;
  tokens: number;
  total: number;
}

export interface ReleaseView {
  final: boolean;
  /** Ceux qui sortent, dans l'ordre. */
  free: string[];
  /** Celui qui reste en cellule, à la finale. */
  out: string | null;
  /** Les comptes, du meilleur au moins bon. */
  lines: ReleaseLine[];
  tie: TieBreak | null;
}

export interface GameView {
  order: string[];
  stage: Stage;
  round: number;
  total: number;
  releases: number[];
  refills: number[];
  finalStart: number;
  /** Numéro de l'état : une action envoyée pour un état déjà passé est refusée. */
  seq: number;
  /** Fin du chrono de l'étape (0 : sans limite). */
  endsAt: number;
  /** Mes huit cartes (null pour un spectateur ou un joueur sorti). */
  cards: MyCard[] | null;
  /** Mes deux cartes posées cette manche. */
  myPair: [number, number] | null;
  /** La carte que je joue cette manche. */
  myPlay: number | null;
  /** Il ne me restait que deux cartes : elles sont posées d'office (pendant la pose et le choix). */
  forced: boolean;
  /** Les paires de chacun, visibles une fois toutes posées. */
  pairs: Record<string, [number, number]> | null;
  result: RoundResult | null;
  release: ReleaseView | null;
}

export interface FinalPlayer {
  id: string;
  name: string;
  avatar: string;
  place: number;
  fate: 'free' | 'out';
  /** La manche à la fin de laquelle il est sorti. */
  round: number;
  tokens: number;
  wins: number;
  winner: boolean;
}

export interface FinalView {
  rounds: number;
  players: FinalPlayer[];
}

export interface RoomView {
  code: string;
  phase: 'lobby' | 'playing' | 'finished';
  me: string;
  hostId: string;
  settings: Settings;
  players: PlayerView[];
  game: GameView | null;
  final: FinalView | null;
  serverNow: number;
}

export type Ack<T = unknown> = (res: { ok: boolean; error?: string; data?: T }) => void;

function isCard(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= CARDS.length;
}

/** Deux cartes différentes reçues du réseau, rangées dans l'ordre (le moteur vérifie qu'on les a). */
export function parsePair(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [a, b] = raw;
  if (!isCard(a) || !isCard(b) || a === b) return null;
  return a < b ? [a, b] : [b, a];
}

export function parseCard(raw: unknown): number | null {
  return isCard(raw) ? raw : null;
}
