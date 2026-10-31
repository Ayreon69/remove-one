// Les règles, lisibles en deux minutes et consultables à tout moment.
import { Coins, DoorOpen, Hourglass, RotateCcw, Scale, Lock } from 'lucide-react';
import { useStore } from '../store';
import { Plate } from './Plate';
import { Modal } from './Ui';

export function RulesModal() {
  const open = useStore((s) => s.rulesOpen);
  const setOpen = useStore((s) => s.setRulesOpen);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Les règles" wide>
      <div className="rules">
        <section className="rule-hero">
          <div className="rule-pair" aria-hidden>
            <Plate value={2} size="md" />
            <Plate value={6} size="md" mark="removed" />
          </div>
          <p>
            Tout le monde a les mêmes <b>huit cartes, de 1 à 8</b>. À chaque manche, on en pose <b>deux</b>, puis on en <b>retire une</b> : l'autre est jouée. Le plus petit nombre que <b>personne d'autre</b> n'a joué gagne la manche.
          </p>
        </section>

        <section>
          <h3>Une manche</h3>
          <ol className="rule-steps">
            <li>
              <b>Pose deux cartes</b> face cachée.
            </li>
            <li>
              Toutes les paires sont <b>dévoilées</b>. On peut parler, promettre, menacer…
            </li>
            <li>
              En secret, <b>garde la carte que tu joues</b>. Les cartes jouées sont dévoilées ensemble.
            </li>
          </ol>
          <div className="rule-example" aria-label="Exemple : 1, 1, 3 et 5 sont joués, le 3 gagne">
            <div>
              <Plate value={1} size="sm" mark="dupe" />
              <Plate value={1} size="sm" mark="dupe" />
              <Plate value={3} size="sm" mark="win" />
              <Plate value={5} size="sm" />
            </div>
            <p>Deux joueurs ont joué le 1 : il ne compte pas. Le 3 est le plus petit nombre seul, il gagne.</p>
          </div>
        </section>

        <section className="rule-split">
          <div className="rule-case">
            <h3>
              <Coins size={18} aria-hidden /> Gagner une manche
            </h3>
            <p>
              Gagner rapporte <b>autant de points que sa carte</b> (gagner avec un 5 rapporte 5) et un <b>jeton de victoire</b>. Si aucun nombre n'est seul, personne ne marque.
            </p>
          </div>
          <div className="rule-case">
            <h3>
              <Hourglass size={18} aria-hidden /> Cartes jouées, carte au repos
            </h3>
            <p>
              La carte jouée est perdue. L'autre <b>se repose une manche</b> avant de revenir. Toutes les cartes reviennent <b>toutes les 6 manches</b>. Avec deux cartes seulement, elles sont posées d'office.
            </p>
          </div>
        </section>

        <section className="rule-warn">
          <h3>
            <DoorOpen size={18} aria-hidden /> Une sortie toutes les trois manches
          </h3>
          <p>
            On fait les comptes : <b>points + un par jeton</b>. Le meilleur score <b>sort de prison</b> et regarde la suite. Les autres repartent de zéro point, mais gardent leurs jetons.
          </p>
          <p className="rule-tie">
            <Scale size={16} aria-hidden /> En cas d'égalité : le plus de jetons, puis la victoire la plus récente, puis le sort.
          </p>
        </section>

        <section>
          <h3>
            <Lock size={18} aria-hidden /> La finale
          </h3>
          <p>
            Quand il ne reste que trois détenus, les trois récupèrent leurs huit cartes et jouent <b>six manches</b>. Les deux meilleurs scores sortent, <b>le dernier reste en cellule</b>. Le classement suit l'ordre de sortie : sortir en premier, c'est gagner.
          </p>
        </section>

        <section className="rule-memory">
          <h3>
            <RotateCcw size={18} aria-hidden /> Dans cette version
          </h3>
          <ul>
            <li>Personne ne te rappelle les cartes déjà jouées par les autres : à toi de t'en souvenir.</li>
            <li>De 3 à 8 joueurs. À 7, c'est exactement le calendrier de l'émission : 18 manches.</li>
            <li>Un joueur absent plus de 20 secondes est remplacé par le pilote automatique jusqu'à son retour.</li>
          </ul>
        </section>

        <p className="rule-foot">
          D'après <i>Remove One</i>, épreuve de la prison de <i>The Devil's Plan : Death Room</i> (Netflix). Création de fans, non officielle, avec ses propres visuels.
        </p>
      </div>
    </Modal>
  );
}
