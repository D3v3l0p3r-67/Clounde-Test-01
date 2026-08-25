// Centralized audio system. Every sound the game can play is a named
// entry in AUDIO_CONFIG (mutated in place by ElementsScene from
// assets/audio/audio.json -- see assets.js's AUDIO_CONFIG_PATH), carrying
// its own file, category (music/sfx/ui), volume, playback mode
// (once/loop), whether it may overlap itself, and an optional max
// playback duration. Game code never touches a filename, a volume number,
// or a loop flag directly -- it only ever calls AudioManager.play(name)/
// playMusic(name) by the sound's config key, so swapping a sound is
// purely replacing the .ogg file (or editing audio.json), never a code
// change. Same mutable-registry pattern as elements.js's BALL_ELEMENTS/
// POWERUP_TYPES and LevelManager's LEVELS.
import { audioPath } from './assets.js';
import { skinAsset } from './skins.js';

export const AUDIO_CONFIG = {}; // name -> {file, category, volume, mode, overlap, maxDurationMs?}

export class AudioManager {
  constructor(scene) {
    this.scene = scene;
    this.sound = scene.sound;
    this.musicVolume = 0.6;
    this.sfxVolume = 0.8;
    // Per-name Phaser Sound instance, kept around only for sounds that
    // can't overlap themselves (so a repeat trigger can stop the
    // previous instance first) -- overlap-allowed sfx are fire-and-forget
    // via this.sound.play() instead and need no bookkeeping here.
    this.activeInstances = new Map();
    this.music = null;
    this.musicName = null;
    // Music tracks are fetched on demand rather than at boot (see
    // BootScene's preload), so each one is in exactly one of three states:
    // absent, being fetched (a live Promise here), or in the sound cache.
    this.musicLoads = new Map(); // name -> Promise
    // Whether the game is currently paused. Tracked rather than read off
    // the Sound, because a track can still be downloading when the pause
    // happens -- without this it would start playing over the pause menu
    // the moment it arrived.
    this.musicPaused = false;
  }

  // Browsers refuse to start audio before a user gesture -- called from
  // the same click handlers that already used to call this pre-Phaser
  // Sound-Manager rewrite, so no call site needed to change.
  // Returns whether it actually had to WAKE something. A caller that
  // started a track while the context was asleep needs to know: that
  // track exists and reports itself playing, but never made a sound, so
  // resuming is not enough on its own (see ui.js's armAudioUnlock).
  resumeContext() {
    const ctx = this.sound.context;
    if (!ctx || ctx.state !== 'suspended') return false;
    ctx.resume();
    return true;
  }

  _categoryVolume(category) {
    return category === 'music' ? this.musicVolume : this.sfxVolume;
  }

  _effectiveVolume(cfg) {
    return cfg.volume * this._categoryVolume(cfg.category);
  }

  // One-shot (mode: 'once') sounds: sfx/ui, by config name. Safe to call
  // for any category -- 'loop' entries (music) are ignored here and must
  // go through playMusic() instead, since they need singleton/switch
  // handling this method doesn't do.
  //
  // Returns the Phaser Sound it started (or undefined if the name isn't a
  // one-shot), so a caller that needs to line something up with the sound
  // can read its `duration` -- see GameScene.beginRun holding the level
  // countdown until the run-start fanfare has finished.
  play(name) {
    const cfg = AUDIO_CONFIG[name];
    if (!cfg || cfg.mode === 'loop') return;

    const volume = this._effectiveVolume(cfg);

    if (!cfg.overlap) {
      const prev = this.activeInstances.get(name);
      if (prev) {
        prev.stop();
        prev.destroy();
        this.activeInstances.delete(name);
      }
      const snd = this.sound.add(name, { volume });
      snd.once('complete', () => {
        if (this.activeInstances.get(name) === snd) this.activeInstances.delete(name);
        snd.destroy();
      });
      this.activeInstances.set(name, snd);
      snd.play();
      if (cfg.maxDurationMs) {
        this.scene.time.delayedCall(cfg.maxDurationMs, () => { if (snd.isPlaying) snd.stop(); });
      }
      return snd;
    }

    // Overlap-allowed: the shorthand manager play() creates and cleans up
    // its own instance per call, so any number of triggers can sound at
    // once (e.g. several balls popping the same frame).
    const snd = this.sound.play(name, { volume });
    if (cfg.maxDurationMs && snd) {
      this.scene.time.delayedCall(cfg.maxDurationMs, () => { if (snd.isPlaying) snd.stop(); });
    }
    return snd;
  }

  // Fetches a music track if it isn't in the cache yet, and resolves once
  // it is. Concurrent callers share the one in-flight load rather than
  // starting the same download twice -- which is the normal case: whoever
  // plays a track has usually just been beaten to it by whoever prefetched
  // it. Resolves to false if the file can't be loaded at all, so callers
  // can simply carry on without music rather than hanging on it.
  ensureMusicLoaded(name) {
    const cfg = AUDIO_CONFIG[name];
    if (!cfg || cfg.category !== 'music') return Promise.resolve(false);
    if (this.scene.cache.audio.exists(name)) return Promise.resolve(true);
    const pending = this.musicLoads.get(name);
    if (pending) return pending;

    const load = new Promise((resolve) => {
      const loader = this.scene.load;
      const done = (ok) => {
        this.musicLoads.delete(name);
        loader.off(`filecomplete-audio-${name}`, onDone);
        loader.off('loaderror', onError);
        resolve(ok);
      };
      const onDone = () => done(true);
      const onError = (file) => { if (file.key === name) done(false); };
      loader.on(`filecomplete-audio-${name}`, onDone);
      loader.on('loaderror', onError);
      loader.audio(name, skinAsset(audioPath(cfg.file)));
      loader.start();
    });
    this.musicLoads.set(name, load);
    return load;
  }

  // Music (mode: 'loop', category 'music'): only ever one track playing.
  // Re-requesting the track that's already playing (e.g. reloading the
  // same level on restart) is a no-op, so loops never duplicate.
  //
  // The track may still be downloading (see ensureMusicLoaded), so the
  // request is recorded FIRST and honoured when the file arrives -- and
  // only if it is still the wanted track by then, or a quick level change
  // during the fetch would start a track the player has already left.
  playMusic(name) {
    const cfg = AUDIO_CONFIG[name];
    if (!cfg || cfg.category !== 'music') return;
    if (this.musicName === name && this.music && this.music.isPlaying) return;

    this.stopMusic();
    // A fresh track is a fresh start, never inheriting the last pause.
    this.musicPaused = false;
    this.musicName = name;
    if (this.scene.cache.audio.exists(name)) {
      this._startMusic(name, cfg);
      return;
    }
    this.ensureMusicLoaded(name).then((ok) => {
      if (ok && this.musicName === name && !this.music) this._startMusic(name, cfg);
    });
  }

  _startMusic(name, cfg) {
    const snd = this.sound.add(name, { loop: true, volume: this._effectiveVolume(cfg) });
    snd.play();
    if (this.musicPaused) snd.pause();
    this.music = snd;
  }

  stopMusic() {
    if (this.music) {
      this.music.stop();
      this.music.destroy();
      this.music = null;
    }
    // Cleared even with nothing playing: a track still downloading has its
    // name recorded here, and this is what tells that pending start it is
    // no longer wanted.
    this.musicName = null;
  }

  // Freezes the current track at its playback position (as opposed to
  // stopMusic(), which throws the instance away entirely) -- used for the
  // pause menu, so the music picks back up where it left off on resume
  // instead of restarting from the top. Safe to call with nothing playing.
  pauseMusic() {
    this.musicPaused = true;
    if (this.music && this.music.isPlaying) this.music.pause();
  }

  resumeMusic() {
    this.musicPaused = false;
    if (this.music && this.music.isPaused) this.music.resume();
  }

  setMuted(muted) {
    this.sound.mute = muted;
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.music && this.musicName) {
      this.music.setVolume(this._effectiveVolume(AUDIO_CONFIG[this.musicName]));
    }
  }

  applySettings(settings) {
    this.setMuted(settings.muted);
    this.setSfxVolume(settings.sfxVolume);
    this.setMusicVolume(settings.musicVolume);
  }
}
