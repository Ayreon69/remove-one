// Fin de partie : l'ordre de sortie, celui qui reste en cellule, les victoires de la soirée et la revanche.
import confetti from 'canvas-confetti';
import { motion } from 'framer-motion';
import { Lock, LogOut, RotateCcw, Trophy } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { RoomView } from '../../../shared/protocol';
import { Avatar, Backdrop, Button, Logo, Tokens } from '../components/Ui';
import { sfx } from '../lib/sound';
import { placeLabel } from '../lib/text';
import { cls, reducedMotion } from '../lib/util';
import { leaveRoom, send } from '../net';

export function Final({ view }: { view: RoomView }) {
  const final = view.final!;
  const isHost = view.hostId === view.me;
  const mine = final.players.find((p) => p.id === view.me);
  const first = final.players[0];
  const locked = final.players.find((p) => p.fate === 'out');
  const good = !!mine && mine.fate === 'free';
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    if (mine?.fate === 'out') sfx.locked();
    else sfx.fanfare(good);
    if (reducedMotion() || !good) return;
    const t = window.setTimeout(() => {
      void confetti({ particleCount: mine?.place === 1 ? 180 : 90, spread: 100, origin: { y: 0.3 }, colors: ['#ff5a1f', '#191714', '#f4f1ea', '#8e959b', '#ffb36b'], shapes: ['square'], scalar: 0.95, disableForReducedMotion: true });
    }, 400);
    return () => window.clearTimeout(t);
  }, [good, mine]);

  let title: string;
  let sub: string;
  if (!mine) {
    title = `${first?.name ?? '?'} sort en premier`;
    sub = locked ? `${locked.name} reste en cellule.` : '';
  } else if (mine.fate === 'out') {
    title = 'Tu restes en cellule';
    sub = `${first?.name ?? '?'} sort en premier, après la manche ${first?.round}.`;
  } else if (mine.place === 1) {
    title = 'Dehors en premier !';
    sub = `Dehors après la manche ${mine.round}.${locked ? ` ${locked.name} reste en cellule.` : ''}`;
  } else {
    title = `Dehors, ${placeLabel(mine.place)} place`;
    sub = `${first?.name ?? '?'} sort en premier.${locked ? ` ${locked.id === view.me ? 'Tu restes' : `${locked.name} reste`} en cellule.` : ''}`;
  }

  return (
    <Backdrop quiet>
      <div className="final">
        <header className="final-top">
          <Logo size="sm" />
          <Button variant="ghost" icon={<LogOut size={18} />} onClick={() => void leaveRoom()}>
            Quitter
          </Button>
        </header>

        <motion.section className={cls('final-hero', mine?.fate === 'out' && 'is-locked')} initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5 }}>
          <span className="eyebrow">Partie terminée en {final.rounds} manches</span>
          <h1>{title}</h1>
          <p className="final-reason">{sub}</p>
        </motion.section>

        <section className="panel final-table">
          <h3>L'ordre de sortie</h3>
          <ol className="final-list">
            {final.players.map((p, i) => (
              <motion.li
                key={p.id}
                className={cls('final-row', p.winner && 'is-winner', p.fate === 'out' && 'is-out', p.id === view.me && 'is-me')}
                initial={{ x: -14, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.25 + i * 0.07 }}
              >
                <span className="final-place">{p.fate === 'out' ? <Lock size={18} aria-label="En cellule" /> : placeLabel(p.place)}</span>
                <Avatar avatar={p.avatar} className="player-avatar" />
                <span className="final-who">
                  <b>{p.id === view.me ? 'Toi' : p.name}</b>
                  <small>{p.fate === 'out' ? 'reste en cellule' : `sortie à la manche ${p.round}`}</small>
                </span>
                <span className="final-marks">
                  <Tokens n={p.tokens} />
                  {p.wins > 0 && (
                    <span className="final-wins" title="Parties terminées à la première place, à cette table">
                      <Trophy size={13} aria-hidden /> {p.wins}
                    </span>
                  )}
                </span>
              </motion.li>
            ))}
          </ol>
          <p className="muted small">Les jetons comptent les manches gagnées. Le trophée compte les parties finies à la première place, ce soir.</p>
        </section>

        <div className="lobby-cta">
          {isHost ? (
            <Button variant="primary" className="btn-lg btn-wide" icon={<RotateCcw size={20} />} onClick={() => void send('game:restart')}>
              Rejouer
            </Button>
          ) : (
            <div className="waiting" role="status">
              <span className="spinner" /> En attente de la revanche…
            </div>
          )}
        </div>
      </div>
    </Backdrop>
  );
}
