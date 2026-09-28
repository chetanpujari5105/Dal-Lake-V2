// Optional background music from a file the site owner supplies at
// public/audio/soundtrack.mp3. Nothing is bundled or fetched from elsewhere: if
// the file is missing or cannot be decoded, the player reports "unavailable"
// and the rest of the experience carries on.
//
// The track is decoded once and looped with a short crossfade between
// successive copies, so there is no gap or click at the loop point even when
// the file's start and end do not match.

export type MusicStatus = 'idle' | 'loading' | 'playing' | 'unavailable';

export const MUSIC_URL = `${import.meta.env.BASE_URL}audio/soundtrack.mp3`;

const FADE_IN = 4; // seconds, on first start
const XFADE = 3; // seconds of overlap at each loop
const VOL_KEY = 'dal-lake:music-volume';
const MUTE_KEY = 'dal-lake:music-muted';
/** Quiet by default: the music sits under the lake's ambience. */
export const DEFAULT_MUSIC_VOLUME = 0.3;

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable: settings last for this page only */
  }
}

export class Music {
  status: MusicStatus = 'idle';
  /** Why the music is unavailable, in plain words, when it is. */
  reason = '';
  volume: number;
  muted: boolean;
  onStatus: (status: MusicStatus) => void = () => {};

  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private nextStart = 0;
  private timer = 0;
  private soundOn = true;
  private started = false;

  constructor(private url = MUSIC_URL) {
    const v = Number(readSession(VOL_KEY));
    this.volume = readSession(VOL_KEY) !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_MUSIC_VOLUME;
    this.muted = readSession(MUTE_KEY) === '1';
  }

  /**
   * Must be called from the Start click (a user gesture), so browsers allow
   * playback. Downloads and decodes the track, then fades it in.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return this.fail('This browser has no Web Audio support.');
    let ctx: AudioContext;
    try {
      ctx = new AC();
    } catch {
      return this.fail('Audio could not start on this device.');
    }
    this.ctx = ctx;
    // Resume inside the gesture; decoding happens after.
    void ctx.resume();
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(ctx.destination);
    this.setStatus('loading');

    let data: ArrayBuffer;
    try {
      const res = await fetch(this.url);
      const type = res.headers.get('content-type') ?? '';
      // Dev servers answer a missing file with the HTML page, so check the type too.
      if (!res.ok || type.includes('text/html')) return this.fail('No soundtrack file is installed.');
      data = await res.arrayBuffer();
    } catch {
      return this.fail('The soundtrack file could not be loaded.');
    }
    try {
      this.buffer = await ctx.decodeAudioData(data);
    } catch {
      return this.fail('The soundtrack file could not be decoded.');
    }
    if (this.buffer.duration < XFADE * 2 + 1) return this.fail('The soundtrack file is too short to loop.');

    this.nextStart = ctx.currentTime + 0.05;
    this.schedule();
    this.setStatus('playing');
    this.applyGain(FADE_IN);
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    writeSession(VOL_KEY, this.volume.toFixed(2));
    this.applyGain(0.25);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    writeSession(MUTE_KEY, m ? '1' : '0');
    this.applyGain(0.6);
  }

  /** The global Sound toggle silences music too. */
  setSoundOn(on: boolean): void {
    this.soundOn = on;
    this.applyGain(0.6);
  }

  suspend(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private target(): number {
    // Perceptual curve so the slider feels even; scaled low so 100% is still gentle.
    return this.muted || !this.soundOn ? 0 : Math.pow(this.volume, 2) * 0.55;
  }

  private applyGain(seconds: number): void {
    const ctx = this.ctx;
    const g = this.out;
    if (!ctx || !g || this.status !== 'playing') return;
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(this.target(), now + seconds);
  }

  /** Keeps two copies of the track queued ahead, each fading in over the previous one's tail. */
  private schedule = (): void => {
    const ctx = this.ctx;
    const buf = this.buffer;
    if (!ctx || !buf || !this.out) return;
    while (this.nextStart < ctx.currentTime + buf.duration) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const env = ctx.createGain();
      const t0 = this.nextStart;
      const t1 = t0 + buf.duration;
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(1, t0 + XFADE);
      env.gain.setValueAtTime(1, t1 - XFADE);
      env.gain.linearRampToValueAtTime(0, t1);
      src.connect(env).connect(this.out);
      src.start(t0);
      src.stop(t1 + 0.05);
      src.onended = () => env.disconnect();
      this.nextStart = t1 - XFADE;
    }
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.schedule, Math.max(1000, (buf.duration - XFADE) * 500));
  };

  private fail(reason: string): void {
    this.reason = reason;
    console.info(`[music] unavailable: ${reason}`);
    // Nothing to play: release the audio context rather than keep it idling.
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.out = null;
    this.setStatus('unavailable');
  }

  private setStatus(s: MusicStatus): void {
    this.status = s;
    this.onStatus(s);
  }
}
