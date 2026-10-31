// Une table de Remove One : salon, partie, minuteries, bots, pilote automatique et vue de chacun.
import crypto from 'node:crypto';
import {
  AVATARS,
  CARDS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  THINK_OPTIONS,
  type FinalView,
  type GameView,
  type MyCard,
  type PlayerStatus,
  type RoomView,
  type Settings,
  type Stage,
  type ThinkTime,
} from '../shared/protocol';
import { Memory, NO_MEMORY, botKeep, botPick, randomSkill } from './bots';
import { Game, shuffle } from './game';

const BOT_NAMES = ['Matricule', 'Verrou', 'Cadenas', 'Barreau', 'Mitard', 'Trousseau', 'Tunnel', 'Parloir', 'Gamelle', 'Cavale'];
const MAX_MEMBERS = 16;
/** Délai laissé à un joueur déconnecté avant que le pilote automatique ne prenne le relais. */
const GRACE_MS = 20_000;
/** Mode accéléré pour les tests locaux (RO_FAST=1) : bots et chronos quasi instantanés. */
const FAST = process.env.RO_FAST === '1';
/** En mode accéléré, un humain n'a qu'un instant pour choisir : on atteint vite la fin. */
const FAST_THINK_MS = 1_500;
/** Le temps de voir qui a joué quoi, et qui gagne la manche. */
const RESULT_MS = FAST ? 60 : 3_800;
const RESULT_EMPTY_MS = FAST ? 60 : 3_000;
/** Le temps des comptes : qui sort, et à quel prix. */
const RELEASE_MS = FAST ? 120 : 5_600;
const FINAL_RELEASE_MS = FAST ? 150 : 7_000;

export interface Player {
  id: string;
  token: string;
  name: string;
  avatar: string;
  isBot: boolean;
  sockets: Set<string>;
  connected: boolean;
  disconnectedAt: number;
  left: boolean;
  status: PlayerStatus;
}

function uid(): string {
  return crypto.randomBytes(9).toString('base64url');
}

export class Room {
  readonly code: string;
  hostId = '';
  phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  settings: Settings = { think: 60 };
  players: Player[] = [];
  game: Game | null = null;
  final: FinalView | null = null;
  wins = new Map<string, number>();
  memories = new Map<string, Memory>();
  /** Un bot qui a annoncé sa carte s'y tient. */
  intents = new Map<string, number>();
  stageStartedAt = 0;
  stageEndsAt = 0;
  botDue = new Map<string, number>();
  showUntil = 0;
  lastActive = Date.now();
  onChange: () => void = () => {};
  onEmote: (playerId: string, text: string) => void = () => {};

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string) {
    this.code = code;
  }

  // ───────────────────────────── Membres ─────────────────────────────

  get(id: string | undefined): Player | undefined {
    return id ? this.players.find((p) => p.id === id) : undefined;
  }

  findByToken(playerId: unknown, token: unknown): Player | undefined {
    if (typeof playerId !== 'string' || typeof token !== 'string') return undefined;
    const p = this.get(playerId);
    return p && !p.isBot && p.token === token ? p : undefined;
  }

  get seated(): Player[] {
    return this.players.filter((p) => p.status !== 'spectator');
  }

  get humansOnline(): number {
    return this.players.filter((p) => !p.isBot && p.connected).length;
  }

  touch(): void {
    this.lastActive = Date.now();
  }

  private uniqueName(name: string): string {
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 99; i++) {
      const candidate = `${name.slice(0, 13)} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return name;
  }

  private makePlayer(name: string, avatar: string, isBot: boolean, status: PlayerStatus): Player {
    return {
      id: uid(),
      token: uid() + uid(),
      name: this.uniqueName(name),
      avatar,
      isBot,
      sockets: new Set(),
      connected: isBot,
      disconnectedAt: Date.now(),
      left: false,
      status,
    };
  }

  addHuman(name: string, avatar: string): Player | string {
    if (this.players.length >= MAX_MEMBERS) return 'Cette table est pleine.';
    if (this.phase === 'lobby' && this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const p = this.makePlayer(name, avatar, false, this.phase === 'lobby' ? 'lobby' : 'spectator');
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    return p;
  }

  addBot(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut ajouter des bots.";
    if (this.phase !== 'lobby') return 'On ajoute des bots dans le salon.';
    if (this.seated.length >= MAX_PLAYERS) return `La table est complète (${MAX_PLAYERS} joueurs maximum).`;
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.players.length + 1}`;
    const usedAvatars = new Set(this.players.map((p) => p.avatar));
    const free = AVATARS.filter((a) => !usedAvatars.has(a));
    const pool = free.length ? free : AVATARS;
    this.players.push(this.makePlayer(name, pool[crypto.randomInt(pool.length)], true, 'lobby'));
    return undefined;
  }

  kick(by: string, target: string): { sockets: string[] } | string {
    if (by !== this.hostId) return "Seul l'hôte peut retirer un joueur.";
    if (this.phase !== 'lobby') return 'On ne peut retirer un joueur que dans le salon.';
    const p = this.get(target);
    if (!p || p.id === by) return 'Joueur introuvable.';
    this.players = this.players.filter((x) => x.id !== p.id);
    return { sockets: [...p.sockets] };
  }

  leave(id: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.clear();
    p.connected = false;
    p.disconnectedAt = Date.now();
    // En partie, sa place reste à la table : le pilote automatique joue pour lui.
    if (this.phase === 'lobby' || p.status === 'spectator') this.players = this.players.filter((x) => x.id !== id);
    else p.left = true;
    if (this.hostId === id) this.transferHost();
  }

  private transferHost(): void {
    const next = this.players.find((p) => !p.isBot && !p.left && p.connected) ?? this.players.find((p) => !p.isBot && !p.left);
    this.hostId = next?.id ?? '';
  }

  connect(p: Player, socketId: string): void {
    p.sockets.add(socketId);
    p.connected = true;
    p.left = false;
    if (!this.hostId || !this.get(this.hostId) || this.get(this.hostId)?.left) this.hostId = p.id;
  }

  disconnect(id: string | undefined, socketId: string): void {
    const p = this.get(id);
    if (!p) return;
    p.sockets.delete(socketId);
    if (p.sockets.size === 0) {
      p.connected = false;
      p.disconnectedAt = Date.now();
    }
  }

  isAuto(p: Player): boolean {
    return p.isBot || p.left || (!p.connected && Date.now() - p.disconnectedAt >= GRACE_MS);
  }

  updateSettings(by: string, payload: Record<string, unknown>): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut changer les réglages.";
    if (this.phase !== 'lobby') return 'Les réglages se changent dans le salon.';
    if ((THINK_OPTIONS as readonly unknown[]).includes(payload.think)) this.settings.think = payload.think as ThinkTime;
    return undefined;
  }

  // ───────────────────────────── Partie ─────────────────────────────

  start(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut lancer la partie.";
    if (this.phase !== 'lobby') return 'La partie est déjà lancée.';
    const seated = this.seated;
    if (seated.length < MIN_PLAYERS) return `Il faut au moins ${MIN_PLAYERS} joueurs (ajoute un bot si besoin).`;
    for (const p of seated) p.status = 'playing';
    const order = shuffle(seated.map((p) => p.id));
    const spectators = this.players.filter((p) => p.status === 'spectator');
    this.players = [...order.map((id) => this.get(id)!), ...spectators];
    this.game = new Game(order);
    this.memories.clear();
    for (const p of this.players) if (p.isBot && p.status === 'playing') this.memories.set(p.id, new Memory(randomSkill(), p.id));
    this.phase = 'playing';
    this.final = null;
    this.armStage();
    return undefined;
  }

  restart(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut relancer une partie.";
    if (this.phase === 'lobby') return undefined;
    this.clearTimer();
    this.players = this.players.filter((p) => !p.left);
    let seats = 0;
    for (const p of this.players) {
      p.status = seats < MAX_PLAYERS ? 'lobby' : 'spectator';
      if (p.status === 'lobby') seats++;
    }
    this.phase = 'lobby';
    this.game = null;
    this.final = null;
    this.memories.clear();
    this.intents.clear();
    return undefined;
  }

  endEarly(by: string): string | undefined {
    if (by !== this.hostId) return "Seul l'hôte peut arrêter la partie.";
    if (this.phase !== 'playing') return undefined;
    return this.restart(by);
  }

  /** Plus aucun humain présent en cellule : les bots jouent vite. */
  private onlyBots(): boolean {
    const g = this.game;
    return !!g && g.active.every((id) => {
      const p = this.get(id);
      return !p || this.isAuto(p);
    });
  }

  private botDelay(min: number, spread: number): number {
    if (FAST) return 15;
    if (this.onlyBots()) return 300;
    return min + Math.random() * spread;
  }

  /** Prépare l'étape qui commence : chrono des humains, temps de réflexion des bots, ou durée d'affichage. */
  private armStage(): void {
    const g = this.game;
    if (!g) return;
    const now = Date.now();
    this.stageStartedAt = now;
    this.botDue.clear();
    if (g.stage === 'pick' || g.stage === 'keep') {
      const think = this.settings.think * 1000;
      this.stageEndsAt = FAST ? now + FAST_THINK_MS : think ? now + think : 0;
      for (const id of g.waiting()) {
        if (!this.get(id)?.isBot) continue;
        this.botDue.set(id, now + (g.stage === 'pick' ? this.botDelay(1600, 2600) : this.botDelay(2200, 3800)));
      }
      if (g.stage === 'keep') this.botsAnnounce();
      this.showUntil = 0;
      return;
    }
    this.stageEndsAt = 0;
    if (g.stage === 'result') this.showUntil = now + (g.result?.winner ? RESULT_MS : RESULT_EMPTY_MS);
    else if (g.stage === 'release') this.showUntil = now + (g.release?.final ? FINAL_RELEASE_MS : RELEASE_MS);
    else this.showUntil = now;
  }

  /** Parfois, un bot qui tient un 1 l'annonce à voix haute, comme dans l'émission. Il s'y tient. */
  private botsAnnounce(): void {
    this.intents.clear();
    const g = this.game!;
    if (FAST) return;
    for (const id of g.active) {
      const p = this.get(id);
      const pair = g.picks.get(id);
      if (!p?.isBot || !pair || Math.random() > 0.22) continue;
      const card = pair[0] === 1 ? 1 : pair[0] === 2 ? 2 : null;
      if (card === null) continue;
      this.intents.set(id, card);
      setTimeout(() => this.onEmote(id, card === 1 ? 'Je joue le 1 !' : 'Je joue le 2 !'), 600 + Math.random() * 900);
    }
  }

  private check(seq: unknown): string | undefined {
    if (this.phase !== 'playing' || !this.game) return "Aucune partie n'est en cours.";
    if (seq !== undefined && seq !== this.game.seq) return 'La manche a changé entre-temps.';
    return undefined;
  }

  pick(by: string, pair: unknown, seq?: unknown): string | undefined {
    const err = this.check(seq);
    if (err) return err;
    const before = this.game!.seq;
    const refused = this.game!.pick(by, pair);
    if (refused) return refused;
    this.afterAction(before);
    return undefined;
  }

  keep(by: string, card: unknown, seq?: unknown): string | undefined {
    const err = this.check(seq);
    if (err) return err;
    const before = this.game!.seq;
    const refused = this.game!.keep(by, card);
    if (refused) return refused;
    this.afterAction(before);
    return undefined;
  }

  /** Après un choix : si l'étape a changé, on la prépare (et les bots retiennent la manche qui vient de se jouer). */
  private afterAction(before: number): void {
    const g = this.game!;
    if (g.seq === before) return;
    if (g.stage === 'result') {
      for (const m of this.memories.values()) m.observe(g);
      this.botReacts();
    }
    this.armStage();
  }

  /** De temps en temps, un bot réagit à la manche. */
  private botReacts(): void {
    if (FAST) return;
    const r = this.game?.result;
    if (!r) return;
    const winner = r.winner ? this.get(r.winner) : null;
    if (winner?.isBot && Math.random() < 0.35) {
      setTimeout(() => this.onEmote(winner.id, pickOne(['😈', '🔥', 'Bien joué'])), 900);
      return;
    }
    const losers = this.game!.active.map((id) => this.get(id)).filter((p): p is Player => !!p?.isBot && p.id !== r.winner);
    if (!losers.length || Math.random() > (r.winner ? 0.2 : 0.3)) return;
    const bot = pickOne(losers);
    setTimeout(() => this.onEmote(bot.id, r.winner ? pickOne(['😱', 'Traître !', '🤐']) : pickOne(['😱', '🙏'])), 1000);
  }

  private finishGame(): void {
    const g = this.game;
    if (!g) return;
    const standings = g.standings();
    const first = standings[0]?.id;
    if (first) this.wins.set(first, (this.wins.get(first) ?? 0) + 1);
    this.final = {
      rounds: g.round,
      players: standings.map((s) => {
        const p = this.get(s.id);
        return {
          id: s.id,
          name: p?.name ?? '?',
          avatar: p?.avatar ?? AVATARS[0],
          place: s.place,
          fate: s.fate,
          round: s.round,
          tokens: g.tokens.get(s.id) ?? 0,
          wins: this.wins.get(s.id) ?? 0,
          winner: s.id === first,
        };
      }),
    };
    this.phase = 'finished';
    this.clearTimer();
  }

  // ───────────────────────────── Minuteries & pilote automatique ─────────────────────────────

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** À appeler après chaque changement : planifie la prochaine échéance puis diffuse l'état. */
  commit(): void {
    this.reschedule();
    this.onChange();
  }

  /** Quand agir pour un joueur : bot → délai naturel, absent → fin du délai de grâce, sinon fin du chrono. */
  private dueAt(p: Player | undefined, botAt: number): number {
    const limit = this.stageEndsAt > 0 ? this.stageEndsAt : Infinity;
    if (!p) return Date.now();
    if (p.isBot) return botAt;
    if (this.isAuto(p)) return Math.max(this.stageStartedAt + 1500, p.left ? 0 : p.disconnectedAt + GRACE_MS);
    if (!p.connected) return Math.min(limit, p.disconnectedAt + GRACE_MS);
    return limit;
  }

  private nextDue(): number {
    const g = this.game!;
    if (g.stage === 'pick' || g.stage === 'keep') {
      let due = Infinity;
      for (const id of g.waiting()) due = Math.min(due, this.dueAt(this.get(id), this.botDue.get(id) ?? Date.now()));
      return due;
    }
    return this.showUntil;
  }

  private reschedule(): void {
    this.clearTimer();
    const g = this.game;
    if (this.phase !== 'playing' || !g) return;
    const due = this.nextDue();
    if (!Number.isFinite(due)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.tick();
      } catch (e) {
        console.error(`[room ${this.code}]`, e);
      }
      this.commit();
    }, Math.max(0, Math.min(due - Date.now(), 2_147_000_000)));
  }

  tick(): void {
    const g = this.game;
    if (this.phase !== 'playing' || !g) return;
    const now = Date.now();
    if (g.stage === 'over') {
      this.finishGame();
      return;
    }
    if (g.stage === 'result' || g.stage === 'release') {
      if (now < this.showUntil) return;
      g.advance();
      // L'étape vient de changer : TypeScript ne le sait pas.
      if ((g.stage as Stage) === 'over') this.finishGame();
      else this.armStage();
      return;
    }
    const stage = g.stage;
    for (const id of g.waiting()) {
      if (g.stage !== stage) break;
      const p = this.get(id);
      if (now < this.dueAt(p, this.botDue.get(id) ?? now)) continue;
      this.autoPlay(id);
    }
  }

  /** Le bot choisit ; le pilote automatique d'un absent fait de même, sans rien retenir. */
  autoPlay(id: string): void {
    const g = this.game!;
    const p = this.get(id);
    const mem = (p?.isBot && this.memories.get(id)) || new Memory(NO_MEMORY, id);
    if (g.stage === 'pick') {
      const pair = botPick(g, mem, id);
      if (!this.pick(id, pair)) return;
      // Filet de sécurité : la partie ne doit jamais se bloquer.
      console.error(`[room ${this.code}] paire refusée`, pair);
      const avail = g.available(id);
      this.pick(id, [avail[0], avail[1]]);
      return;
    }
    if (g.stage === 'keep') {
      const intent = this.intents.get(id);
      const pair = g.picks.get(id);
      const card = intent !== undefined && pair?.includes(intent) ? intent : botKeep(g, mem, id);
      if (!this.keep(id, card)) return;
      console.error(`[room ${this.code}] carte refusée`, card);
      if (pair) this.keep(id, pair[0]);
    }
  }

  dispose(): void {
    this.clearTimer();
  }

  // ───────────────────────────── Vue personnalisée ─────────────────────────────

  private gameView(g: Game, viewer: string): GameView {
    const inCell = g.isIn(viewer);
    const rest = g.rest.get(viewer) ?? null;
    const hand = g.hand(viewer);
    const cards: MyCard[] | null = inCell ? CARDS.map((value) => ({ value, state: !hand.includes(value) ? 'used' : value === rest ? 'rest' : 'ready' })) : null;
    const open = g.stage === 'keep' || g.stage === 'result';
    const pair = g.picks.get(viewer);
    return {
      order: [...g.order],
      stage: g.stage,
      round: g.round,
      total: g.total,
      releases: [...g.sched.releases],
      refills: [...g.sched.refills],
      finalStart: g.sched.finalStart,
      seq: g.seq,
      endsAt: g.stage === 'pick' || g.stage === 'keep' ? this.stageEndsAt : 0,
      cards,
      myPair: pair && g.stage !== 'release' && g.stage !== 'over' ? [pair[0], pair[1]] : null,
      myPlay: g.stage === 'keep' || g.stage === 'result' ? (g.plays.get(viewer) ?? null) : null,
      forced: g.forced.has(viewer) && (g.stage === 'pick' || g.stage === 'keep'),
      pairs: open ? Object.fromEntries(g.active.map((id) => [id, [...g.picks.get(id)!] as [number, number]])) : null,
      result: g.stage === 'result' && g.result ? { ...g.result, plays: { ...g.result.plays }, dupes: [...g.result.dupes] } : null,
      release: g.stage === 'release' && g.release ? { ...g.release, free: [...g.release.free], lines: g.release.lines.map((l) => ({ ...l })) } : null,
    };
  }

  viewFor(viewerId: string): RoomView {
    const g = this.phase === 'playing' ? this.game : null;
    const waiting = g ? new Set(g.waiting()) : null;
    const choosing = g?.stage === 'pick' || g?.stage === 'keep';
    return {
      code: this.code,
      phase: this.phase,
      me: viewerId,
      hostId: this.hostId,
      settings: { ...this.settings },
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        isBot: p.isBot,
        isHost: p.id === this.hostId,
        connected: p.isBot || p.connected,
        autopilot: !p.isBot && p.status === 'playing' && this.isAuto(p),
        status: p.status,
        wins: this.wins.get(p.id) ?? 0,
        fate: g?.fate.get(p.id) ?? null,
        place: g?.place.get(p.id) ?? null,
        points: g?.points.get(p.id) ?? 0,
        tokens: g?.tokens.get(p.id) ?? 0,
        ready: !!g && choosing && g.isIn(p.id) && !waiting!.has(p.id),
      })),
      game: g ? this.gameView(g, viewerId) : null,
      final: this.final,
      serverNow: Date.now(),
    };
  }
}

function pickOne<T>(arr: T[]): T {
  return arr[crypto.randomInt(arr.length)];
}
