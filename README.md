# Remove One

**Pose deux cartes, n'en joue qu'une. Le plus petit nombre que personne d'autre n'a joué gagne.**

👉 **Jouer : https://remove-one.onrender.com** (la première ouverture peut prendre jusqu'à une minute, le temps que le serveur gratuit se réveille)

Jeu de cartes multijoueur en ligne, à jouer entre amis depuis un navigateur, sur téléphone ou ordinateur, sans compte ni installation.
D'après *Remove One*, l'épreuve de la prison de *The Devil's Plan : Death Room* (saison 2, Netflix). Création de fans, non officielle, avec ses propres visuels.

## Règles en bref

- De 3 à 8 joueurs. Chacun a les mêmes huit cartes, de 1 à 8.
- À chaque manche :
  1. chacun **pose deux cartes** face cachée ;
  2. toutes les paires sont **dévoilées** : on peut parler, promettre, bluffer ;
  3. on **garde en secret la carte qu'on joue**, l'autre est retirée. Les cartes jouées sont dévoilées ensemble.
- **Le plus petit nombre joué une seule fois gagne** : autant de points que sa valeur, et un jeton de victoire. Si tout est en double, personne ne marque.
- La carte jouée est perdue. La carte retirée **se repose** pendant la manche suivante. Toutes les cartes reviennent **toutes les 6 manches**. Quand il n'en reste que deux, elles sont posées d'office.
- **Toutes les 3 manches, on fait les comptes** : points depuis les derniers comptes + un par jeton. Le meilleur score **sort de prison** et regarde la suite. Les autres repartent de zéro point, mais gardent leurs jetons. Égalité : le plus de jetons, puis la victoire la plus récente, puis le sort.
- **La finale** : à trois, chacun récupère ses huit cartes pour six manches. Les deux meilleurs scores sortent, **le dernier reste en cellule**.
- Le classement suit l'ordre de sortie : sortir en premier, c'est gagner.

Les règles suivent l'épreuve de l'émission (jour 1 de la saison 2) : huit cartes, deux posées et une retirée, plus petit nombre seul, repos d'une manche, retour des cartes toutes les 6 manches, comptes toutes les 3 manches avec un point par jeton, départage par les jetons puis la victoire la plus récente, finale à trois sur six manches.

Sont des choix de ce jeu :

- **Le calendrier suit le nombre de joueurs** : une sortie toutes les 3 manches jusqu'à ce qu'il en reste trois, puis la finale. À 7, c'est exactement celui de l'émission (18 manches) ; à 3, la partie est une finale de 6 manches ; à 8, elle en dure 21.
- **Après une égalité parfaite**, le sort tranche (l'émission ne l'a pas eu à faire).
- **Ceux qui sortent regardent la suite** comme spectateurs, comme dans l'émission.
- **Rien ne rappelle les cartes déjà jouées par les autres** : on ne voit que ce qui serait sur une vraie table, la paire de chacun pendant le choix et les cartes jouées à la fin de la manche. Tout le reste se joue de mémoire.
- **Le temps pour chaque choix est réglable** par l'hôte (sans limite, 30 ou 60 secondes, pour laisser le temps de négocier) ; le temps écoulé, le pilote automatique choisit à ta place.
- **Un joueur absent plus de 20 secondes est remplacé par le pilote automatique** jusqu'à son retour. Le pilote ne se souvient de rien.

## Les bots

Ils ne voient que ce qu'un joueur voit : les paires dévoilées et les cartes jouées. Ils s'en souviennent, avec un peu d'oubli :

- ils retiennent, pour chaque adversaire, les cartes déjà jouées depuis le dernier retour des cartes et celle qui se repose, et en déduisent ce qu'il peut encore poser ;
- pour poser, ils simulent les paires possibles des autres et cherchent celle qui a le plus de chances de donner le plus petit nombre seul, en tenant compte des comptes qui approchent ;
- pour garder, ils devinent la carte que chacun va jouer à partir des paires dévoilées, et hésitent à griller une petite carte trop tôt ;
- parfois, un bot qui tient un 1 ou un 2 l'annonce (« Je joue le 1 ! ») et tient parole.

Contre des joueurs qui choisissent au hasard, sur 200 parties par taille de table (`npx tsx test/sim.ts 200`) :

| Joueurs | Manches | Bot premier sorti | Hasard | Bot reste en cellule | Hasard |
|---|---|---|---|---|---|
| 3 | 6 | 51 % | 33 % | 19 % | 33 % |
| 4 | 9 | 47 % | 25 % | 10 % | 25 % |
| 5 | 12 | 39 % | 20 % | 9 % | 20 % |
| 6 | 15 | 29 % | 17 % | 6 % | 17 % |
| 7 | 18 | 32 % | 14 % | 4 % | 14 % |
| 8 | 21 | 24 % | 13 % | 3 % | 13 % |

Le jeu reste très incertain, comme dans l'émission : un bot n'est jamais sûr de gagner, mais il finit rarement en cellule. Une décision prend moins d'un quart de milliseconde.

## Fonctionnalités

- Tables privées avec code à 4 lettres, lien d'invitation, partage natif et QR code
- Partie contre 2 à 7 bots en un clic
- Un geste par action : toucher deux cartes puis « Poser », puis toucher la carte qu'on joue ; ce qui est jouable s'illumine, les cartes au repos portent un ruban
- Les paires des autres se retournent dans leurs cellules, la carte retirée est barrée, la gagnante tamponnée « seul », les doublons « double »
- Le calendrier de la partie en haut de l'écran : manches jouées, comptes à venir, retour des cartes, finale
- Les comptes en grand, avec le tampon « dehors » ou « en cellule » ; confettis quand on sort
- Fin de partie : l'ordre de sortie, jetons et victoires de la soirée, revanche en un clic
- Réactions et phrases toutes faites pour négocier (« On s'arrange ? », « Traître ! »), règles consultables en jeu
- Reprise automatique après une coupure, pilote automatique, spectateurs
- Sons synthétisés et vibrations, animations réduites si le système le demande

## Développement

```bash
npm install
npm run dev:server   # serveur temps réel sur http://localhost:3210
npm run dev:client   # interface sur http://localhost:5200
npm test             # calendrier, plus petit nombre seul, repos, comptes, égalités, finale, bots
npm run build && npm run e2e   # parties complètes avec de vrais clients connectés
npx tsx test/sim.ts 200        # force des bots : 200 parties par taille de table
```

`RO_FAST=1` accélère les bots et les chronos (tests locaux uniquement).

## Architecture

- `shared/` : contrat client/serveur, cartes, calendrier selon le nombre de joueurs
- `server/` : Express + Socket.IO, moteur de partie (`game.ts`), bots et leur mémoire (`bots.ts`), table et minuteries (`room.ts`). Le serveur fait autorité : chacun ne reçoit que ses cartes, les paires ne circulent qu'une fois toutes posées, les cartes jouées qu'une fois toutes choisies, et rien de passé n'est renvoyé
- `client/` : React + Vite + Framer Motion. Les cartes sont dans `components/Plate.tsx`, la table, les cellules et les comptes dans `screens/Table.tsx`
- Déploiement : un seul service Node (`npm ci && npm run build`, puis `npm start`)
