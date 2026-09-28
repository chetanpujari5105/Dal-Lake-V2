import type { TimeOfDay, Weather } from '../atmosphere/presets';
import type { CameraMode } from '../camera/cameraRig';

export interface UIHandlers {
  onStart(): void;
  onTime(t: TimeOfDay): void;
  onWeather(w: Weather): void;
  onSound(on: boolean): void;
  onCamera(mode: CameraMode): void;
  onHide(hidden: boolean): void;
  onMusicMuted(muted: boolean): void;
  onMusicVolume(volume: number): void;
}

export type MusicUIStatus = 'idle' | 'loading' | 'playing' | 'unavailable';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`UI element missing: ${sel}`);
  return el;
};

export class UI {
  readonly touchRoot = $('#touch');
  private title = $('#title');
  private scrim = $('#scrim');
  private startBtn = $<HTMLButtonElement>('#start');
  private startLabel = $('#start .start-label');
  private progress = $('#progress');
  private hud = $('#hud');
  private hint = $('#controls-hint');
  private caption = $('#caption');
  private captionTitle = $('#caption .caption-title');
  private captionText = $('#caption .caption-text');
  private restore = $<HTMLButtonElement>('#restore');
  private notice = $('#notice');
  private error = $('#error');
  private captionTimer = 0;
  private noticeTimer = 0;
  private hidden = false;
  private started = false;
  private sound = true;
  private camera: CameraMode = 'chase';
  private music = $('#music');
  private musicBtn = $<HTMLButtonElement>('#music .music-btn');
  private musicVol = $<HTMLInputElement>('#music .music-vol');
  private musicNote = $('#music .music-note');
  private musicStatus: MusicUIStatus = 'idle';
  private musicReason = '';
  private musicMuted = false;

  constructor(private handlers: UIHandlers, private isTouch: boolean) {
    document.documentElement.classList.toggle('is-touch', isTouch);

    this.musicBtn.addEventListener('click', () => this.toggleMusic());
    // People click the words as often as the icon; the label explains too.
    this.musicNote.addEventListener('click', () => {
      if (this.musicStatus === 'unavailable') this.toggleMusic();
    });
    this.musicVol.addEventListener('input', () => {
      const v = Number(this.musicVol.value) / 100;
      this.musicVol.setAttribute('aria-valuetext', `${Math.round(v * 100)}%`);
      // Dragging the volume up un-mutes, as a mixer fader would.
      if (this.musicMuted && v > 0) this.setMusicMuted(false, true);
      handlers.onMusicVolume(v);
    });

    this.startBtn.addEventListener('click', () => {
      if (!this.startBtn.disabled) handlers.onStart();
    });
    document.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((b) =>
      b.addEventListener('click', () => {
        const t = b.dataset.time as TimeOfDay;
        this.setTime(t);
        handlers.onTime(t);
      }),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((b) =>
      b.addEventListener('click', () => {
        const w = b.dataset.weather as Weather;
        this.setWeather(w);
        handlers.onWeather(w);
      }),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-action="sound"]').forEach((b) =>
      b.addEventListener('click', () => this.toggleSound()),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-action="camera"]').forEach((b) =>
      b.addEventListener('click', () => this.toggleCamera()),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-action="hide"]').forEach((b) =>
      b.addEventListener('click', () => this.toggleHidden()),
    );
    this.restore.addEventListener('click', () => this.toggleHidden());
    $('#error .error-reload').addEventListener('click', () => window.location.reload());
  }

  get isStarted(): boolean {
    return this.started;
  }

  /** Keyboard start (Enter/Space) from the title screen. */
  onStartRequested(): void {
    if (!this.startBtn.disabled && !this.started) this.handlers.onStart();
  }

  setProgress(fraction: number, label: string): void {
    this.progress.style.width = `${Math.round(fraction * 100)}%`;
    this.startLabel.textContent = fraction < 1 ? `${label}…` : 'Start journey';
  }

  ready(): void {
    this.startBtn.disabled = false;
    this.startLabel.textContent = 'Start journey';
    this.startBtn.focus({ preventScroll: true });
  }

  enterJourney(): void {
    this.started = true;
    this.title.classList.add('is-leaving');
    this.scrim.classList.add('is-gone');
    window.setTimeout(() => (this.title.hidden = true), 900);
    this.hud.hidden = false;
    this.hint.hidden = false;
    this.touchRoot.hidden = !this.isTouch;
  }

  fadeHint(): void {
    this.hint.classList.add('is-faded');
  }

  setTime(t: TimeOfDay): void {
    document.querySelectorAll<HTMLButtonElement>('[data-time]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.time === t)));
  }

  setWeather(w: Weather): void {
    document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.weather === w)));
  }

  setSound(on: boolean): void {
    this.sound = on;
    document.querySelectorAll<HTMLButtonElement>('[data-action="sound"]').forEach((b) => {
      b.setAttribute('aria-pressed', String(on));
      const label = b.querySelector('.sound-label');
      if (label) label.textContent = on ? 'Sound on' : 'Sound off';
    });
  }

  toggleSound(): void {
    this.setSound(!this.sound);
    this.handlers.onSound(this.sound);
  }

  /** Reflects the music player's real state, including when no file is installed. */
  setMusicStatus(status: MusicUIStatus, reason = ''): void {
    this.musicStatus = status;
    this.musicReason = reason;
    this.music.dataset.status = status;
    if (status === 'unavailable') {
      this.musicNote.textContent = 'No music';
      this.musicBtn.title = `Music unavailable: ${reason} See the README to add a soundtrack.`;
      // Still operable: pressing it explains why there is no music.
      this.musicBtn.setAttribute('aria-label', 'Music unavailable. Press for details.');
      this.musicBtn.setAttribute('aria-pressed', 'false');
    } else {
      this.musicNote.textContent = status === 'loading' ? 'Loading…' : '';
      this.musicBtn.title = 'Music (N)';
      this.musicBtn.removeAttribute('aria-label');
      this.musicBtn.setAttribute('aria-pressed', String(!this.musicMuted));
    }
  }

  setMusicSettings(volume: number, muted: boolean): void {
    this.musicVol.value = String(Math.round(volume * 100));
    this.musicVol.setAttribute('aria-valuetext', `${Math.round(volume * 100)}%`);
    this.setMusicMuted(muted, false);
  }

  private setMusicMuted(muted: boolean, notify: boolean): void {
    this.musicMuted = muted;
    if (this.musicStatus !== 'unavailable') this.musicBtn.setAttribute('aria-pressed', String(!muted));
    if (notify) this.handlers.onMusicMuted(muted);
  }

  toggleMusic(): void {
    if (this.musicStatus === 'unavailable') {
      this.showNotice(`Music unavailable: ${this.musicReason}`, 4500);
      return;
    }
    this.setMusicMuted(!this.musicMuted, true);
  }

  setCamera(mode: CameraMode): void {
    this.camera = mode;
    document.querySelectorAll<HTMLButtonElement>('[data-action="camera"]').forEach((b) => b.setAttribute('aria-pressed', String(mode === 'cinematic')));
  }

  toggleCamera(): void {
    this.setCamera(this.camera === 'chase' ? 'cinematic' : 'chase');
    this.handlers.onCamera(this.camera);
  }

  toggleHidden(): void {
    if (!this.started) return;
    this.hidden = !this.hidden;
    this.hud.hidden = this.hidden;
    this.hint.hidden = this.hidden;
    this.caption.hidden = this.hidden;
    this.touchRoot.hidden = this.hidden || !this.isTouch;
    this.restore.hidden = !this.hidden;
    if (this.hidden) this.restore.focus({ preventScroll: true });
    this.handlers.onHide(this.hidden);
  }

  showCaption(title: string, text: string): void {
    this.captionTitle.textContent = title;
    this.captionText.textContent = text;
    this.caption.classList.add('is-visible');
    window.clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => this.caption.classList.remove('is-visible'), 5200);
  }

  showNotice(text: string, ms = 3500): void {
    this.notice.textContent = text;
    this.notice.hidden = false;
    window.clearTimeout(this.noticeTimer);
    if (ms > 0) this.noticeTimer = window.setTimeout(() => (this.notice.hidden = true), ms);
  }

  hideNotice(): void {
    this.notice.hidden = true;
  }

  showError(message: string, detail = ''): void {
    this.error.hidden = false;
    $('#error .error-text').textContent = message;
    const pre = $('#error .error-detail');
    pre.textContent = detail;
    const details = pre.closest('details');
    if (details) details.hidden = !detail;
    this.title.hidden = true;
    this.hud.hidden = true;
    this.touchRoot.hidden = true;
    $<HTMLButtonElement>('#error .error-reload').focus();
  }
}
