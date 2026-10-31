// Sons synthétisés (Web Audio), aucun fichier à charger : plaques posées, volets qui s'ouvrent, cloche, buzzer, sirène et porte de cellule.
import { useStore } from '../store';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!useStore.getState().prefs.sound) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; delay?: number; slide?: number; attack?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.1, t0 + (opts.attack ?? 0.006));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur: number, opts: { gain?: number; delay?: number; freq?: number; type?: BiquadFilterType; q?: number; fade?: number; sweep?: number } = {}): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const buffer = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * dur)), a.sampleRate);
  const data = buffer.getChannelData(0);
  const fade = opts.fade ?? 2;
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** fade;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.setValueAtTime(opts.freq ?? 2400, t0);
  if (opts.sweep) filter.frequency.exponentialRampToValueAtTime(opts.sweep, t0 + dur);
  if (opts.q) filter.Q.value = opts.q;
  const g = a.createGain();
  g.gain.value = opts.gain ?? 0.25;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t0);
}

/** Un choc de métal : un bruit bref et deux harmoniques qui sonnent faux, comme une plaque sur une tôle. */
function clank(delay = 0, pitch = 1, gain = 1): void {
  noise(0.06, { gain: 0.28 * gain, freq: 2600 * pitch, q: 1.4, fade: 4, delay });
  tone(410 * pitch, 0.18, { type: 'triangle', gain: 0.05 * gain, delay, slide: 0.97 });
  tone(1130 * pitch, 0.12, { type: 'sine', gain: 0.025 * gain, delay });
}

export const sfx = {
  /** Une carte choisie dans la main. */
  tap: () => tone(760, 0.05, { gain: 0.025, type: 'triangle', slide: 1.3 }),
  /** Deux plaques posées sur le plateau. */
  place: () => {
    clank(0, 0.9);
    clank(0.09, 1.05, 0.8);
  },
  /** Les paires se dévoilent : un volet métallique qui s'ouvre. */
  reveal: () => {
    noise(0.32, { gain: 0.14, freq: 700, sweep: 3200, q: 0.9, fade: 1 });
    clank(0.3, 1.2, 0.7);
  },
  /** Les cartes jouées tombent. */
  drop: () => {
    for (let i = 0; i < 3; i++) clank(i * 0.06, 0.8 + i * 0.12, 0.7);
  },
  /** Un nombre seul gagne : la cloche du parloir. */
  win: (mine: boolean) => {
    tone(988, 0.9, { gain: mine ? 0.09 : 0.05 });
    tone(1482, 0.7, { gain: mine ? 0.04 : 0.02, delay: 0.01 });
    if (mine) tone(1319, 1, { gain: 0.06, delay: 0.16 });
  },
  /** Personne : un buzzer sec. */
  buzz: () => {
    tone(110, 0.32, { type: 'square', gain: 0.035 });
    tone(116, 0.32, { type: 'sawtooth', gain: 0.02 });
  },
  /** À toi de choisir : deux bips de contrôle. */
  turn: () => {
    tone(880, 0.08, { type: 'square', gain: 0.02 });
    tone(880, 0.08, { type: 'square', gain: 0.02, delay: 0.14 });
  },
  /** Les comptes : une sirène courte, puis la porte. */
  release: () => {
    tone(520, 0.9, { type: 'sawtooth', gain: 0.025, slide: 1.5 });
    tone(780, 0.7, { type: 'sawtooth', gain: 0.02, delay: 0.85, slide: 0.66 });
    noise(0.5, { gain: 0.18, freq: 300, sweep: 120, type: 'lowpass', delay: 1.4, fade: 1.5 });
    clank(1.55, 0.6, 1.2);
  },
  /** Une porte qui s'ouvre sur l'extérieur : un arpège clair. */
  freed: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.45, { type: 'triangle', gain: 0.06, delay: 0.1 + i * 0.09 }));
  },
  /** La porte qui se referme. */
  locked: () => {
    noise(0.7, { gain: 0.3, freq: 160, sweep: 60, type: 'lowpass', fade: 1 });
    clank(0.05, 0.5, 1.4);
    tone(73.4, 1.2, { type: 'sine', gain: 0.08, delay: 0.1 });
  },
  /** Fin de partie : modeste ou triomphale. */
  fanfare: (good: boolean) => {
    const notes = good ? [523.25, 659.25, 783.99, 659.25, 783.99, 1046.5] : [392, 349.23, 311.13, 261.63];
    notes.forEach((f, i) => tone(f, i === notes.length - 1 ? 0.9 : 0.2, { type: 'triangle', gain: 0.06, delay: i * 0.13 }));
  },
  /** Début de partie : le trousseau de clés. */
  start: () => {
    for (let i = 0; i < 6; i++) noise(0.05, { gain: 0.12, freq: 4200 + Math.random() * 2400, q: 3, delay: i * 0.05 + Math.random() * 0.02, fade: 3 });
  },
};
