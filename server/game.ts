// Le moteur d'une partie de Remove One : deux cartes posées, une seule jouée, le plus petit nombre seul gagne, et une sortie toutes les trois manches.
import crypto from 'node:crypto';
import {
  CARDS,
  parseCard,
  parsePair,
  schedule,
  type Fate,
  type ReleaseLine,
  type ReleaseView,
  type RoundResult,
  type Schedule,
  type Stage,
  type TieBreak,
} from '../shared/protocol';

export interface GameOptions {
  /** Tirage au sort d'une égalité parfaite (remplaçable dans les tests). */
  random?: () => number;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Le plus petit nombre joué une seule fois, et les nombres joués en double. */
export function lowestUnique(values: number[]): { value: number | null; dupes: number[] } {
  const count = new Map<number, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  const singles = [...count].filter(([, n]) => n === 1).map(([v]) => v);
  const dupes = [...count].filter(([, n]) => n > 1).map(([v]) => v).sort((a, b) => a - b);
  return { value: singles.length ? Math.min(...singles) : null, dupes };
}

export class Game {
  readonly order: string[];
  readonly sched: Schedule;
  /** Ceux qui sont encore en cellule, dans l'ordre de la table. */
  active: string[];
  fate = new Map<string, Fate>();
  place = new Map<string, number>();
  freedAt = new Map<string, number>();
  /** Les cartes de chacun qui n'ont pas encore été jouées depuis qu'elles sont revenues (la carte au repos comprise). */
  hands = new Map<string, number[]>();
  /** La carte posée mais non jouée à la manche précédente : elle ne peut pas resservir cette manche. */
  rest = new Map<string, number | null>();
  points = new Map<string, number>();
  tokens = new Map<string, number>();
  /** La dernière manche gagnée par chacun (0 : jamais), pour départager une égalité. */
  lastWin = new Map<string, number>();
  round = 1;
  /** Compte les retours de cartes : les bots oublient tout à chaque fois. */
  cycle = 0;
  stage: Stage = 'pick';
  seq = 0;
  picks = new Map<string, [number, number]>();
  plays = new Map<string, number>();
  /** Ceux dont les deux dernières cartes ont été posées d'office. */
  forced = new Set<string>();
  result: RoundResult | null = null;
  release: ReleaseView | null = null;
  private freed = 0;
  private readonly random: () => number;

  constructor(order: string[], opts: GameOptions = {}) {
    this.order = [...order];
    this.sched = schedule(order.length);
    this.active = [...order];
    this.random = opts.random ?? Math.random;
    for (const id of order) {
      this.fate.set(id, 'in');
      this.points.set(id, 0);
      this.tokens.set(id, 0);
      this.lastWin.set(id, 0);
    }
    this.refill();
    this.startRound();
  }

  get total(): number {
    return this.sched.total;
  }

  get isFinal(): boolean {
    return this.round >= this.sched.finalStart;
  }

  isIn(id: string): boolean {
    return this.fate.get(id) === 'in';
  }

  hand(id: string): number[] {
    return this.hands.get(id) ?? [];
  }

  /** Les cartes qu'un joueur peut poser cette manche : sa main, sauf la carte au repos. */
  available(id: string): number[] {
    const rest = this.rest.get(id) ?? null;
    return this.hand(id).filter((v) => v !== rest);
  }

  /** Combien de manches ont été jouées depuis le dernier retour des cartes. */
  get roundsInCycle(): number {
    const starts = [1, ...this.sched.refills].filter((r) => r <= this.round);
    return this.round - Math.max(...starts);
  }

  /** Combien de manches restent avant le prochain retour des cartes (ou la fin), celle-ci comprise. */
  get roundsLeftInCycle(): number {
    const next = [...this.sched.refills, this.total + 1].find((r) => r > this.round)!;
    return next - this.round;
  }

  /** La prochaine manche de comptes, celle-ci comprise. */
  get nextRelease(): number {
    return this.sched.releases.find((r) => r >= this.round) ?? this.total;
  }

  private refill(): void {
    for (const id of this.active) {
      this.hands.set(id, [...CARDS]);
      this.rest.set(id, null);
    }
    this.cycle++;
  }

  private startRound(): void {
    this.stage = 'pick';
    this.picks.clear();
    this.plays.clear();
    this.forced.clear();
    this.result = null;
    this.release = null;
    this.seq++;
    // Avec deux cartes seulement, il n'y a rien à choisir : elles sont posées d'office.
    for (const id of this.active) {
      const avail = this.available(id);
      if (avail.length === 2) {
        this.picks.set(id, [avail[0], avail[1]]);
        this.forced.add(id);
      }
    }
    if (this.active.every((id) => this.picks.has(id))) this.toKeep();
  }

  /** Ceux qui doivent encore choisir à l'étape en cours. */
  waiting(): string[] {
    if (this.stage === 'pick') return this.active.filter((id) => !this.picks.has(id));
    if (this.stage === 'keep') return this.active.filter((id) => !this.plays.has(id));
    return [];
  }

  /** Poser deux cartes face cachée. */
  pick(by: string, raw: unknown): string | undefined {
    if (this.stage !== 'pick') return "Ce n'est pas le moment de poser des cartes.";
    if (!this.isIn(by)) return "Tu n'es plus en cellule.";
    if (this.picks.has(by)) return 'Tes deux cartes sont déjà posées.';
    const pair = parsePair(raw);
    if (!pair) return 'Choisis deux cartes différentes.';
    const avail = this.available(by);
    const rest = this.rest.get(by);
    if (pair.includes(rest ?? -1)) return `Ton ${rest} se repose : il ne peut pas servir cette manche.`;
    if (!pair.every((v) => avail.includes(v))) return 'Tu as déjà joué cette carte.';
    this.picks.set(by, pair);
    if (this.waiting().length === 0) this.toKeep();
    return undefined;
  }

  private toKeep(): void {
    this.stage = 'keep';
    this.seq++;
  }

  /** Garder une des deux cartes : c'est elle qui est jouée, l'autre se repose une manche. */
  keep(by: string, raw: unknown): string | undefined {
    if (this.stage !== 'keep') return "Ce n'est pas le moment de choisir ta carte.";
    if (!this.isIn(by)) return "Tu n'es plus en cellule.";
    if (this.plays.has(by)) return 'Ta carte est déjà choisie.';
    const value = parseCard(raw);
    const pair = this.picks.get(by);
    if (value === null || !pair?.includes(value)) return 'Choisis une de tes deux cartes.';
    this.plays.set(by, value);
    if (this.waiting().length === 0) this.resolve();
    return undefined;
  }

  private resolve(): void {
    const plays: Record<string, number> = {};
    for (const id of this.active) plays[id] = this.plays.get(id)!;
    const { value, dupes } = lowestUnique(Object.values(plays));
    const winner = value === null ? null : this.active.find((id) => plays[id] === value)!;
    if (winner) {
      this.points.set(winner, this.points.get(winner)! + value!);
      this.tokens.set(winner, this.tokens.get(winner)! + 1);
      this.lastWin.set(winner, this.round);
    }
    // La carte jouée part pour de bon ; l'autre se repose pendant la manche suivante.
    for (const id of this.active) {
      const played = plays[id];
      const [a, b] = this.picks.get(id)!;
      this.hands.set(
        id,
        this.hand(id).filter((v) => v !== played),
      );
      this.rest.set(id, played === a ? b : a);
    }
    this.result = { plays, winner, value, dupes };
    this.stage = 'result';
    this.seq++;
  }

  /** Le score des comptes : les points depuis les derniers comptes, plus un par jeton de victoire. */
  score(id: string): number {
    return this.points.get(id)! + this.tokens.get(id)!;
  }

  /** Classe ceux qui sont en cellule : score, puis jetons, puis la victoire la plus récente, puis le sort. */
  ranking(): { ids: string[]; draw: Map<string, number> } {
    const draw = new Map(this.active.map((id) => [id, this.random()]));
    const ids = [...this.active].sort(
      (a, b) => this.score(b) - this.score(a) || this.tokens.get(b)! - this.tokens.get(a)! || this.lastWin.get(b)! - this.lastWin.get(a)! || draw.get(b)! - draw.get(a)!,
    );
    return { ids, draw };
  }

  private tieBetween(a: string, b: string): TieBreak | null {
    if (this.score(a) !== this.score(b)) return null;
    if (this.tokens.get(a) !== this.tokens.get(b)) return 'tokens';
    if (this.lastWin.get(a) !== this.lastWin.get(b)) return 'recent';
    return 'draw';
  }

  /** Après l'affichage d'une manche : les comptes s'il y en a, sinon la manche suivante ; après les comptes, la suite ou la fin. */
  advance(): void {
    if (this.stage === 'result') {
      if (this.sched.releases.includes(this.round)) this.doRelease();
      else this.nextRound();
      return;
    }
    if (this.stage === 'release') {
      if (this.round >= this.total) {
        this.stage = 'over';
        this.seq++;
      } else this.nextRound();
    }
  }

  private doRelease(): void {
    const final = this.round >= this.total;
    const { ids } = this.ranking();
    const lines: ReleaseLine[] = ids.map((id) => ({ id, points: this.points.get(id)!, tokens: this.tokens.get(id)!, total: this.score(id) }));
    const leave = final ? Math.max(0, ids.length - 1) : 1;
    const free = ids.slice(0, leave);
    const out = final ? (ids[ids.length - 1] ?? null) : null;
    // L'égalité qui compte : entre le dernier qui sort et le premier qui reste.
    const tie = ids.length > leave && leave > 0 ? this.tieBetween(ids[leave - 1], ids[leave]) : null;
    for (const id of free) {
      this.fate.set(id, 'free');
      this.place.set(id, ++this.freed);
      this.freedAt.set(id, this.round);
    }
    if (out) {
      this.fate.set(out, 'out');
      this.place.set(out, ++this.freed);
      this.freedAt.set(out, this.round);
    }
    this.active = this.active.filter((id) => this.isIn(id));
    // Les points repartent de zéro, les jetons restent.
    for (const id of this.order) this.points.set(id, 0);
    this.release = { final, free, out, lines, tie };
    this.result = null;
    this.stage = 'release';
    this.seq++;
  }

  private nextRound(): void {
    this.round++;
    if (this.sched.refills.includes(this.round)) this.refill();
    this.startRound();
  }

  /** La place finale de chacun (1 : le premier sorti). */
  standings(): { id: string; place: number; fate: 'free' | 'out'; round: number }[] {
    return this.order
      .map((id) => ({ id, place: this.place.get(id) ?? this.order.length, fate: (this.fate.get(id) === 'out' ? 'out' : 'free') as 'free' | 'out', round: this.freedAt.get(id) ?? this.round }))
      .sort((a, b) => a.place - b.place);
  }
}
