// La table : le calendrier en haut, les cellules des autres détenus, la consigne du moment, puis ton plateau et tes huit cartes.
import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, Bot, Check, DoorOpen, Flag, Lock, LogOut, MoreHorizontal, RotateCcw, Smile, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { EMOTES, TAUNTS, type GameView, type PlayerView, type RoomView } from '../../../shared/protocol';
import { Plate, type PlateMark } from '../components/Plate';
import { Avatar, Button, Logo, Modal, Tokens } from '../components/Ui';
import { sfx } from '../lib/sound';
import { listing, nameOf, placeLabel, tieText } from '../lib/text';
import { cls, plural, reducedMotion, useTick, vibrate } from '../lib/util';
import { leaveRoom, send, socket } from '../net';
import { useStore, type Emote } from '../store';

const CONFETTI = ['#ff5a1f', '#191714', '#f4f1ea', '#8e959b', '#ffb36b'];

function burst(el: Element | null, count = 70): void {
  if (!el || reducedMotion()) return;
  const r = el.getBoundingClientRect();
  void confetti({
    particleCount: count,
    spread: 75,
    startVelocity: 30,
    origin: { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight },
    colors: CONFETTI,
    shapes: ['square'],
    scalar: 0.85,
    disableForReducedMotion: true,
  });
}

function TurnTimer({ endsAt, think }: { endsAt: number; think: number }) {
  const now = useTick(250);
  if (!endsAt) return null;
  const span = Math.max(1500, think * 1000);
  const left = Math.max(0, endsAt - now);
  return (
    <span className={cls('turn-timer', left < 8000 && 'is-low')} role="timer" aria-label={`${Math.ceil(left / 1000)} secondes`}>
      <span style={{ width: `${Math.min(100, (left / span) * 100)}%` }} />
    </span>
  );
}

/** La marque d'une carte posée, une fois les cartes jouées dévoilées. */
function markFor(g: GameView, id: string, value: number): PlateMark {
  const r = g.result;
  if (!r) return null;
  if (r.plays[id] !== value) return 'removed';
  if (r.winner === id) return 'win';
  if (r.dupes.includes(value)) return 'dupe';
  return 'played';
}

/** Sons, vibrations et confettis : tout se déduit de l'état reçu. */
function useTableEffects(view: RoomView) {
  const g = view.game!;
  const prev = useRef<{ key: string; stage: string } | null>(null);
  useLayoutEffect(() => {
    const key = `${g.round}:${g.stage}`;
    const before = prev.current;
    prev.current = { key, stage: g.stage };
    if (before?.key === key) return;
    const me = view.players.find((p) => p.id === view.me);
    const inCell = me?.fate === 'in';
    if (!before) {
      if (g.round === 1 && g.stage === 'pick') sfx.start();
      return;
    }
    if (g.stage === 'pick' && inCell && !g.forced) {
      window.setTimeout(() => sfx.turn(), 120);
      vibrate(25);
    }
    if (g.stage === 'keep') {
      sfx.reveal();
      if (inCell) vibrate(20);
    }
    if (g.stage === 'result' && g.result) {
      sfx.drop();
      const mine = g.result.winner === view.me;
      window.setTimeout(() => (g.result?.winner ? sfx.win(mine) : sfx.buzz()), 380);
      if (mine) {
        vibrate([30, 40, 80]);
        window.setTimeout(() => burst(document.querySelector('.tray'), 80), 420);
      }
    }
    if (g.stage === 'release' && g.release) {
      sfx.release();
      const r = g.release;
      window.setTimeout(() => {
        if (r.free.includes(view.me)) {
          sfx.freed();
          vibrate([40, 60, 120]);
          burst(document.querySelector('.release-card'), 120);
        } else if (r.out === view.me) {
          sfx.locked();
          vibrate([200, 80, 300]);
        }
      }, 1700);
    }
  });
}

function ReactionTray({ onClose }: { onClose: () => void }) {
  const emit = (emoji: string) => {
    socket.emit('emote', { emoji });
    onClose();
  };
  return (
    <motion.div className="reactions" role="menu" aria-label="Réactions" initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
      <div className="reaction-emojis">
        {EMOTES.map((e) => (
          <button key={e} type="button" role="menuitem" onClick={() => emit(e)} aria-label={`Réaction ${e}`}>
            {e}
          </button>
        ))}
      </div>
      <div className="reaction-taunts">
        {TAUNTS.map((t) => (
          <button key={t} type="button" role="menuitem" onClick={() => emit(t)}>
            {t}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function Bubbles({ emotes }: { emotes: Emote[] }) {
  return (
    <AnimatePresence>
      {emotes.slice(-1).map((e) => (
        <motion.span key={e.id} className={cls('bubble', e.emoji.length > 3 && 'is-text')} initial={{ scale: 0.4, y: 6, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ opacity: 0, y: -6 }}>
          {e.emoji}
        </motion.span>
      ))}
    </AnimatePresence>
  );
}

/** Le calendrier : une case par manche, une porte pour chaque sortie, une flèche quand les cartes reviennent. */
function Rail({ g }: { g: GameView }) {
  return (
    <div className="rail" aria-label={`Manche ${g.round} sur ${g.total}`}>
      <div className="rail-track" style={{ gridTemplateColumns: `repeat(${g.total}, 1fr)` }}>
        {Array.from({ length: g.total }, (_, i) => {
          const r = i + 1;
          return (
            <span
              key={r}
              className={cls('rail-cell', r < g.round && 'is-done', r === g.round && 'is-now', g.releases.includes(r) && 'is-release', r >= g.finalStart && 'is-final', g.refills.includes(r) && 'is-refill')}
            >
              {g.releases.includes(r) && <DoorOpen size={10} aria-hidden />}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** La cellule d'un autre détenu : son nom, ses jetons, ses points, et ses deux cartes quand elles sont dévoilées. */
function Cell({ view, p, emotes }: { view: RoomView; p: PlayerView; emotes: Emote[] }) {
  const g = view.game!;
  const pair = g.pairs?.[p.id] ?? null;
  const winner = g.result?.winner === p.id;
  let status: string | null = null;
  if (g.stage === 'pick') status = p.ready ? 'a posé' : 'choisit…';
  else if (g.stage === 'keep') status = p.ready ? 'a choisi' : 'hésite…';
  const choosing = g.stage === 'pick' || g.stage === 'keep';
  return (
    <motion.div layout className={cls('cell', winner && 'is-winner', p.ready && 'is-ready', !p.connected && 'is-off')} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
      <div className="cell-head">
        <span className="cell-avatar">
          <Avatar avatar={p.avatar} />
          <Bubbles emotes={emotes} />
        </span>
        <span className="cell-name">{p.name}</span>
      </div>
      <div className="cell-pair">
        {pair ? (
          pair.map((v) => (
            <motion.span key={`${g.round}-${v}`} initial={{ rotateY: 90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ duration: 0.3 }}>
              <Plate value={v} size="sm" mark={markFor(g, p.id, v)} />
            </motion.span>
          ))
        ) : g.stage === 'pick' && p.ready ? (
          <>
            <motion.span initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
              <Plate back size="sm" />
            </motion.span>
            <motion.span initial={{ y: -14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.06 }}>
              <Plate back size="sm" />
            </motion.span>
          </>
        ) : (
          <>
            <span className="slot is-sm" />
            <span className="slot is-sm" />
          </>
        )}
      </div>
      <div className="cell-foot">
        <span className="cell-score">
          <b>{p.points}</b>
          <small>pt{p.points > 1 ? 's' : ''}</small>
          <Tokens n={p.tokens} />
        </span>
        {p.autopilot ? (
          <span className="cell-state is-auto" title="Pilote automatique" aria-label="Pilote automatique">
            <Bot size={13} aria-hidden />
          </span>
        ) : !p.connected ? (
          <span className="cell-state is-auto" title="Absent" aria-label="Absent">
            <WifiOff size={13} aria-hidden />
          </span>
        ) : (
          choosing &&
          status && (
            <span className={cls('cell-state', p.ready ? 'is-ready' : 'is-thinking')} title={status} aria-label={status}>
              {p.ready ? <Check size={13} strokeWidth={3} aria-hidden /> : <i aria-hidden />}
            </span>
          )
        )}
      </div>
      {winner && (
        <motion.span className="cell-stamp" initial={{ scale: 2.2, opacity: 0, rotate: -18 }} animate={{ scale: 1, opacity: 1, rotate: -8 }} transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.25 }}>
          +{g.result!.value}
        </motion.span>
      )}
    </motion.div>
  );
}

/** Ceux qui sont sortis, et celui qui reste en cellule à la fin. */
function OutStrip({ view, leaving }: { view: RoomView; leaving: Set<string> }) {
  const out = view.players.filter((p) => (p.fate === 'free' || p.fate === 'out') && !leaving.has(p.id)).sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  if (!out.length) return null;
  return (
    <div className="out-strip" aria-label="Sortis de prison">
      <span className="out-label">
        <DoorOpen size={13} aria-hidden /> Dehors
      </span>
      {out.map((p) => (
        <span key={p.id} className={cls('out-chip', p.fate === 'out' && 'is-locked', p.id === view.me && 'is-me')}>
          <b>{placeLabel(p.place ?? 0)}</b>
          <Avatar avatar={p.avatar} />
          <span>{p.id === view.me ? 'Toi' : p.name}</span>
        </span>
      ))}
    </div>
  );
}

/** La consigne du moment, ou le résultat de la manche. */
function Banner({ view }: { view: RoomView }) {
  const g = view.game!;
  const me = view.players.find((p) => p.id === view.me);
  const inCell = me?.fate === 'in';
  const last = g.round === g.releases.find((r) => r >= g.round);
  const final = g.round >= g.finalStart;
  let title = '';
  let sub: string | null = null;
  let tone = '';
  if (g.stage === 'pick') {
    title = inCell ? (g.forced ? 'Tes deux dernières cartes sont posées' : 'Pose deux cartes') : 'Tout le monde pose deux cartes';
    const next = g.releases.find((r) => r >= g.round)!;
    sub = last ? (final ? 'Dernière manche : les deux meilleurs sortent.' : 'Comptes à la fin de cette manche : le meilleur sort.') : `Prochains comptes à la fin de la manche ${next}.`;
  } else if (g.stage === 'keep') {
    title = inCell ? 'Garde la carte que tu joues' : 'Tout le monde choisit sa carte';
    sub = inCell && g.forced ? 'Il ne te restait que ces deux cartes : elles sont posées d’office.' : 'Les paires de tout le monde sont dévoilées.';
  } else if (g.stage === 'result' && g.result) {
    const r = g.result;
    if (r.winner) {
      tone = r.winner === view.me ? 'is-mine' : 'is-win';
      title = r.winner === view.me ? `Ton ${r.value} gagne !` : `${nameOf(view, r.winner)} gagne avec le ${r.value}`;
      sub = `+${plural(r.value!, 'point')} et un jeton.${r.dupes.length ? ` En double : ${listing(r.dupes.map(String))}.` : ''}`;
    } else {
      tone = 'is-none';
      title = 'Aucun nombre seul';
      sub = `Tout est en double (${listing(r.dupes.map(String))}) : personne ne marque.`;
    }
  } else if (g.stage === 'release') {
    title = g.release?.final ? 'Les comptes de la finale' : 'Les comptes';
  }
  return (
    <div className={cls('banner', tone)} role="status" aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.div key={`${g.round}-${g.stage}`} className="banner-body" initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -6, opacity: 0 }} transition={{ duration: 0.2 }}>
          <b className="banner-title">{title}</b>
          {sub && <span className="banner-sub">{sub}</span>}
        </motion.div>
      </AnimatePresence>
      {(g.stage === 'pick' || g.stage === 'keep') && <TurnTimer endsAt={g.endsAt} think={view.settings.think} />}
    </div>
  );
}

/** Les comptes : qui sort, qui reste, et pourquoi. */
function ReleaseCard({ view }: { view: RoomView }) {
  const g = view.game!;
  const r = g.release!;
  const tie = tieText(r.tie);
  return (
    <motion.div className="release" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="release-card" initial={{ y: 40, scale: 0.92 }} animate={{ y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 240, damping: 20 }}>
        <header className="release-head">
          <span>{r.final ? 'Finale' : `Manche ${g.round}`}</span>
          <b>Les comptes</b>
        </header>
        <p className="release-rule">Points + un par jeton</p>
        <ol className="release-lines">
          {r.lines.map((l, i) => {
            const p = view.players.find((x) => x.id === l.id);
            const free = r.free.includes(l.id);
            const out = r.out === l.id;
            return (
              <motion.li key={l.id} className={cls('release-line', free && 'is-free', out && 'is-out', l.id === view.me && 'is-me')} initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.35 + i * 0.08 }}>
                <span className="rl-rank">{i + 1}</span>
                <Avatar avatar={p?.avatar ?? ''} />
                <span className="rl-who">
                  <span className="rl-name">{l.id === view.me ? 'Toi' : (p?.name ?? '?')}</span>
                  {free && (
                    <motion.span className="rl-stamp is-free" initial={{ scale: 2.4, opacity: 0, rotate: -16 }} animate={{ scale: 1, opacity: 1, rotate: -4 }} transition={{ delay: 1.5, type: 'spring', stiffness: 380, damping: 16 }}>
                      <DoorOpen size={12} aria-hidden /> dehors
                    </motion.span>
                  )}
                  {out && (
                    <motion.span className="rl-stamp is-out" initial={{ scale: 2.4, opacity: 0, rotate: 14 }} animate={{ scale: 1, opacity: 1, rotate: 3 }} transition={{ delay: 1.7, type: 'spring', stiffness: 380, damping: 16 }}>
                      <Lock size={12} aria-hidden /> en cellule
                    </motion.span>
                  )}
                </span>
                <span className="rl-sum" aria-label={`${l.points} points et ${l.tokens} jetons : ${l.total}`}>
                  <small>
                    {l.points} + {l.tokens}
                  </small>
                  <b>{l.total}</b>
                </span>
              </motion.li>
            );
          })}
        </ol>
        {tie && <p className="release-tie">{tie}</p>}
        {!r.final && <p className="release-note">Les autres repartent de zéro point. Les jetons restent.</p>}
      </motion.div>
    </motion.div>
  );
}

/** Mon plateau : mes deux cartes posées, puis celle que je joue. */
function Tray({ view, sel, busy, onKeep }: { view: RoomView; sel: number[]; busy: boolean; onKeep: (v: number) => void }) {
  const g = view.game!;
  const pair = g.myPair;
  const canKeep = g.stage === 'keep' && !!pair && g.myPlay === null && !busy;
  const shown: (number | null)[] = pair ? [pair[0], pair[1]] : [sel[0] ?? null, sel[1] ?? null];
  return (
    <div className={cls('tray', canKeep && 'is-live', g.stage === 'pick' && !pair && 'is-picking')}>
      {shown.map((v, i) =>
        v === null ? (
          <span key={`empty${i}`} className="slot is-md">
            <small>{i + 1}</small>
          </span>
        ) : canKeep ? (
          <motion.button key={v} type="button" className="tray-btn" onClick={() => onKeep(v)} aria-label={`Jouer le ${v}`} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} whileTap={{ scale: 0.95 }}>
            <Plate value={v} size="lg" />
            <span className="tray-play">Jouer</span>
          </motion.button>
        ) : (
          <motion.span key={v} className="tray-plate" layout initial={{ y: 12, opacity: 0 }} animate={{ y: g.myPlay === v ? -6 : 0, opacity: 1 }}>
            <Plate value={v} size="lg" mark={g.stage === 'result' ? markFor(g, view.me, v) : g.myPlay !== null ? (g.myPlay === v ? 'played' : 'removed') : null} selected={!pair} />
          </motion.span>
        ),
      )}
    </div>
  );
}

/** Mes huit cartes : prêtes, au repos, ou déjà jouées. */
function Hand({ view, sel, canPick, onToggle }: { view: RoomView; sel: number[]; canPick: boolean; onToggle: (v: number) => void }) {
  const g = view.game!;
  const cards = g.cards ?? [];
  const inPair = new Set(g.stage === 'pick' || g.stage === 'keep' ? (g.myPair ?? []) : []);
  return (
    <div className="hand" aria-label="Tes cartes">
      {cards.map((c) => {
        const picked = sel.includes(c.value) || inPair.has(c.value);
        const live = canPick && c.state === 'ready';
        if (c.state === 'used') {
          return (
            <span key={c.value} className="hand-slot is-used" aria-label={`${c.value} déjà joué`}>
              <span className="slot is-hand">
                <small>{c.value}</small>
              </span>
            </span>
          );
        }
        return (
          <motion.button
            key={c.value}
            type="button"
            className={cls('hand-slot', live && 'is-live', picked && 'is-picked')}
            disabled={!live}
            onClick={() => onToggle(c.value)}
            aria-label={c.state === 'rest' ? `${c.value} au repos` : `Carte ${c.value}`}
            aria-pressed={picked}
            animate={{ y: picked ? -10 : 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 26 }}
          >
            <Plate value={c.value} size="md" state={c.state} selected={picked} />
          </motion.button>
        );
      })}
    </div>
  );
}

export function Table({ view }: { view: RoomView }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const emotes = useStore((s) => s.emotes);
  const [menu, setMenu] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [react, setReact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<number[]>([]);
  const g = view.game!;
  useTableEffects(view);

  const me = view.players.find((p) => p.id === view.me);
  const seated = g.order.includes(view.me);
  const inCell = me?.fate === 'in';
  const isHost = view.hostId === view.me;
  const n = g.order.length;
  const start = seated ? g.order.indexOf(view.me) + 1 : 0;
  const leaving = new Set(g.stage === 'release' && g.release ? [...g.release.free, ...(g.release.out ? [g.release.out] : [])] : []);
  const others = Array.from({ length: seated ? n - 1 : n }, (_, i) => view.players.find((p) => p.id === g.order[(start + i) % n]))
    .filter((p): p is PlayerView => !!p)
    .filter((p) => p.fate === 'in' || leaving.has(p.id));
  const canPick = inCell && g.stage === 'pick' && !g.myPair && !busy;
  const waitingFor = view.players.filter((p) => p.fate === 'in' && !p.ready && p.id !== view.me && (g.stage === 'pick' || g.stage === 'keep'));

  // La sélection repart de zéro à chaque manche.
  useEffect(() => {
    setSel([]);
  }, [g.round, g.stage]);

  const act = useCallback(async (event: string, payload: Record<string, unknown>) => {
    setBusy(true);
    await send(event, payload);
    setBusy(false);
  }, []);

  const toggle = (v: number) => {
    sfx.tap();
    setSel((s) => (s.includes(v) ? s.filter((x) => x !== v) : s.length >= 2 ? [s[1], v] : [...s, v]));
  };
  const pickNow = () => {
    if (sel.length !== 2 || !canPick) return;
    sfx.place();
    vibrate(15);
    void act('game:pick', { pair: [...sel].sort((a, b) => a - b), seq: g.seq });
  };
  const keepNow = (v: number) => {
    sfx.place();
    vibrate(15);
    void act('game:keep', { card: v, seq: g.seq });
  };

  const sorted = [...sel].sort((a, b) => a - b);
  let action: ReactNode = null;
  if (inCell && g.stage === 'pick') {
    action = g.myPair ? (
      <p className="wait-line">
        {g.forced ? 'Posées d’office. ' : 'Posées. '}
        {waitingFor.length ? `On attend ${listing(waitingFor.map((p) => p.name))}…` : 'Dévoilement…'}
      </p>
    ) : (
      <Button variant="primary" className="btn-wide pick-btn" disabled={sel.length !== 2 || busy} onClick={pickNow}>
        {sel.length === 2 ? `Poser le ${sorted[0]} et le ${sorted[1]}` : sel.length === 1 ? 'Choisis une deuxième carte' : 'Touche deux cartes'}
      </Button>
    );
  } else if (inCell && g.stage === 'keep') {
    action =
      g.myPlay === null ? (
        <p className="wait-line is-strong">L’autre carte sera retirée.</p>
      ) : (
        <p className="wait-line">
          Tu joues le <b>{g.myPlay}</b>. {waitingFor.length ? `On attend ${listing(waitingFor.map((p) => p.name))}…` : ''}
        </p>
      );
  }

  return (
    <div className={cls('table-screen', `is-${others.length}o`, inCell && (g.stage === 'pick' || g.stage === 'keep') && !me?.ready && 'is-my-turn')}>
      <div className="table-bg" aria-hidden />
      <header className="table-top">
        <span className="table-logo">
          <Logo size="sm" />
        </span>
        <span className="round-chip">
          <small>{g.round >= g.finalStart ? 'Finale' : 'Manche'}</small>
          <b>
            {g.round}
            <i>/{g.total}</i>
          </b>
        </span>
        <div className="table-tools">
          <button type="button" className={cls('icon-btn', react && 'is-on')} aria-label="Réagir" aria-expanded={react} onClick={() => setReact((x) => !x)}>
            <Smile size={20} />
          </button>
          <button type="button" className="icon-btn" aria-label="Menu" onClick={() => setMenu(true)}>
            <MoreHorizontal size={20} />
          </button>
        </div>
        {react && <ReactionTray onClose={() => setReact(false)} />}
      </header>

      <Rail g={g} />

      <section className={cls('cells', `has-${others.length}`)} aria-label="Les autres détenus">
        {others.map((o) => (
          <Cell key={o.id} view={view} p={o} emotes={emotes.filter((e) => e.playerId === o.id)} />
        ))}
      </section>

      <OutStrip view={view} leaving={leaving} />

      <Banner view={view} />

      <section className={cls('me-zone', inCell && 'is-in')}>
        {inCell && me ? (
          <>
            <Tray view={view} sel={sel} busy={busy} onKeep={keepNow} />
            <div className="me-action">{action}</div>
            <Hand view={view} sel={sel} canPick={canPick} onToggle={toggle} />
            <div className="me-foot">
              <span className="me-avatar">
                <Avatar avatar={me.avatar} />
                <Bubbles emotes={emotes.filter((e) => e.playerId === view.me)} />
              </span>
              <span className="me-name">{me.name}</span>
              <span className="me-score">
                <b>{me.points}</b> pt{me.points > 1 ? 's' : ''}
                <Tokens n={me.tokens} />
              </span>
              {g.refills.some((r) => r > g.round) && (
                <span className="me-refill" title="Les cartes reviennent">
                  <RotateCcw size={12} aria-hidden /> cartes à la {g.refills.find((r) => r > g.round)}
                </span>
              )}
            </div>
          </>
        ) : me && seated ? (
          <div className="me-off">
            {me.fate === 'out' ? (
              <>
                <Lock size={18} aria-hidden /> Tu restes en cellule.
              </>
            ) : (
              <>
                <DoorOpen size={18} aria-hidden /> Tu es dehors, {placeLabel(me.place ?? 1)} place. Tu regardes la suite.
              </>
            )}
          </div>
        ) : (
          <p className="me-off">Tu regardes la partie : tu joueras à la prochaine.</p>
        )}
      </section>

      <AnimatePresence>{g.stage === 'release' && g.release && <ReleaseCard view={view} />}</AnimatePresence>

      <Modal
        open={menu}
        onClose={() => {
          setMenu(false);
          setConfirmStop(false);
        }}
        title="Menu"
      >
        <div className="menu-list">
          <Button icon={prefs.sound ? <Volume2 size={18} /> : <VolumeX size={18} />} onClick={() => setPrefs({ sound: !prefs.sound })}>
            Son : {prefs.sound ? 'activé' : 'coupé'}
          </Button>
          <Button
            icon={<BookOpen size={18} />}
            onClick={() => {
              setMenu(false);
              setRulesOpen(true);
            }}
          >
            Les règles
          </Button>
          {isHost && (
            <Button
              variant="danger"
              icon={<Flag size={18} />}
              onClick={() => {
                // Deux appuis : un geste malheureux ne doit pas couper la partie de toute la table.
                if (!confirmStop) {
                  setConfirmStop(true);
                  return;
                }
                setConfirmStop(false);
                setMenu(false);
                void send('game:end');
              }}
            >
              {confirmStop ? 'Confirmer : arrêter pour tout le monde' : 'Arrêter la partie'}
            </Button>
          )}
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter la table
          </Button>
        </div>
      </Modal>
    </div>
  );
}
