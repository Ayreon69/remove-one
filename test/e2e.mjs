// Test de bout en bout sur le serveur compilé : 3 humains (socket.io) + 2 bots jouent une partie complète,
// un spectateur arrive en cours de route, un joueur se déconnecte puis revient ; puis une revanche à 8, la table pleine.
// À chaque état reçu, on vérifie qu'aucune carte cachée ne fuite. Usage : npm run build && npm run e2e
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = 3900 + Math.floor(Math.random() * 90);
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['dist/server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), RO_FAST: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  server.kill();
  process.exit(1);
};
setTimeout(() => fail('délai dépassé (3 min)'), 180_000).unref();

await new Promise((resolve) => server.stdout.on('data', (d) => String(d).includes('prêt') && resolve()));

/** Le calendrier attendu, recopié des règles : une sortie toutes les 3 manches jusqu'à 3 détenus, puis 6 manches de finale. */
const expectedTotal = (n) => 3 * (n - 3) + 6;
const stats = { states: 0, picks: 0, keeps: 0, refused: 0, wins: 0, empty: 0, releases: 0, forced: 0, rests: 0 };

function client(name, { player = true, avatar = 'renard' } = {}) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const c = { name, socket, view: null, avatar, player, session: null };
  socket.on('state', (v) => {
    c.view = v;
    audit(c, v);
    if (c.player) play(c);
  });
  c.call = (event, payload = {}) => new Promise((res) => socket.emit(event, payload, res));
  return c;
}

/** Ce que reçoit chaque client : ses cartes seulement, les paires une fois toutes posées, les cartes jouées une fois toutes choisies. */
function audit(c, v) {
  stats.states++;
  const json = JSON.stringify(v);
  for (const word of ['"token":', '"hands":', '"picks":', '"rest":', '"memory":', '"intent":', '"lastWin":']) if (json.includes(word)) fail(`la vue contient ${word}`);
  const g = v.game;
  if (v.phase !== 'playing' || !g) return;
  const me = v.players.find((p) => p.id === v.me);
  const inCell = g.order.includes(v.me) && me.fate === 'in';
  const active = v.players.filter((p) => g.order.includes(p.id) && p.fate === 'in').map((p) => p.id);
  if (g.total !== expectedTotal(g.order.length)) fail(`calendrier faux : ${g.total} manches à ${g.order.length}`);

  // Mes cartes, et seulement les miennes.
  if (inCell !== Array.isArray(g.cards)) fail(`${c.name} : cartes reçues à tort (${me.fate})`);
  if (!inCell && (g.myPair || g.myPlay !== null)) fail(`${c.name} : un choix visible hors cellule`);
  if (g.cards) {
    if (g.cards.length !== 8 || g.cards.some((x, i) => x.value !== i + 1)) fail(`${c.name} : il faut les huit cartes, rangées`);
    if (g.cards.filter((x) => x.state === 'rest').length > 1) fail(`${c.name} : deux cartes au repos`);
  }
  const state = (n) => g.cards?.find((x) => x.value === n)?.state;

  if (g.stage === 'pick') {
    if (g.pairs || g.result || g.release || g.myPlay !== null) fail(`${c.name} : quelque chose est dévoilé pendant la pose`);
    if (g.myPair && g.myPair.some((n) => state(n) !== 'ready')) fail(`${c.name} : paire posée avec une carte indisponible`);
  }
  if (g.forced) {
    if (g.stage !== 'pick' && g.stage !== 'keep') fail(`${c.name} : pose d'office signalée hors pose`);
    if (g.stage === 'keep') stats.forced++;
    if (!g.myPair || g.cards.filter((x) => x.state === 'ready').length !== 2) fail(`${c.name} : pose d'office alors qu'il reste un choix`);
  }
  if (g.stage === 'keep') {
    if (!g.pairs || g.result || g.release) fail(`${c.name} : mauvaise information au moment de garder`);
    const ids = Object.keys(g.pairs).sort();
    if (ids.join() !== [...active].sort().join()) fail(`${c.name} : les paires ne sont pas celles des détenus`);
    for (const id of ids) {
      const [a, b] = g.pairs[id];
      if (!(a < b) || a < 1 || b > 8) fail('paire invalide');
    }
    if (inCell && g.pairs[v.me].join() !== g.myPair?.join()) fail(`${c.name} : sa paire ne correspond pas`);
    if (g.myPlay !== null && !g.myPair.includes(g.myPlay)) fail(`${c.name} : joue une carte hors de sa paire`);
  }
  if (g.stage === 'result') {
    const r = g.result;
    if (!r || !g.pairs || g.release) fail(`${c.name} : résultat incomplet`);
    const plays = Object.entries(r.plays);
    for (const [id, n] of plays) if (!g.pairs[id]?.includes(n)) fail('une carte jouée ne vient pas de la paire posée');
    const count = new Map();
    for (const [, n] of plays) count.set(n, (count.get(n) ?? 0) + 1);
    const singles = [...count].filter(([, k]) => k === 1).map(([n]) => n);
    const best = singles.length ? Math.min(...singles) : null;
    if (r.value !== best) fail(`le plus petit nombre seul est ${best}, pas ${r.value}`);
    if (best !== null && r.plays[r.winner] !== best) fail('le gagnant n’a pas joué le nombre gagnant');
    if (best === null && r.winner !== null) fail('un gagnant sans nombre seul');
    if (r.dupes.join() !== [...count].filter(([, k]) => k > 1).map(([n]) => n).sort((a, b) => a - b).join()) fail('doublons faux');
    // La carte jouée disparaît, l'autre se repose.
    if (inCell) {
      const other = g.myPair.find((n) => n !== g.myPlay);
      if (state(g.myPlay) !== 'used' || state(other) !== 'rest') fail(`${c.name} : la carte jouée ou retirée n'a pas le bon état`);
    }
  }
  if (g.stage === 'release') {
    const r = g.release;
    if (!r || g.pairs || g.result) fail(`${c.name} : comptes incomplets`);
    for (const l of r.lines) if (l.total !== l.points + l.tokens) fail('comptes faux');
    for (let i = 1; i < r.lines.length; i++) if (r.lines[i].total > r.lines[i - 1].total) fail('comptes mal rangés');
    if (r.final ? r.free.length !== r.lines.length - 1 || !r.out : r.free.length !== 1 || r.out) fail('nombre de sortants faux');
    if (r.free[0] !== r.lines[0].id) fail('le premier des comptes ne sort pas');
  }
}

const busy = new Set();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Un joueur moyen : il pose deux cartes au hasard et en garde une au hasard ; parfois, il tente un coup interdit. */
function play(c) {
  const v = c.view;
  const g = v?.game;
  if (!v || v.phase !== 'playing' || !g || !g.cards) return;
  const me = v.players.find((p) => p.id === v.me);
  if (me.ready) return;
  const send = (key, event, payload, expectOk = true) => {
    if (busy.has(key)) return;
    busy.add(key);
    c.socket.emit(event, payload, (res) => {
      if (res?.ok !== expectOk) fail(`${c.name} : ${event} ${JSON.stringify(payload)} → ${JSON.stringify(res)}`);
      if (!res?.ok) stats.refused++;
    });
  };
  if (g.stage === 'pick' && !g.myPair) {
    const ready = g.cards.filter((x) => x.state === 'ready').map((x) => x.value);
    const resting = g.cards.find((x) => x.state === 'rest')?.value;
    if (resting && Math.random() < 0.3) {
      stats.rests++;
      send(`${c.name}:rest:${g.seq}`, 'game:pick', { pair: [resting, ready[0]], seq: g.seq }, false);
    }
    if (Math.random() < 0.1) send(`${c.name}:stale:${g.seq}`, 'game:pick', { pair: ready.slice(0, 2), seq: g.seq - 1 }, false);
    const a = pick(ready);
    const b = pick(ready.filter((x) => x !== a));
    stats.picks++;
    return send(`${c.name}:pick:${g.seq}`, 'game:pick', { pair: [a, b], seq: g.seq });
  }
  if (g.stage === 'keep' && g.myPlay === null) {
    const outside = g.cards.find((x) => !g.myPair.includes(x.value))?.value;
    if (Math.random() < 0.1) send(`${c.name}:outside:${g.seq}`, 'game:keep', { card: outside, seq: g.seq }, false);
    stats.keeps++;
    return send(`${c.name}:keep:${g.seq}`, 'game:keep', { card: pick(g.myPair), seq: g.seq });
  }
}

const waitPhase = (c, phase) =>
  new Promise((resolve) => {
    const check = setInterval(() => {
      if (c.view?.phase === phase) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });

/** L'ordre de sortie : 1 à n sans trou, le dernier reste en cellule, le premier gagne. */
function checkFinal(final, players) {
  if (!final || final.players.length !== players) fail(`table finale incomplète (${final?.players.length})`);
  if (final.rounds !== expectedTotal(players)) fail(`la partie a duré ${final.rounds} manches au lieu de ${expectedTotal(players)}`);
  const places = final.players.map((p) => p.place);
  if (places.join() !== Array.from({ length: players }, (_, i) => i + 1).join()) fail(`places incohérentes : ${places}`);
  const out = final.players.filter((p) => p.fate === 'out');
  if (out.length !== 1 || out[0].place !== players) fail('il faut un seul détenu en cellule, à la dernière place');
  if (!final.players[0].winner || final.players.filter((p) => p.winner).length !== 1) fail('gagnant mal marqué');
  for (let i = 1; i < final.players.length; i++) if (final.players[i].round < final.players[i - 1].round) fail('ordre de sortie incohérent avec les manches');
  return final.players[0];
}

// ── Partie 1 : 3 humains + 2 bots ──
const host = client('Ana');
await new Promise((r) => host.socket.on('connect', r));
// Les résultats de chaque manche, vus par l'hôte.
host.socket.on('state', (v) => {
  const r = v.game?.stage === 'result' ? v.game.result : null;
  const key = r && `${v.code}:${v.game.round}`;
  if (!r || host.seen?.has(key)) return;
  (host.seen ??= new Set()).add(key);
  r.winner ? stats.wins++ : stats.empty++;
});
host.socket.on('state', (v) => {
  if (v.game?.stage !== 'release') return;
  const key = `r:${v.code}:${v.game.round}`;
  if (host.seen?.has(key)) return;
  (host.seen ??= new Set()).add(key);
  stats.releases++;
});

const created = await host.call('room:create', { name: 'Ana', avatar: 'renard', bots: 2 });
if (!created.ok) fail(`création : ${created.error}`);
const code = created.data.code;
const bob = client('Bob');
const chloe = client('Chloé');
await Promise.all([bob, chloe].map((c) => new Promise((r) => c.socket.on('connect', r))));
for (const c of [bob, chloe]) {
  const res = await c.call('room:join', { code, name: c.name, avatar: 'loup' });
  if (!res.ok) fail(`arrivée de ${c.name} : ${res.error}`);
  c.session = res.data;
}
if (!(await host.call('room:settings', { think: 30 })).ok) fail('réglages refusés');
await host.call('room:settings', { think: 45 });
await new Promise((r) => setTimeout(r, 100));
if (host.view.settings.think !== 30) fail('un temps hors liste a été accepté');
if ((await bob.call('room:settings', { think: 0 })).ok) fail('un invité a changé les réglages');
if ((await bob.call('game:start')).ok) fail('un invité a lancé la partie');
const start = await host.call('game:start');
if (!start.ok) fail(`lancement : ${start.error}`);

// Un spectateur arrive en cours de partie : il voit la table, pas les cartes en main.
await new Promise((r) => setTimeout(r, 300));
const watcher = client('Dora', { player: false, avatar: 'chouette' });
await new Promise((r) => watcher.socket.on('connect', r));
const joined = await watcher.call('room:join', { code, name: 'Dora', avatar: 'chouette' });
if (!joined.ok) fail(`spectateur : ${joined.error}`);
watcher.session = joined.data;
await new Promise((r) => setTimeout(r, 100));
if (watcher.view.players.find((p) => p.name === 'Dora')?.status !== 'spectator') fail('la retardataire devrait regarder');
if (watcher.view.game.cards !== null) fail('le spectateur reçoit des cartes');

// Bob se déconnecte un moment, puis revient avec sa session.
await new Promise((r) => setTimeout(r, 400));
bob.socket.disconnect();
await new Promise((r) => setTimeout(r, 900));
bob.socket.connect();
await new Promise((r) => bob.socket.on('connect', r));
const back = await bob.call('room:join', { code, playerId: bob.session.playerId, token: bob.session.token, resumeOnly: true });
if (!back.ok) fail(`retour de Bob : ${back.error}`);
const intruder = await chloe.call('room:join', { code, playerId: bob.session.playerId, token: 'faux', resumeOnly: true });
if (intruder.ok) fail('une session volée a été acceptée');

await waitPhase(host, 'finished');
const w1 = checkFinal(host.view.final, 5);
if (!host.view.players.some((p) => p.wins === 1)) fail('la victoire n’est pas comptée');
if (stats.releases !== 3) fail(`3 comptes attendus à 5 joueurs, ${stats.releases} vus`);
const rounds1 = host.view.final.rounds;

// ── Partie 2 : revanche à 8, la table pleine (Dora s'assoit, deux bots de plus) ──
if ((await bob.call('game:restart')).ok) fail('un invité a relancé la partie');
if (!(await host.call('game:restart')).ok) fail('revanche refusée');
await new Promise((r) => setTimeout(r, 150));
if (host.view.phase !== 'lobby') fail('la revanche ne ramène pas au salon');
// Les numéros d'état repartent de zéro : on oublie les coups déjà envoyés.
busy.clear();
host.seen = new Set();
stats.releases = 0;
watcher.player = true;
for (let i = 0; i < 2; i++) if (!(await host.call('room:addBot')).ok) fail('ajout de bot refusé');
// L'accusé de réception arrive avant le nouvel état : on laisse le temps à la vue de suivre.
await new Promise((r) => setTimeout(r, 150));
const seatedNow = host.view.players.filter((p) => p.status !== 'spectator').length;
if (seatedNow !== 8) fail(`8 joueurs attendus au salon, ${seatedNow} trouvés`);
if ((await host.call('room:addBot')).ok) fail('un neuvième joueur a été accepté');
if (!(await host.call('room:settings', { think: 0 })).ok) fail('réglage sans limite refusé');
if (!(await host.call('game:start')).ok) fail('lancement de la revanche refusé');
await new Promise((r) => setTimeout(r, 50));
if (host.view.game.total !== 21) fail(`21 manches attendues à 8, ${host.view.game.total} trouvées`);

await waitPhase(host, 'finished');
const w2 = checkFinal(host.view.final, 8);
if (stats.releases !== 6) fail(`6 comptes attendus à 8 joueurs, ${stats.releases} vus`);
if (!stats.forced) fail('aucune pose d’office vue : la dernière manche d’un cycle devrait en donner');

console.log(`✓ partie 1 (5 joueurs) : ${rounds1} manches, ${w1.name} sort en premier.`);
console.log(`✓ partie 2 (8 joueurs, sans limite) : ${host.view.final.rounds} manches, ${w2.name} sort en premier.`);
console.log(
  `  ${stats.picks} paires posées et ${stats.keeps} cartes gardées par les humains, ${stats.forced} poses d'office vues, ${stats.wins} manches gagnées et ${stats.empty} sans nombre seul, ${stats.refused} coups interdits refusés (dont ${stats.rests} cartes au repos), ${stats.states} états vérifiés sans fuite.`,
);
for (const c of [host, bob, chloe, watcher]) c.socket.close();
server.kill();
process.exit(0);
