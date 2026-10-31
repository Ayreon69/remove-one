// Les bots de Remove One : une mémoire imparfaite des cartes déjà jouées par chacun, et des choix qui pèsent les chances de gagner contre le prix d'une petite carte.
// Ils ne voient que ce qu'un joueur voit : leurs cartes, les paires dévoilées, les cartes jouées, les points et les jetons.
import crypto from 'node:crypto';
import { CARDS } from '../shared/protocol';
import type { Game } from './game';

export interface Skill {
  /** Chance de retenir une carte jouée par un autre. */
  capture: number;
  /** Chance d'oublier un souvenir à chaque manche. */
  forget: number;
  /** Chance de faire un choix au hasard plutôt que le meilleur. */
  slip: number;
  /** Le prix qu'il accorde à une petite carte gardée pour plus tard. */
  thrift: number;
}

export function randomSkill(): Skill {
  return { capture: 0.7 + Math.random() * 0.25, forget: 0.04 + Math.random() * 0.06, slip: 0.04 + Math.random() * 0.06, thrift: 0.3 + Math.random() * 0.7 };
}

/** Le pilote automatique d'un absent : il ne retient rien et joue raisonnablement avec ce qu'il voit. */
export const NO_MEMORY: Skill = { capture: 0, forget: 1, slip: 0.15, thrift: 1 };

/** Ce qu'un bot croit savoir des autres : les cartes qu'il les a vus jouer et la carte qu'ils laissent au repos. */
export class Memory {
  used = new Map<string, Set<number>>();
  rest = new Map<string, number>();
  private cycle = -1;

  constructor(
    readonly skill: Skill,
    readonly self: string,
  ) {}

  /** Les cartes sont revenues : tout ce qu'on savait ne sert plus. */
  sync(g: Game): void {
    if (g.cycle === this.cycle) return;
    this.cycle = g.cycle;
    this.used.clear();
    this.rest.clear();
  }

  /** Fin d'une manche : retenir ce que chacun a joué et ce qu'il laisse au repos, puis oublier un peu. */
  observe(g: Game): void {
    this.sync(g);
    const r = g.result;
    if (!r) return;
    for (const [id, played] of Object.entries(r.plays)) {
      if (id === this.self) continue;
      for (const v of this.used.get(id) ?? []) if (Math.random() < this.skill.forget) this.used.get(id)!.delete(v);
      if (Math.random() < this.skill.capture) {
        if (!this.used.has(id)) this.used.set(id, new Set());
        this.used.get(id)!.add(played);
      }
      const pair = g.picks.get(id);
      const other = pair ? (pair[0] === played ? pair[1] : pair[0]) : null;
      if (other !== null && Math.random() < this.skill.capture) this.rest.set(id, other);
      else this.rest.delete(id);
    }
  }
}

function pickOne<T>(arr: T[]): T {
  return arr[crypto.randomInt(arr.length)];
}

/** Ce que vaut une carte gardée pour la suite du cycle : beaucoup pour un 1, peu pour un 8, rien à la dernière manche avant le retour des cartes. */
function keepCost(card: number, roundsLeft: number, thrift: number): number {
  const after = roundsLeft - 1;
  if (after <= 0) return 0;
  return thrift * ((CARDS.length + 1 - card) / CARDS.length) * (Math.min(after, 3) / 3) * 1.4;
}

/**
 * Le prix de l'enjeu : une manche de comptes rend la victoire décisive pour qui passerait devant,
 * et protège celui qui sortirait déjà.
 */
function stakes(g: Game, me: string, card: number): number {
  if (g.round !== g.nextRelease) return 0;
  const final = g.round >= g.total;
  const leave = final ? g.active.length - 1 : 1;
  const score = (id: string, extra = 0) => g.score(id) + extra;
  const rank = (winner: string | null, value: number) =>
    [...g.active].sort((a, b) => {
      const sa = score(a, a === winner ? value + 1 : 0);
      const sb = score(b, b === winner ? value + 1 : 0);
      const ta = g.tokens.get(a)! + (a === winner ? 1 : 0);
      const tb = g.tokens.get(b)! + (b === winner ? 1 : 0);
      const la = a === winner ? g.round : g.lastWin.get(a)!;
      const lb = b === winner ? g.round : g.lastWin.get(b)!;
      return sb - sa || tb - ta || lb - la;
    });
  const safeNow = rank(null, 0).indexOf(me) < leave;
  const safeIfWin = rank(me, card).indexOf(me) < leave;
  if (safeIfWin && !safeNow) return final ? 9 : 6;
  if (safeIfWin && safeNow) return 2;
  return 0;
}

/** La valeur d'une manche gagnée avec cette carte. */
function prize(g: Game, me: string, card: number): number {
  return card + 1 + stakes(g, me, card);
}

/** Les cartes qu'un adversaire peut encore poser, d'après la mémoire du bot : un tirage plausible. */
function guessAvailable(g: Game, mem: Memory, id: string): number[] {
  const known = mem.used.get(id) ?? new Set<number>();
  const played = g.roundsInCycle;
  const rest = mem.rest.get(id);
  const pool = CARDS.filter((v) => !known.has(v) && v !== rest);
  // Il a joué `played` cartes ; on n'en connaît que certaines : les autres sont tirées au hasard, plutôt parmi les petites.
  let unknown = Math.max(0, played - known.size);
  const left = [...pool];
  while (unknown-- > 0 && left.length > 2) {
    const weights = left.map((v) => 1.6 - v / CARDS.length);
    let x = Math.random() * weights.reduce((s, w) => s + w, 0);
    let k = 0;
    while (k < left.length - 1 && (x -= weights[k]) > 0) k++;
    left.splice(k, 1);
  }
  // Sans souvenir de sa carte au repos, on en retire une au hasard.
  if (rest === undefined && played > 0 && left.length > 2) left.splice(crypto.randomInt(left.length), 1);
  return left.length >= 2 ? left : pool.slice(0, Math.max(2, pool.length));
}

/** Comment un joueur ordinaire choisit sa paire : souvent sa plus petite carte et une autre. */
function guessPair(avail: number[]): [number, number] {
  const sorted = [...avail].sort((a, b) => a - b);
  if (sorted.length <= 2) return [sorted[0], sorted[1] ?? sorted[0]];
  if (Math.random() < 0.55) {
    const other = sorted[1 + crypto.randomInt(sorted.length - 1)];
    return [sorted[0], other];
  }
  const a = crypto.randomInt(sorted.length);
  let b = crypto.randomInt(sorted.length - 1);
  if (b >= a) b++;
  return [sorted[Math.min(a, b)], sorted[Math.max(a, b)]];
}

/** La chance que `card` soit le plus petit nombre seul, les autres jouant chacun une de leurs deux cartes selon leurs probabilités. */
function winChance(card: number, others: { cards: number[]; probs: number[] }[]): number {
  let total = 0;
  const n = others.length;
  const count = new Map<number, number>();
  for (let mask = 0; mask < 1 << n; mask++) {
    let p = 1;
    count.clear();
    count.set(card, 1);
    for (let i = 0; i < n; i++) {
      const k = (mask >> i) & 1;
      p *= others[i].probs[k];
      const v = others[i].cards[k];
      count.set(v, (count.get(v) ?? 0) + 1);
    }
    if (p === 0 || count.get(card)! > 1) continue;
    let beaten = false;
    for (const [v, c] of count) if (c === 1 && v < card) beaten = true;
    if (!beaten) total += p;
  }
  return total;
}

/** Les deux cartes à poser. */
export function botPick(g: Game, mem: Memory, me: string): [number, number] {
  mem.sync(g);
  const avail = g.available(me);
  if (avail.length <= 2) return [avail[0], avail[1]];
  const pairs: [number, number][] = [];
  for (let i = 0; i < avail.length; i++) for (let j = i + 1; j < avail.length; j++) pairs.push([avail[i], avail[j]]);
  if (Math.random() < mem.skill.slip) return pickOne(pairs);
  const rivals = g.active.filter((id) => id !== me);
  const left = g.roundsLeftInCycle;
  const samples = 70;
  // Pour chaque tirage plausible des paires adverses, chaque adversaire joue sa petite carte un peu plus souvent que la grande.
  const draws: number[][] = [];
  for (let s = 0; s < samples; s++) {
    draws.push(
      rivals.map((id) => {
        const [a, b] = guessPair(guessAvailable(g, mem, id));
        return Math.random() < 0.6 ? a : b;
      }),
    );
  }
  const value = (card: number, other: number) => {
    let wins = 0;
    for (const d of draws) {
      const all = [card, ...d];
      if (all.filter((v) => v === card).length > 1) continue;
      if (all.some((v) => v < card && all.filter((w) => w === v).length === 1)) continue;
      wins++;
    }
    return (wins / samples) * prize(g, me, card) - keepCost(card, left, mem.skill.thrift) - 0.25 * keepCost(other, left, mem.skill.thrift) * (left > 1 ? 1 : 0);
  };
  let best = pairs[0];
  let bestScore = -Infinity;
  for (const [a, b] of pairs) {
    // On choisira ensuite la meilleure des deux, en voyant les paires : la paire vaut sa meilleure carte, plus un peu de souplesse.
    const va = value(a, b);
    const vb = value(b, a);
    const score = Math.max(va, vb) + 0.25 * Math.min(va, vb) + Math.random() * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = [a, b];
    }
  }
  return best;
}

/** La carte à jouer, une fois les paires dévoilées. */
export function botKeep(g: Game, mem: Memory, me: string): number {
  mem.sync(g);
  const mine = g.picks.get(me)!;
  if (Math.random() < mem.skill.slip) return pickOne(mine);
  const left = g.roundsLeftInCycle;
  const rivals = g.active.filter((id) => id !== me);
  const pairOf = (id: string) => g.picks.get(id)!;
  // Niveau 1 : chaque adversaire suppose que les autres jouent au hasard et préfère la carte qui lui rapporte le plus.
  const models = rivals.map((id) => {
    const pair = pairOf(id);
    const others = g.active.filter((x) => x !== id).map((x) => ({ cards: [...pairOf(x)], probs: [0.5, 0.5] }));
    const ev = pair.map((c, k) => winChance(c, others) * (c + 1) - keepCost(c, left, 1) - 0.25 * keepCost(pair[1 - k], left, 1));
    const ea = Math.exp(ev[0] / 0.8);
    const eb = Math.exp(ev[1] / 0.8);
    return { cards: [...pair], probs: [ea / (ea + eb), eb / (ea + eb)] };
  });
  const ev = mine.map((c, k) => winChance(c, models) * prize(g, me, c) - keepCost(c, left, mem.skill.thrift) - 0.25 * keepCost(mine[1 - k], left, mem.skill.thrift));
  if (Math.abs(ev[0] - ev[1]) < 0.05) return pickOne(mine);
  return ev[0] >= ev[1] ? mine[0] : mine[1];
}

/** Un joueur sans réflexion, pour mesurer les bots : deux cartes au hasard, puis l'une des deux au hasard. */
export function naivePick(g: Game, me: string): [number, number] {
  const avail = g.available(me);
  const a = crypto.randomInt(avail.length);
  let b = crypto.randomInt(avail.length - 1);
  if (b >= a) b++;
  const x = avail[a];
  const y = avail[b];
  return x < y ? [x, y] : [y, x];
}

export function naiveKeep(g: Game, me: string): number {
  return pickOne(g.picks.get(me)!);
}
