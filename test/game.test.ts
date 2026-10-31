// Tests du moteur : calendrier, plus petit nombre seul, carte au repos, cartes posées d'office, comptes et égalités, parties complètes.
import { describe, expect, it } from 'vitest';
import { schedule } from '../shared/protocol';
import { Memory, botKeep, botPick, randomSkill } from '../server/bots';
import { Game, lowestUnique } from '../server/game';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

/** Joue une manche : chacun pose sa paire puis garde sa carte. */
function round(g: Game, moves: Record<string, [number, number, number]>): void {
  for (const [id, [a, b]] of Object.entries(moves)) if (!g.forced.has(id)) expect(g.pick(id, [a, b])).toBeUndefined();
  expect(g.stage).toBe('keep');
  for (const [id, [, , play]] of Object.entries(moves)) expect(g.keep(id, play)).toBeUndefined();
  expect(g.stage).toBe('result');
}

describe('le calendrier', () => {
  it('suit l’émission à 7 : une sortie toutes les 3 manches, cartes rendues après la 6e et la 12e, finale de 13 à 18', () => {
    expect(schedule(7)).toEqual({ releases: [3, 6, 9, 12, 18], refills: [7, 13], finalStart: 13, total: 18 });
  });
  it('s’adapte au nombre de joueurs', () => {
    expect(schedule(3)).toEqual({ releases: [6], refills: [], finalStart: 1, total: 6 });
    expect(schedule(4)).toEqual({ releases: [3, 9], refills: [4], finalStart: 4, total: 9 });
    expect(schedule(5)).toEqual({ releases: [3, 6, 12], refills: [7], finalStart: 7, total: 12 });
    expect(schedule(6)).toEqual({ releases: [3, 6, 9, 15], refills: [7, 10], finalStart: 10, total: 15 });
    expect(schedule(8)).toEqual({ releases: [3, 6, 9, 12, 15, 21], refills: [7, 13, 16], finalStart: 16, total: 21 });
  });
  it('ne laisse jamais plus de six manches entre deux retours des cartes', () => {
    for (let n = 3; n <= 8; n++) {
      const s = schedule(n);
      const starts = [1, ...s.refills, s.total + 1];
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(6);
    }
  });
});

describe('le plus petit nombre seul', () => {
  it('ignore les nombres joués en double', () => {
    expect(lowestUnique([4, 8, 2, 1, 4, 4, 8])).toEqual({ value: 1, dupes: [4, 8] });
    expect(lowestUnique([6, 1, 5, 8, 1, 2, 7])).toEqual({ value: 2, dupes: [1] });
  });
  it('ne donne rien quand tout est en double', () => {
    expect(lowestUnique([3, 3, 5, 5])).toEqual({ value: null, dupes: [3, 5] });
  });
});

describe('une manche', () => {
  it('rejoue les trois premières manches de l’émission : Choi Hyun-joon sort le premier', () => {
    const [H, S, D, L, J, C, U] = ids(7);
    const g = new Game([H, S, D, L, J, C, U]);
    round(g, { [H]: [1, 4, 4], [S]: [1, 8, 8], [D]: [2, 4, 2], [L]: [1, 4, 1], [J]: [4, 8, 4], [C]: [2, 4, 4], [U]: [2, 8, 8] });
    expect(g.result).toMatchObject({ winner: L, value: 1, dupes: [4, 8] });
    g.advance();
    round(g, { [H]: [2, 5, 5], [S]: [2, 7, 7], [D]: [1, 6, 1], [L]: [2, 3, 2], [J]: [2, 5, 2], [C]: [3, 7, 3], [U]: [3, 5, 3] });
    expect(g.result).toMatchObject({ winner: D, value: 1 });
    g.advance();
    round(g, { [H]: [1, 6, 6], [S]: [1, 3, 1], [D]: [3, 5, 5], [L]: [4, 8, 8], [J]: [1, 3, 1], [C]: [2, 5, 2], [U]: [4, 7, 7] });
    expect(g.result).toMatchObject({ winner: C, value: 2 });
    g.advance();
    expect(g.stage).toBe('release');
    expect(g.release!.free).toEqual([C]);
    expect(g.release!.lines.slice(0, 3).map((l) => [l.id, l.total])).toEqual([
      [C, 3],
      [D, 2],
      [L, 2],
    ]);
    // Lee Se-dol et Lee Seung-hyun sont à égalité : la victoire la plus récente départage.
    expect(g.release!.tie).toBeNull();
    // Les points repartent de zéro, les jetons restent.
    expect(g.points.get(D)).toBe(0);
    expect(g.tokens.get(D)).toBe(1);
    g.advance();
    expect(g.round).toBe(4);
    expect(g.active).not.toContain(C);
  });

  it('interdit la carte au repos et les cartes déjà jouées', () => {
    const g = new Game(ids(3));
    round(g, { p0: [1, 2, 1], p1: [3, 4, 3], p2: [5, 6, 5] });
    g.advance();
    expect(g.pick('p0', [2, 3])).toMatch(/repose/);
    expect(g.pick('p0', [1, 3])).toMatch(/déjà joué/);
    expect(g.pick('p0', [3, 3])).toMatch(/différentes/);
    expect(g.pick('p0', [3, 4])).toBeUndefined();
    expect(g.pick('p0', [5, 6])).toMatch(/déjà posées/);
  });

  it('ne laisse garder qu’une des deux cartes posées', () => {
    const g = new Game(ids(3));
    g.pick('p0', [1, 2]);
    expect(g.keep('p0', 1)).toMatch(/moment/);
    g.pick('p1', [1, 2]);
    g.pick('p2', [7, 8]);
    expect(g.keep('p0', 3)).toMatch(/deux cartes/);
    expect(g.keep('p0', 2)).toBeUndefined();
    expect(g.keep('p0', 1)).toMatch(/déjà/);
  });

  it('pose d’office les deux dernières cartes, puis rend les huit cartes', () => {
    const g = new Game(ids(3));
    const plays = [
      { p0: [1, 2, 1], p1: [1, 2, 2], p2: [7, 8, 8] },
      { p0: [3, 4, 3], p1: [3, 4, 4], p2: [5, 6, 6] },
      { p0: [5, 6, 5], p1: [5, 6, 5], p2: [1, 2, 1] },
      { p0: [7, 8, 7], p1: [7, 8, 7], p2: [3, 4, 3] },
    ] as Record<string, [number, number, number]>[];
    for (const m of plays) {
      round(g, m);
      g.advance();
    }
    // Manche 5 : il reste 3 cartes à chacun, dont une au repos.
    expect(g.available('p0').length).toBe(3);
    round(g, { p0: [2, 4, 2], p1: [1, 3, 1], p2: [2, 5, 2] });
    g.advance();
    // Manche 6 : deux cartes seulement, posées d'office ; on passe directement au choix de la carte jouée.
    expect(g.stage).toBe('keep');
    expect(g.forced.size).toBe(3);
    expect(g.picks.get('p0')).toEqual([6, 8]);
  });
});

describe('les comptes', () => {
  it('départage une égalité de score par les jetons', () => {
    const g = new Game(ids(4));
    round(g, { p0: [2, 8, 2], p1: [2, 7, 2], p2: [3, 6, 6], p3: [1, 5, 1] });
    expect(g.result!.winner).toBe('p3');
    g.advance();
    round(g, { p0: [1, 3, 1], p1: [1, 4, 1], p2: [5, 7, 5], p3: [2, 3, 2] });
    expect(g.result!.winner).toBe('p3');
    g.advance();
    round(g, { p0: [4, 5, 4], p1: [3, 6, 3], p2: [3, 4, 3], p3: [7, 8, 8] });
    expect(g.result!.winner).toBe('p0');
    g.advance();
    // p0 : 4 points + 1 jeton = 5 ; p3 : 3 points + 2 jetons = 5. Les jetons départagent.
    expect(g.release!.lines.slice(0, 2).map((l) => [l.id, l.total])).toEqual([
      ['p3', 5],
      ['p0', 5],
    ]);
    expect(g.release!.free).toEqual(['p3']);
    expect(g.release!.tie).toBe('tokens');
  });

  it('tire au sort une égalité parfaite et le dit', () => {
    const g = new Game(ids(4), { random: () => 0.5 });
    for (let r = 0; r < 3; r++) {
      const ready = (id: string) => g.available(id).slice(0, 2);
      for (const id of g.active) g.pick(id, ready(id));
      for (const id of g.active) g.keep(id, g.picks.get(id)![0]);
      expect(g.result!.winner).toBeNull();
      g.advance();
    }
    expect(g.release!.tie).toBe('draw');
    expect(g.release!.free.length).toBe(1);
  });
});

/** Une partie complète, chacun jouant un coup légal au hasard (ou en bot). */
function playOut(n: number, bots: boolean): Game {
  const g = new Game(ids(n));
  const mem = new Map(ids(n).map((id) => [id, new Memory(randomSkill(), id)]));
  for (let guard = 0; guard < 500 && g.stage !== 'over'; guard++) {
    if (g.stage === 'pick') {
      for (const id of g.waiting()) {
        const avail = g.available(id);
        const pair = bots ? botPick(g, mem.get(id)!, id) : [avail[0], avail[avail.length - 1]];
        expect(g.pick(id, pair)).toBeUndefined();
      }
    } else if (g.stage === 'keep') {
      for (const id of g.waiting()) expect(g.keep(id, bots ? botKeep(g, mem.get(id)!, id) : g.picks.get(id)![Math.random() < 0.5 ? 0 : 1])).toBeUndefined();
      for (const m of mem.values()) m.observe(g);
    } else g.advance();
  }
  return g;
}

describe('une partie complète', () => {
  for (let n = 3; n <= 8; n++) {
    it(`se termine à ${n} joueurs : chacun a une place, un seul reste en cellule`, () => {
      for (const bots of [false, true]) {
        const g = playOut(n, bots);
        expect(g.stage).toBe('over');
        expect(g.round).toBe(schedule(n).total);
        const s = g.standings();
        expect(s.map((x) => x.place)).toEqual(ids(n).map((_, i) => i + 1));
        expect(s.filter((x) => x.fate === 'out').length).toBe(1);
        expect(s[n - 1].fate).toBe('out');
      }
    });
  }
});
