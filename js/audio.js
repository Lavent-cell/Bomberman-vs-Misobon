// js/audio.js
import { volumeSettings } from "./state.js";

const BGM_INTRO_URL = "assets/bgm_intro.ogg";
const BGM_LOOP_URL = "assets/bgm_loop.ogg";
const SFX_EXPLOSION_URL = "assets/explosion-9.mp3";
const SFX_LASER_URL = "assets/Laser-Blast.mp3";

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.introBuffer = null;
    this.loopBuffer = null;
    this.explosionBuffer = null;
    this.laserBuffer = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this.bgmSources = [];
  }

  async _loadBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`音声ファイルの取得に失敗: ${url}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return await this.ctx.decodeAudioData(arrayBuffer);
  }

  async init() {
    if (this.ctx && this.introBuffer && this.loopBuffer && this.explosionBuffer && this.laserBuffer) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.masterGain = this.ctx.createGain();
    this.bgmGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();

    this.bgmGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    this.setMasterVolume(volumeSettings.master);
    this.setBgmVolume(volumeSettings.bgm);
    this.setSfxVolume(volumeSettings.sfx);

    [this.introBuffer, this.loopBuffer, this.explosionBuffer, this.laserBuffer] = await Promise.all([
      this._loadBuffer(BGM_INTRO_URL),
      this._loadBuffer(BGM_LOOP_URL),
      this._loadBuffer(SFX_EXPLOSION_URL),
      this._loadBuffer(SFX_LASER_URL)
    ]);
  }

  setMasterVolume(value) {
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setValueAtTime(value / 100, this.ctx.currentTime);
  }

  setBgmVolume(value) {
    if (!this.ctx || !this.bgmGain) return;
    this.bgmGain.gain.setValueAtTime(value / 100, this.ctx.currentTime);
  }

  setSfxVolume(value) {
    if (!this.ctx || !this.sfxGain) return;
    this.sfxGain.gain.setValueAtTime(value / 100, this.ctx.currentTime);
  }

  playSfx(buffer) {
    if (!this.ctx || !this.sfxGain || !buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.sfxGain);
    source.start();
  }

  playExplosionSfx() {
    this.playSfx(this.explosionBuffer);
  }

  playLaserSfx() {
    this.playSfx(this.laserBuffer);
  }

  playBeep(frequency = 880, durationMs = 150, type = "sine") {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);

    const peak = 0.9;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
  }

  playSuddenDeathAlarm() {
    this.playBeep(220, 450, "sawtooth");
  }

  playCountdownBeep(remainingSec) {
    if (remainingSec <= 1) {
      this.playBeep(1318, 480, "square");
    } else {
      this.playBeep(880, 110, "square");
    }
  }

  play() {
    if (!this.ctx || !this.introBuffer || !this.loopBuffer) return;
    if (this.ctx.state === "suspended") this.ctx.resume();

    const now = this.ctx.currentTime;

    const introSource = this.ctx.createBufferSource();
    introSource.buffer = this.introBuffer;
    introSource.connect(this.bgmGain);
    introSource.start(now);
    this.bgmSources.push(introSource);

    const loopSource = this.ctx.createBufferSource();
    loopSource.buffer = this.loopBuffer;
    loopSource.loop = true;
    loopSource.connect(this.bgmGain);
    loopSource.start(now + this.introBuffer.duration);
    this.bgmSources.push(loopSource);
  }

  stop() {
    this.bgmSources.forEach((src) => {
      try { src.stop(); } catch (e) {}
    });
    this.bgmSources = [];
  }
}

export const audioManager = new AudioManager();
