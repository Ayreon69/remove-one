// Simulation : des bots entre eux, pour juger leur niveau et leur vitesse (npx tsx test/sim.ts 200).
import { schedule } from '../shared/protocol';
import { Memory, NO_MEMORY, botKeep, botPick, naiveKeep, naivePick, randomSkill } from '../server/bots';
import { Game } from '../server/game';

const N = Number(process.argv[2] ?? 200);

type Brain = 'bot' | 'auto' | 'naive';

function play(order: string[], brain: (id: string) => Brain): { game: Game; ms: number; decisions: number } {
  const g = new Game(order);
  const mem = new Map(order.map((id) => [id, new Memory(brain(id) === 'bot' ? randomSkill() : NO_MEMORY, id)]));
  let ms = 0;
  let decisions = 0;
  for (let guard = 0; guard < 1000 && g.stage !== 'over'; guard++) {
    if (g.stage === 'pick' || g.stage === 'keep') {
      for (const id of g.waiting()) {
        const t = performance.now();
        const b = brain(id);
        const err =
          g.stage === 'pick'
            ? g.pick(id, b === 'naive' ? naivePick(g, id) : botPick(g, mem.get(id)!, id))
            : g.keep(id, b === 'naive' ? naiveKeep(g, id) : botKeep(g, mem.get(id)!, id));
        ms += performance.now() - t;
        decisions++;
        if (err) throw new Error(err);
      }
      if ((g.stage as string) === 'result') for (const m of mem.values()) m.observe(g);
      continue;
    }
    g.advance();
  }
  if (g.stage !== 'over') throw new Error('partie sans fin');
  return { game: g, ms, decisions };
}

for (let n = 3; n <= 8; n++) {
  const order = Array.from({ length: n }, (_, i) => `p${i}`);
  let ms = 0;
  let decisions = 0;
  let empty = 0;
  let rounds = 0;
  const duel = { place: 0, out: 0, first: 0 };
  const auto = { place: 0, out: 0 };
  for (let k = 0; k < N; k++) {
    const r = play(order, () => 'bot');
    ms += r.ms;
    decisions += r.decisions;
    rounds += r.game.round;
    // p0 réfléchit, les autres jouent au hasard : la réflexion doit payer.
    const d = play(order, (id) => (id === 'p0' ? 'bot' : 'naive')).game.standings().find((s) => s.id === 'p0')!;
    duel.place += d.place;
    if (d.fate === 'out') duel.out++;
    if (d.place === 1) duel.first++;
    // Le pilote automatique d'un absent, sans mémoire, face à des joueurs au hasard.
    const a = play(order, (id) => (id === 'p0' ? 'auto' : 'naive')).game.standings().find((s) => s.id === 'p0')!;
    auto.place += a.place;
    if (a.fate === 'out') auto.out++;
    void empty;
  }
  const mid = (n + 1) / 2;
  console.log(
    `${n} joueurs (${schedule(n).total} manches) : ${(ms / decisions).toFixed(2)} ms/choix. ` +
      `Bot contre ${n - 1} joueurs au hasard : place moyenne ${(duel.place / N).toFixed(2)} (hasard ${mid.toFixed(1)}), ` +
      `premier ${Math.round((duel.first / N) * 100)} % (hasard ${Math.round(100 / n)} %), reste en cellule ${Math.round((duel.out / N) * 100)} % (hasard ${Math.round(100 / n)} %). ` +
      `Pilote automatique : place ${(auto.place / N).toFixed(2)}, en cellule ${Math.round((auto.out / N) * 100)} %.`,
  );
}
