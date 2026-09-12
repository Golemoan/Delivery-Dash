'use strict';

/* ============================================================================
 * DELIVERY DASH — game engine
 *
 * Architecture:
 *   CONFIG          static data (vehicles, difficulty modes, tuning constants)
 *   AudioEngine     lazy WebAudio synth + procedural background music
 *   Particles       pooled particle/floating-text/confetti system
 *   Renderers       pure draw functions, keyed by id (no if/else chains)
 *   World           obstacle/coin/pothole/animal spawning, update, collision
 *   Player          player vehicle state + lane movement
 *   ScreenManager   DOM screen transitions (menu / respawn / game over)
 *   InputManager    keyboard + tap + swipe, all funnelled into one API
 *   Game            state machine + fixed-timestep-capped render loop
 * ==========================================================================*/

const CONFIG = {
  canvas: { width: 360, height: 640 },
  lanes: [70, 180, 290],
  laneWidth: 110,
  roadDashLength: 40,
  maxDeltaTime: 0.1,
  respawnCost: 50,
  storageKey: 'deliveryDash.bestDistance',

  vehicles: [
    { id: 'scooter', label: 'Delivery Scooter', width: 44, height: 84, slideSpeed: 16 },
    { id: 'skater', label: 'Skater Boy', width: 40, height: 80, slideSpeed: 20 },
    { id: 'tuktuk', label: 'Auto Tuk-Tuk', width: 50, height: 90, slideSpeed: 13 },
  ],

  modes: [
    { id: 'easy', label: 'Newbie 😇', speed: 300, spawnInterval: 1.2, trafficSpeedMult: 0.35, ratioCar: 1.0, ratioPothole: 0.0, ratioAnimal: 0.0, targetScore: 250, timeLimit: 0 },
    { id: 'medium', label: 'King of road 😈', speed: 420, spawnInterval: 0.95, trafficSpeedMult: 0.45, ratioCar: 0.6, ratioPothole: 0.4, ratioAnimal: 0.0, targetScore: 350, timeLimit: 40 },
    { id: 'hard', label: 'Indian 👺', speed: 520, spawnInterval: 0.75, trafficSpeedMult: 0.55, ratioCar: 0.6, ratioPothole: 0.3, ratioAnimal: 0.1, targetScore: 550, timeLimit: 30 },
    { id: 'limitless', label: 'Limitless ♾️', speed: 280, spawnInterval: 0.7, trafficSpeedMult: 0.5, ratioCar: 0.6, ratioPothole: 0.3, ratioAnimal: 0.1, targetScore: Infinity, timeLimit: 0 },
  ],

  carModels: [
    { color: '#e74c3c', type: 'sport' },
    { color: '#f1c40f', type: 'taxi' },
    { color: '#3498db', type: 'sport' },
    { color: '#2c3e50', type: 'police' },
  ],

  confettiColors: ['#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#e056fd', '#ffda79', '#7d5fff', '#00d2d3'],

  // Limitless-only systems
  powerupSpawnChance: 0.006, // per-frame roll while in Limitless mode
  magnet: { duration: 6000, radius: 130 },
  combo: { window: 2.5, tierSize: 3, baseBonus: 5 },
  environmentDistance: 200, // meters of score between theme switches
  environments: [
    { id: 'suburb', label: 'Suburban Route', roadColor: '#3a3a3a', shoulderColor: '#27ae60', laneLineColor: '#ffffff', overlay: null, leftProps: ['tree', 'bush'], rightProps: ['tree', 'bush'], rain: false },
    { id: 'city', label: 'Downtown', roadColor: '#333844', shoulderColor: '#55606e', laneLineColor: '#f4d35e', overlay: null, leftProps: ['building'], rightProps: ['building'], rain: false },
    { id: 'market', label: 'Night Market', roadColor: '#40342a', shoulderColor: '#231a14', laneLineColor: '#ffd166', overlay: 'rgba(10, 10, 30, 0.45)', leftProps: ['stall'], rightProps: ['stall'], rain: false },
    { id: 'monsoon', label: 'Monsoon Highway', roadColor: '#39434f', shoulderColor: '#4a5765', laneLineColor: '#e0f7fa', overlay: 'rgba(20, 40, 70, 0.35)', leftProps: ['barrier'], rightProps: ['barrier'], rain: true },
  ],

  // Applies to every mode
  speedLineThreshold: 460,
};

const CONST = {
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  RESPAWN_PROMPT: 'RESPAWN_PROMPT',
  GAME_OVER: 'GAME_OVER',
};

/* ------------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------------ */

const Util = {
  rand(min, max) { return Math.random() * (max - min) + min; },
  choice(arr) { return arr[(Math.random() * arr.length) | 0]; },
  clamp(v, min, max) { return v < min ? min : v > max ? max : v; },
  /** O(1) removal that doesn't preserve order — fine for particle/entity lists. */
  swapRemove(arr, index) {
    const last = arr.length - 1;
    if (index !== last) arr[index] = arr[last];
    arr.pop();
  },
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  },
  generateCrackedPolygon(radius, numPoints = 8) {
    const points = [];
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const r = radius * (0.7 + Math.random() * 0.5);
      points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r * 0.7 });
    }
    return points;
  },
};

/* ------------------------------------------------------------------------ *
 * DOM references
 * ------------------------------------------------------------------------ */

const dom = {
  canvas: document.getElementById('gameCanvas'),
  scoreEl: document.getElementById('score'),
  coinsEl: document.getElementById('coins'),
  timerEl: document.getElementById('timer'),
  timerContainer: document.getElementById('timer-container'),
  startScreen: document.getElementById('start-screen'),
  respawnScreen: document.getElementById('respawn-screen'),
  respawnReason: document.getElementById('respawn-reason'),
  useRespawnBtn: document.getElementById('useRespawnBtn'),
  skipRespawnBtn: document.getElementById('skipRespawnBtn'),
  gameOverScreen: document.getElementById('game-over-screen'),
  crashTitle: document.getElementById('crash-title'),
  crashReason: document.getElementById('crash-reason'),
  finalScoreEl: document.getElementById('final-score'),
  finalCoinsEl: document.getElementById('final-coins'),
  endTimeEl: document.getElementById('end-time'),
  endDifficultyEl: document.getElementById('end-difficulty'),
  startBtn: document.getElementById('startBtn'),
  restartBtn: document.getElementById('restartBtn'),
  menuBtn: document.getElementById('menuBtn'),
  modeTitle: document.getElementById('modeTitle'),
  prevModeBtn: document.getElementById('prevModeBtn'),
  nextModeBtn: document.getElementById('nextModeBtn'),
  vehicleTitle: document.getElementById('vehicleTitle'),
  prevVehicleBtn: document.getElementById('prevVehicleBtn'),
  nextVehicleBtn: document.getElementById('nextVehicleBtn'),
  leftBtn: document.getElementById('leftBtn'),
  rightBtn: document.getElementById('rightBtn'),
  bestDistanceRow: document.getElementById('bestDistanceRow'),
  bestDistanceValue: document.getElementById('bestDistanceValue'),
  previewCanvas: document.getElementById('scooter-preview'),
  limitlessHud: document.getElementById('limitlessHud'),
  comboBadge: document.getElementById('comboBadge'),
  comboValue: document.getElementById('comboValue'),
  magnetBadge: document.getElementById('magnetBadge'),
  magnetTimer: document.getElementById('magnetTimer'),
  shieldBadge: document.getElementById('shieldBadge'),
};

const ctx = dom.canvas.getContext('2d');
const previewCtx = dom.previewCanvas.getContext('2d');

/* ------------------------------------------------------------------------ *
 * Canvas setup — fixes the classic double-scaling bug: the logical game
 * space is always exactly 360x640, we only adjust the *backing store*
 * resolution for crispness on high-DPI screens via a single transform.
 * ------------------------------------------------------------------------ */

function setupCanvasDPR(canvasEl, renderingCtx, logicalWidth, logicalHeight) {
  const dpr = Util.clamp(window.devicePixelRatio || 1, 1, 3);
  canvasEl.width = logicalWidth * dpr;
  canvasEl.height = logicalHeight * dpr;
  renderingCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resizeCanvases() {
  setupCanvasDPR(dom.canvas, ctx, CONFIG.canvas.width, CONFIG.canvas.height);
  setupCanvasDPR(dom.previewCanvas, previewCtx, 110, 140);
}

window.addEventListener('resize', resizeCanvases);

/* ------------------------------------------------------------------------ *
 * AudioEngine — lazy-initialized, self-suspending on tab hide.
 * ------------------------------------------------------------------------ */

const AudioEngine = {
  ctx: null,
  musicTimer: null,
  musicTempo: 1.0,

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } else if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },

  tone(freq, duration, type = 'sine', gain = 0.1) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.connect(g); g.connect(this.ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    g.gain.setValueAtTime(gain, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.start(); osc.stop(this.ctx.currentTime + duration);
  },

  play(type) {
    if (!this.ctx) return;
    const c = this.ctx;
    const now = c.currentTime;

    switch (type) {
      case 'click':
        this.tone(600, 0.04, 'sine', 0.12);
        break;
      case 'select_ride':
        this.tone(440, 0.05, 'square', 0.08);
        setTimeout(() => this.tone(880, 0.08, 'triangle', 0.1), 40);
        break;
      case 'rev_engine': {
        const osc = c.createOscillator(); const g = c.createGain();
        osc.connect(g); g.connect(c.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(70, now);
        osc.frequency.exponentialRampToValueAtTime(280, now + 0.35);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.6);
        g.gain.setValueAtTime(0.01, now);
        g.gain.linearRampToValueAtTime(0.2, now + 0.2);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc.start(now); osc.stop(now + 0.6);
        break;
      }
      case 'tick':
        this.tone(900, 0.03, 'sine', 0.15);
        break;
      case 'horn': {
        const osc = c.createOscillator(); const g = c.createGain();
        osc.connect(g); g.connect(c.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(420, now);
        g.gain.setValueAtTime(0.1, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now); osc.stop(now + 0.25);
        break;
      }
      case 'near_miss':
        this.tone(880, 0.08, 'sine', 0.12);
        setTimeout(() => this.tone(1200, 0.1, 'triangle', 0.15), 60);
        break;
      case 'coin': {
        const osc = c.createOscillator(); const g = c.createGain();
        osc.connect(g); g.connect(c.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(987.77, now);
        osc.frequency.exponentialRampToValueAtTime(1318.51, now + 0.12);
        g.gain.setValueAtTime(0.2, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        osc.start(now); osc.stop(now + 0.12);
        break;
      }
      case 'crash': {
        const bufferSize = c.sampleRate * 0.4;
        const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = c.createBufferSource();
        noise.buffer = buffer;
        const filter = c.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, now);
        filter.frequency.exponentialRampToValueAtTime(30, now + 0.4);
        const g = c.createGain();
        g.gain.setValueAtTime(0.8, now);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        noise.connect(filter); filter.connect(g); g.connect(c.destination);
        noise.start(); noise.stop(now + 0.4);
        break;
      }
      case 'pothole':
        this.tone(110, 0.25, 'triangle', 0.4);
        break;
      case 'shift':
        this.tone(380, 0.04, 'sine', 0.08);
        break;
      case 'moo': {
        const osc = c.createOscillator(); const g = c.createGain();
        osc.connect(g); g.connect(c.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.linearRampToValueAtTime(150, now + 0.2);
        osc.frequency.linearRampToValueAtTime(100, now + 0.5);
        g.gain.setValueAtTime(0.01, now);
        g.gain.linearRampToValueAtTime(0.25, now + 0.1);
        g.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
        break;
      }
      case 'win':
        [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
          setTimeout(() => this.tone(freq, 0.25, 'triangle', 0.2), idx * 100);
        });
        break;
      case 'powerup':
        this.tone(659.25, 0.07, 'triangle', 0.15);
        setTimeout(() => this.tone(987.77, 0.12, 'triangle', 0.18), 70);
        break;
      case 'shield_break': {
        const osc = c.createOscillator(); const g = c.createGain();
        osc.connect(g); g.connect(c.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.3);
        g.gain.setValueAtTime(0.25, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
        break;
      }
    }
  },

  startMusic(modeIndex) {
    this.stopMusic();
    if (!this.ctx) return;
    this.musicTempo = 1.0;
    let step = 0;

    // Two persistent "synth voices" reused for every note. This avoids
    // allocating a fresh oscillator+gain pair on every beat, which under
    // sustained play created thousands of short-lived AudioNodes and caused
    // periodic GC-driven frame stutter.
    const leadType = modeIndex === 0 ? 'sine' : modeIndex === 1 ? 'sawtooth' : 'square';
    const bassType = modeIndex === 0 ? 'triangle' : modeIndex === 1 ? 'square' : 'sawtooth';

    const leadOsc = this.ctx.createOscillator();
    const leadGain = this.ctx.createGain();
    leadOsc.type = leadType;
    leadGain.gain.value = 0;
    leadOsc.connect(leadGain); leadGain.connect(this.ctx.destination);
    leadOsc.start();

    const bassOsc = this.ctx.createOscillator();
    const bassGain = this.ctx.createGain();
    bassOsc.type = bassType;
    bassGain.gain.value = 0;
    bassOsc.connect(bassGain); bassGain.connect(this.ctx.destination);
    bassOsc.start();

    this._voices = { leadOsc, leadGain, bassOsc, bassGain };

    const pluck = (osc, gain, freq, duration, peak) => {
      const now = this.ctx.currentTime;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(peak, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    };

    const runStep = () => {
      if (Game.state !== CONST.PLAYING) return;
      const ratio = this.musicTempo;

      if (modeIndex === 0) {
        const melody = [261.63, 329.63, 392.00, 523.25, 392.00, 329.63, 293.66, 349.23];
        const bass = [130.81, 130.81, 146.83, 164.81];
        pluck(leadOsc, leadGain, melody[step % melody.length] * ratio, 0.16, 0.035);
        if (step % 2 === 0) pluck(bassOsc, bassGain, bass[(step / 2) % bass.length] * ratio, 0.22, 0.04);
      } else if (modeIndex === 1) {
        const lead = [440.00, 440.00, 523.25, 587.33, 440.00, 659.25, 587.33, 523.25];
        const bass = [110.00, 110.00, 130.81, 146.83];
        pluck(leadOsc, leadGain, lead[step % lead.length] * ratio, 0.12, 0.025);
        if (step % 2 === 1) pluck(bassOsc, bassGain, bass[Math.floor(step / 2) % bass.length] * ratio, 0.18, 0.03);
      } else {
        const melody = [587.33, 659.25, 698.46, 783.99, 880.00, 783.99, 698.46, 659.25];
        const bass = [73.42, 82.41, 87.31, 98.00];
        pluck(leadOsc, leadGain, melody[step % melody.length] * ratio, 0.08, 0.025);
        if (step % 4 === 0) pluck(bassOsc, bassGain, bass[(step / 4) % bass.length] * ratio, 0.25, 0.05);
      }
      step++;
    };

    const baseInterval = modeIndex === 0 ? 250 : modeIndex === 1 ? 180 : 115;
    this.musicTimer = setInterval(runStep, baseInterval / this.musicTempo);
  },

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this._voices) {
      try {
        this._voices.leadOsc.stop();
        this._voices.bassOsc.stop();
        this._voices.leadOsc.disconnect();
        this._voices.leadGain.disconnect();
        this._voices.bassOsc.disconnect();
        this._voices.bassGain.disconnect();
      } catch (_) { /* already stopped */ }
      this._voices = null;
    }
  },

  setTempo(t) { this.musicTempo = t; },
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    AudioEngine.ctx && AudioEngine.ctx.suspend();
  } else if (AudioEngine.ctx) {
    AudioEngine.ctx.resume();
  }
});

/* ------------------------------------------------------------------------ *
 * Particle systems — plain arrays with swap-remove to avoid GC churn from
 * splice() in hot loops.
 * ------------------------------------------------------------------------ */

const Particles = {
  exhaust: [],
  sparks: [],
  floatingTexts: [],
  confetti: [],

  addExhaust(x, y) {
    this.exhaust.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y + 36,
      vx: (Math.random() - 0.5) * 15,
      vy: Math.random() * 40 + 60,
      size: Math.random() * 4 + 3,
      color: 'rgba(200, 200, 200, 0.5)',
      life: 0.4,
    });
  },

  addDriftSparks(x, y, direction) {
    for (let i = 0; i < 4; i++) {
      this.sparks.push({
        x: x + direction * 12,
        y: y + 20,
        vx: direction * (Math.random() * 80 + 40),
        vy: Math.random() * 50 - 25,
        size: Math.random() * 3 + 2,
        color: Math.random() < 0.5 ? '#00d2d3' : '#ffd700',
        life: 0.25,
      });
    }
  },

  addFloatingText(text, x, y, color = '#ffd700') {
    this.floatingTexts.push({ text, x, y, vy: -50, life: 0.8, color });
  },

  spawnConfetti(x, y) {
    this.confetti.length = 0;
    for (let i = 0; i < 140; i++) {
      const isStreamer = Math.random() < 0.18;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 320 + 120;
      this.confetti.push({
        x: x + (Math.random() - 0.5) * 40,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 150,
        size: isStreamer ? Math.random() * 4 + 4 : Math.random() * 7 + 5,
        color: Util.choice(CONFIG.confettiColors),
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 12,
        isStreamer,
        length: isStreamer ? Math.random() * 40 + 30 : 0,
        waveFrequency: Math.random() * 0.1 + 0.05,
        waveOffset: Math.random() * Math.PI * 2,
        life: 1.0,
        decay: Math.random() * 0.25 + 0.25,
      });
    }
  },

  clearAll() {
    this.exhaust.length = 0;
    this.sparks.length = 0;
    this.floatingTexts.length = 0;
    this.confetti.length = 0;
  },

  update(dt) {
    this._updateSimple(this.exhaust, dt);
    this._updateSimple(this.sparks, dt);

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const t = this.floatingTexts[i];
      t.y += t.vy * dt;
      t.life -= dt;
      if (t.life <= 0) Util.swapRemove(this.floatingTexts, i);
    }

    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const p = this.confetti[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
      p.vx *= 0.98;
      p.rotation += p.rotSpeed * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) Util.swapRemove(this.confetti, i);
    }
  },

  _updateSimple(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) Util.swapRemove(list, i);
    }
  },

  renderBackLayer(renderingCtx) {
    for (const p of this.exhaust) this._drawDot(renderingCtx, p);
    for (const p of this.sparks) this._drawDot(renderingCtx, p);
  },

  _drawDot(renderingCtx, p) {
    renderingCtx.save();
    renderingCtx.globalAlpha = Math.max(0, p.life);
    renderingCtx.fillStyle = p.color;
    renderingCtx.beginPath();
    renderingCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    renderingCtx.fill();
    renderingCtx.restore();
  },

  renderFrontLayer(renderingCtx) {
    this.floatingTexts.forEach((t) => {
      renderingCtx.save();
      renderingCtx.globalAlpha = Math.max(0, t.life);
      renderingCtx.fillStyle = t.color;
      renderingCtx.font = '900 14px "Segoe UI", sans-serif';
      renderingCtx.textAlign = 'center';
      renderingCtx.fillText(t.text, t.x, t.y);
      renderingCtx.restore();
    });

    this.confetti.forEach((p) => {
      renderingCtx.save();
      renderingCtx.globalAlpha = Math.max(0, p.life);
      renderingCtx.fillStyle = p.color;
      renderingCtx.strokeStyle = p.color;
      if (p.isStreamer) {
        renderingCtx.lineWidth = p.size;
        renderingCtx.beginPath();
        for (let j = 0; j < p.length; j += 4) {
          const waveX = Math.sin(j * p.waveFrequency + p.waveOffset + p.rotation) * 8;
          const px = p.x + waveX, py = p.y + j;
          if (j === 0) renderingCtx.moveTo(px, py); else renderingCtx.lineTo(px, py);
        }
        renderingCtx.stroke();
      } else {
        renderingCtx.translate(p.x, p.y);
        renderingCtx.rotate(p.rotation);
        renderingCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * (0.6 + Math.sin(p.rotation) * 0.4));
      }
      renderingCtx.restore();
    });
  },
};

/* ------------------------------------------------------------------------ *
 * Screen shake — tiny isolated bit of camera juice.
 * ------------------------------------------------------------------------ */

const ScreenShake = {
  duration: 0,
  intensity: 0,
  trigger(intensity = 6, duration = 0.2) {
    this.intensity = intensity;
    this.duration = duration;
  },
  update(dt) {
    if (this.duration > 0) this.duration -= dt;
  },
  applyTo(renderingCtx) {
    if (this.duration > 0) {
      renderingCtx.translate((Math.random() - 0.5) * this.intensity, (Math.random() - 0.5) * this.intensity);
    }
  },
};

/* ------------------------------------------------------------------------ *
 * Renderers — pure drawing functions.
 * ------------------------------------------------------------------------ */

function drawHeadlightCone(c, width, length) {
  const grad = c.createLinearGradient(0, -10, 0, -length);
  grad.addColorStop(0, 'rgba(255, 235, 150, 0.45)');
  grad.addColorStop(0.3, 'rgba(255, 220, 100, 0.2)');
  grad.addColorStop(1, 'rgba(255, 220, 100, 0)');
  c.fillStyle = grad;
  c.beginPath();
  c.moveTo(-8, -10);
  c.lineTo(-width / 2, -length);
  c.lineTo(width / 2, -length);
  c.lineTo(8, -10);
  c.closePath();
  c.fill();
}

function drawScooter(c, x, y) {
  c.save(); c.translate(x, y);
  drawHeadlightCone(c, 130, 220);
  c.fillStyle = 'rgba(0, 0, 0, 0.35)';
  c.beginPath(); c.ellipse(0, 8, 20, 36, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#1c1d21'; c.fillRect(-5, -36, 10, 14); c.fillRect(-6, 26, 12, 14);
  c.fillStyle = '#2b2d35'; c.beginPath(); c.roundRect(-15, -28, 30, 56, 6); c.fill();
  c.fillStyle = '#1a1a1a'; c.fillRect(-28, -20, 56, 5);
  c.fillStyle = '#222'; c.fillRect(-30, -22, 6, 8);
  c.fillStyle = '#e74c3c'; c.fillRect(-32, -22, 4, 8);
  c.fillStyle = '#222'; c.fillRect(24, -22, 6, 8);
  c.fillStyle = '#e74c3c'; c.fillRect(28, -22, 4, 8);
  c.fillStyle = '#d32f2f'; c.beginPath(); c.roundRect(-19, 5, 38, 28, 4); c.fill();
  c.fillStyle = '#ef5350'; c.beginPath(); c.roundRect(-17, 7, 34, 24, 3); c.fill();
  c.fillStyle = '#ffffff'; c.beginPath(); c.roundRect(-10, 13, 20, 12, 2); c.fill();
  c.fillStyle = '#1976d2'; c.fillRect(-6, 16, 12, 6);
  c.fillStyle = '#e65100'; c.beginPath(); c.roundRect(-14, -15, 28, 26, 6); c.fill();
  c.fillStyle = '#f57c00'; c.beginPath(); c.roundRect(-13, -15, 26, 22, 5); c.fill();
  c.fillStyle = '#f57c00';
  c.beginPath(); c.moveTo(-12, -8); c.lineTo(-24, -18); c.lineTo(-19, -21); c.lineTo(-8, -12); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(12, -8); c.lineTo(24, -18); c.lineTo(19, -21); c.lineTo(8, -12); c.closePath(); c.fill();
  c.fillStyle = '#111111'; c.beginPath(); c.arc(0, -6, 12, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ff9800'; c.beginPath(); c.arc(0, -7, 10.5, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fb8c00'; c.fillRect(-3, -16, 6, 12);
  c.fillStyle = '#1a1a1a'; c.fillRect(-8, -15, 16, 4);
  c.fillStyle = '#ff1744'; c.fillRect(-10, 31, 20, 3);
  c.restore();
}

function drawSkater(c, x, y) {
  c.save(); c.translate(x, y);
  drawHeadlightCone(c, 110, 180);
  c.fillStyle = 'rgba(0, 0, 0, 0.4)';
  c.beginPath(); c.ellipse(0, 6, 16, 38, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#0072ce'; c.beginPath(); c.roundRect(-12, -36, 24, 72, 10); c.fill();
  c.fillStyle = '#181b20'; c.beginPath(); c.roundRect(-10, -34, 20, 68, 8); c.fill();
  c.fillStyle = '#242424';
  c.fillRect(-15, -28, 4, 10); c.fillRect(11, -28, 4, 10);
  c.fillRect(-15, 18, 4, 10); c.fillRect(11, 18, 4, 10);
  c.fillStyle = '#ffffff';
  c.beginPath(); c.ellipse(-2, -18, 4, 8, -Math.PI / 12, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(1, 14, 4, 8, Math.PI / 8, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#111';
  c.beginPath(); c.ellipse(-2, -18, 3, 6, -Math.PI / 12, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(1, 14, 3, 6, Math.PI / 8, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffb380';
  c.beginPath(); c.ellipse(-14, -8, 4, 10, -Math.PI / 4, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(14, -3, 4, 10, Math.PI / 4, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#0072ce';
  c.beginPath(); c.arc(-11, -12, 5, 0, Math.PI * 2); c.arc(11, -10, 5, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#0066c4'; c.beginPath(); c.roundRect(-16, -10, 32, 30, 6); c.fill();
  c.fillStyle = '#0072ce'; c.beginPath(); c.roundRect(-14, -8, 28, 26, 4); c.fill();
  c.save(); c.translate(0, 5); c.rotate(-Math.PI / 4);
  c.fillStyle = '#ffffff'; c.fillRect(-9, -9, 18, 18);
  c.fillStyle = '#0066c4'; c.fillRect(-8, -8, 7, 16);
  c.fillStyle = '#e31837'; c.fillRect(1, -8, 7, 16);
  c.restore();
  c.fillStyle = '#1f242d'; c.fillRect(-12, -18, 4, 10); c.fillRect(8, -18, 4, 10);
  c.fillStyle = '#004c8c'; c.beginPath(); c.arc(0, -20, 15, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#0072ce'; c.beginPath(); c.arc(0, -21, 13.5, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#3399ff'; c.beginPath(); c.ellipse(0, -21, 3, 11, 0, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drawTukTuk(c, x, y) {
  c.save(); c.translate(x, y);
  drawHeadlightCone(c, 160, 240);
  c.fillStyle = 'rgba(0, 0, 0, 0.4)';
  c.beginPath(); c.ellipse(0, 4, 25, 42, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#1e272e'; c.fillRect(-24, 18, 6, 16); c.fillRect(18, 18, 6, 16);
  c.fillRect(-4, -42, 8, 12);
  c.fillStyle = '#27ae60'; c.fillRect(-6, -40, 12, 8);
  c.fillStyle = '#f1c40f'; c.beginPath(); c.roundRect(-22, -10, 44, 48, 6); c.fill();
  c.fillStyle = '#27ae60'; c.beginPath(); c.roundRect(-18, -36, 36, 28, 8); c.fill();
  c.fillStyle = '#2c3e50'; c.beginPath(); c.roundRect(-17, -22, 34, 38, 5); c.fill();
  c.fillStyle = '#74b9ff'; c.beginPath(); c.roundRect(-14, -33, 28, 10, 3); c.fill();
  c.fillStyle = '#fff200'; c.beginPath(); c.arc(-11, -34, 3, 0, Math.PI * 2); c.arc(11, -34, 3, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#e67e22'; c.fillRect(-17, -30, 3, 4); c.fillRect(14, -30, 3, 4);
  c.fillStyle = '#2d3436'; c.fillRect(-23, -28, 5, 3); c.fillRect(18, -28, 5, 3);
  c.fillStyle = '#ff3838'; c.fillRect(-18, 35, 8, 3); c.fillRect(10, 35, 8, 3);
  c.restore();
}

const VEHICLE_RENDERERS = { scooter: drawScooter, skater: drawSkater, tuktuk: drawTukTuk };

function drawPlayerVehicle(c, x, y) {
  const renderFn = VEHICLE_RENDERERS[CONFIG.vehicles[GameState.vehicleIndex].id];
  renderFn(c, x, y);
}

function drawCar(c, x, y, width, height, model, isReversing) {
  c.save(); c.translate(x, y);
  if (isReversing) c.rotate(Math.PI);

  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(-width / 2 + 2, -height / 2 + 4, width, height);

  c.fillStyle = model.color;
  c.beginPath(); c.roundRect(-width / 2, -height / 2, width, height, 10); c.fill();
  c.fillRect(-width / 2 - 3, -height / 2 + 14, 4, 6);
  c.fillRect(width / 2 - 1, -height / 2 + 14, 4, 6);

  c.fillStyle = '#1e272e';
  c.fillRect(-width / 2 + 4, -height / 2 + 16, width - 8, height - 32);

  c.fillStyle = 'rgba(255,255,255,0.25)';
  c.beginPath();
  c.moveTo(-width / 2 + 5, -height / 2 + 18);
  c.lineTo(width / 2 - 5, -height / 2 + 18);
  c.lineTo(width / 2 - 7, -height / 2 + 26);
  c.lineTo(-width / 2 + 7, -height / 2 + 26);
  c.closePath(); c.fill();

  if (model.type === 'taxi') {
    c.fillStyle = '#f1c40f'; c.fillRect(-8, -2, 16, 5);
  } else if (model.type === 'police') {
    c.fillStyle = '#ff3838'; c.fillRect(-7, -2, 6, 4);
    c.fillStyle = '#17c0eb'; c.fillRect(1, -2, 6, 4);
  }

  c.fillStyle = '#fff200';
  c.fillRect(-width / 2 + 3, -height / 2, 6, 3);
  c.fillRect(width / 2 - 9, -height / 2, 6, 3);
  c.fillStyle = '#ff3838';
  c.fillRect(-width / 2 + 3, height / 2 - 3, 6, 3);
  c.fillRect(width / 2 - 9, height / 2 - 3, 6, 3);
  c.restore();
}

function drawTruck(c, x, y, width, height) {
  c.save(); c.translate(x, y);
  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.fillRect(-width / 2 + 3, -height / 2 + 5, width, height);
  c.fillStyle = '#1a1a1a';
  c.fillRect(-width / 2 - 2, -height / 2 + 20, 3, 14);
  c.fillRect(width / 2 - 1, -height / 2 + 20, 3, 14);
  c.fillRect(-width / 2 - 2, height / 2 - 40, 3, 16);
  c.fillRect(width / 2 - 1, height / 2 - 40, 3, 16);
  c.fillStyle = '#f0eee6';
  c.beginPath(); c.roundRect(-width / 2 + 1, -height / 2 + 45, width - 2, 100, 4); c.fill();
  c.lineWidth = 1.5; c.strokeStyle = '#b0ad9e'; c.stroke();
  c.fillStyle = '#222';
  c.fillRect(-width / 2 - 4, -height / 2 + 25, 4, 8);
  c.fillRect(width / 2, -height / 2 + 25, 4, 8);
  c.fillStyle = '#ff6b00';
  c.beginPath(); c.roundRect(-width / 2, -height / 2, width, 48, 8); c.fill();
  c.fillStyle = '#e05a00';
  c.beginPath(); c.roundRect(-width / 2 + 5, -height / 2 + 15, width - 10, 26, 4); c.fill();
  c.fillStyle = '#2c3e50';
  c.beginPath(); c.roundRect(-width / 2 + 4, -height / 2 + 6, width - 8, 12, 3); c.fill();
  c.fillStyle = '#1e272e';
  c.fillRect(-width / 2 + 10, -height / 2, width - 20, 3);
  c.fillStyle = '#fff200';
  c.fillRect(-width / 2 + 2, -height / 2 + 1, 6, 3);
  c.fillRect(width / 2 - 8, -height / 2 + 1, 6, 3);
  c.fillStyle = '#ff3838';
  c.fillRect(-width / 2 + 4, height / 2 - 3, 7, 3);
  c.fillRect(width / 2 - 11, height / 2 - 3, 7, 3);
  c.restore();
}

function drawPothole(hole) {
  ctx.save(); ctx.translate(hole.x, hole.y);
  ctx.fillStyle = '#171717';
  ctx.beginPath();
  ctx.moveTo(hole.points[0].x * 1.25, hole.points[0].y * 1.25);
  for (let i = 1; i < hole.points.length; i++) ctx.lineTo(hole.points[i].x * 1.25, hole.points[i].y * 1.25);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = '#080808';
  ctx.beginPath();
  ctx.moveTo(hole.points[0].x, hole.points[0].y);
  for (let i = 1; i < hole.points.length; i++) ctx.lineTo(hole.points[i].x, hole.points[i].y);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawCow(cow) {
  ctx.save(); ctx.translate(cow.x, cow.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-18, -10, 38, 26);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(-18, -12, 36, 24);
  ctx.fillStyle = '#2d3436';
  ctx.fillRect(-14, -10, 10, 8); ctx.fillRect(4, 2, 10, 8); ctx.fillRect(-2, 0, 8, 8);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(14, -14, 12, 14);
  ctx.fillStyle = '#ff7675'; ctx.fillRect(20, -8, 8, 8);
  ctx.fillStyle = '#ffeaa7'; ctx.fillRect(14, -18, 4, 4);
  ctx.restore();
}

function drawTree(c, x, y, scale) {
  c.save(); c.translate(x, y); c.scale(scale, scale);
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(0, 4, 12, 6, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#5d4037'; c.fillRect(-3, -6, 6, 12);
  c.fillStyle = '#1e824c'; c.beginPath(); c.arc(0, -18, 14, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#26af61';
  c.beginPath(); c.arc(-4, -20, 10, 0, Math.PI * 2); c.arc(5, -16, 9, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#2ecc71'; c.beginPath(); c.arc(-2, -22, 6, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drawBush(c, x, y, scale) {
  c.save(); c.translate(x, y); c.scale(scale, scale);
  c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath(); c.ellipse(0, 2, 10, 4, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#1b5e20';
  c.beginPath(); c.arc(-5, 0, 8, 0, Math.PI * 2); c.arc(4, 0, 9, 0, Math.PI * 2); c.arc(0, -5, 8, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#2e7d32';
  c.beginPath(); c.arc(-3, -2, 6, 0, Math.PI * 2); c.arc(2, -3, 6, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drawCoin(coin, spinAngle) {
  ctx.save(); ctx.translate(coin.x, coin.y);
  ctx.scale(Math.cos(spinAngle), 1);
  ctx.beginPath(); ctx.arc(0, 0, coin.radius, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd700'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#e67e22'; ctx.stroke();
  ctx.restore();
}

function drawFinishLine(y) {
  ctx.save(); ctx.translate(20, y);
  const cols = 16, size = 20;
  for (let r = 0; r < 2; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      ctx.fillStyle = (r + cIdx) % 2 === 0 ? '#ffffff' : '#000000';
      ctx.fillRect(cIdx * size, r * size, size, size);
    }
  }
  ctx.restore();
}

function drawBuilding(c, x, y, scale) {
  c.save(); c.translate(x, y); c.scale(scale, scale);
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(0, 4, 14, 5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#2b2f3a'; c.fillRect(-12, -50, 24, 54);
  c.fillStyle = '#f4d35e';
  const lit = [1, 0, 1, 1, 0, 1, 1, 1];
  let idx = 0;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 2; col++) {
      if (lit[idx++]) c.fillRect(-8 + col * 10, -46 + row * 11, 5, 6);
    }
  }
  c.fillStyle = '#1a1c22'; c.fillRect(-12, -2, 24, 6);
  c.restore();
}

function drawStall(c, x, y, scale) {
  c.save(); c.translate(x, y); c.scale(scale, scale);
  c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(0, 4, 14, 5, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#c0392b';
  c.beginPath(); c.moveTo(-16, -6); c.lineTo(16, -6); c.lineTo(10, -20); c.lineTo(-10, -20); c.closePath(); c.fill();
  c.fillStyle = '#e67e22'; c.fillRect(-14, -6, 28, 16);
  c.fillStyle = '#ffe066';
  c.beginPath(); c.arc(-10, -22, 2, 0, Math.PI * 2); c.arc(0, -24, 2, 0, Math.PI * 2); c.arc(10, -22, 2, 0, Math.PI * 2); c.fill();
  c.restore();
}

function drawBarrier(c, x, y, scale) {
  c.save(); c.translate(x, y); c.scale(scale, scale);
  c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(-14, 2, 28, 6);
  c.fillStyle = '#9aa5ad'; c.beginPath(); c.roundRect(-14, -14, 28, 20, 4); c.fill();
  c.fillStyle = '#ff9f1a'; c.fillRect(-14, -14, 28, 4);
  c.restore();
}

const PROP_RENDERERS = { tree: drawTree, bush: drawBush, building: drawBuilding, stall: drawStall, barrier: drawBarrier };

function drawRainStreaks() {
  ctx.save();
  ctx.strokeStyle = 'rgba(200, 220, 255, 0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 18; i++) {
    const bx = (i * 37 + GameState.roadOffset * 2) % 380 - 10;
    const by = (i * 53 + GameState.roadOffset * 6) % 680 - 20;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - 6, by + 24);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPowerupPickup(pu, spinAngle) {
  ctx.save(); ctx.translate(pu.x, pu.y);
  ctx.scale(Math.cos(spinAngle), 1);
  ctx.beginPath(); ctx.arc(0, 0, pu.radius, 0, Math.PI * 2);
  ctx.fillStyle = pu.type === 'magnet' ? '#00d2d3' : '#ffd700';
  ctx.globalAlpha = 0.22;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = pu.type === 'magnet' ? '#00d2d3' : '#ffd700';
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = '16px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pu.type === 'magnet' ? '🧲' : '🛡️', pu.x, pu.y);
  ctx.restore();
}

function drawPowerupAura(nowMs) {
  if (GameState.shieldActive) {
    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(nowMs / 120) * 0.15;
    ctx.strokeStyle = '#00d2d3';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(player.x, player.y, Math.max(player.width, player.height) / 2 + 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  if (nowMs < GameState.magnetUntil) {
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, CONFIG.magnet.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSpeedLines() {
  if (GameState.gameSpeed < CONFIG.speedLineThreshold) return;
  const intensity = Math.min(1, (GameState.gameSpeed - CONFIG.speedLineThreshold) / 200);
  ctx.save();
  ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 + intensity * 0.25})`;
  ctx.lineWidth = 2;
  const offset = GameState.roadOffset * 3;
  for (let i = 0; i < 8; i++) {
    const y = ((i * 90 + offset) % 760) - 60;
    const len = 40 + intensity * 20;
    ctx.beginPath(); ctx.moveTo(2, y); ctx.lineTo(2, y + len); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(358, y); ctx.lineTo(358, y + len); ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------------ *
 * GameState — all mutable run-time state lives here (a single place to
 * inspect/reset, instead of dozens of scattered globals).
 * ------------------------------------------------------------------------ */

const GameState = {
  state: CONST.MENU,
  vehicleIndex: 0,
  modeIndex: 0,

  score: 0,
  coins: 0,
  gameSpeed: 300,
  roadOffset: 0,
  coinSpinAngle: 0,
  spawnTimer: 0,
  distancePixelAcc: 0,
  speedMilestone: 0,

  startTimeMs: 0,
  elapsedSec: 0,
  remainingTime: 0,
  timerInterval: null,

  finishLineY: -200,
  finishLineSpawned: false,
  pendingCrashReason: '',
  lastHornTime: 0,
  lastFrameTime: 0,
  rafId: null,

  // Limitless-only systems
  magnetUntil: 0,
  shieldActive: false,
  combo: 0,
  comboTimer: 0,
  environmentIndex: 0,

  bestDistance: Number(localStorage.getItem(CONFIG.storageKey)) || 0,
};

const player = { currentLane: 1, x: CONFIG.lanes[1], y: 430, width: 44, height: 84, slideSpeed: 16 };

let obstacles = [];
let coins = [];
let potholes = [];
let animals = [];
let powerups = [];
let roadsideProps = [];

/* ------------------------------------------------------------------------ *
 * World — spawning, movement, collisions for all lane entities.
 * ------------------------------------------------------------------------ */

const World = {
  /** Picks a roadside prop type appropriate for the current environment (Limitless only). */
  _randomPropType() {
    if (GameState.modeIndex === 3) {
      const env = CONFIG.environments[GameState.environmentIndex];
      return Util.choice(env.leftProps);
    }
    return Math.random() < 0.5 ? 'tree' : 'bush';
  },

  initRoadsideProps() {
    roadsideProps = [];
    for (let y = -100; y < 700; y += 75) {
      roadsideProps.push({
        y,
        leftType: this._randomPropType(),
        rightType: this._randomPropType(),
        leftScale: 0.8 + Math.random() * 0.4,
        rightScale: 0.8 + Math.random() * 0.4,
      });
    }
  },

  reset() {
    obstacles = []; coins = []; potholes = []; animals = []; powerups = [];
    this.initRoadsideProps();
  },

  spawnPotholeCoinTrap(laneX, potholeY) {
    if (Math.random() < 0.35) {
      for (let i = 1; i <= 3; i++) {
        coins.push({ x: laneX, y: potholeY + i * 38, radius: 12 });
      }
    }
  },

  spawnEntities(dt) {
    if (GameState.finishLineSpawned) return;
    const mode = CONFIG.modes[GameState.modeIndex];

    GameState.spawnTimer += dt;
    if (GameState.spawnTimer >= mode.spawnInterval) {
      GameState.spawnTimer = 0;
      this._trySpawnLaneEntity(mode);
    }

    if (Math.random() < 0.03) this._maybeSpawnLooseCoin();
    if (GameState.modeIndex === 3 && Math.random() < CONFIG.powerupSpawnChance) this._maybeSpawnPowerup();
  },

  _maybeSpawnPowerup() {
    const laneX = Util.choice(CONFIG.lanes);
    const occupied = obstacles.some((o) => o.x === laneX && o.y < 90) ||
      potholes.some((p) => p.x === laneX && p.y < 90) ||
      powerups.some((p) => p.x === laneX && p.y < 90);
    if (occupied) return;
    powerups.push({ x: laneX, y: -60, radius: 15, type: Math.random() < 0.5 ? 'magnet' : 'shield' });
  },

  /** True if any active car or pothole currently sits in this lane, anywhere on the track. */
  _laneHasAnyHazard(laneX) {
    return obstacles.some((o) => o.x === laneX) || potholes.some((p) => p.x === laneX);
  },

  _trySpawnLaneEntity(mode) {
    const isTruckNext = Math.random() < 0.3;
    const requiredGap = isTruckNext ? 280 : 200;
    const laneBlocked = [false, false, false];

    CONFIG.lanes.forEach((laneX, idx) => {
      const carNearTop = obstacles.some((o) => o.x === laneX && o.y < requiredGap);
      const potholeNearTop = potholes.some((p) => p.x === laneX && p.y < requiredGap);
      if (carNearTop || potholeNearTop) laneBlocked[idx] = true;
    });

    let availableLanes = [];
    for (let i = 0; i < 3; i++) if (!laneBlocked[i]) availableLanes.push(i);

    let upperBlockedCount = 0;
    for (let i = 0; i < 3; i++) {
      const hasObstacle = obstacles.some((o) => o.x === CONFIG.lanes[i] && o.y < 260) ||
        potholes.some((p) => p.x === CONFIG.lanes[i] && p.y < 260);
      if (hasObstacle) upperBlockedCount++;
    }
    if (upperBlockedCount >= 2) availableLanes = [];

    // Hard safety invariant: never let a lane-fixed hazard (car/pothole) spawn
    // if doing so would leave zero lanes completely hazard-free anywhere on
    // the track. Cars, trucks, and reversing traffic all move at different
    // speeds, so entities that looked safely staggered at spawn time can
    // still drift into alignment lower down — this check guards against that
    // regardless of speed, by guaranteeing an always-open escape lane rather
    // than just checking clearance near the top of the screen.
    const hazardByLane = CONFIG.lanes.map((laneX) => this._laneHasAnyHazard(laneX));
    availableLanes = availableLanes.filter((idx) => {
      const others = [0, 1, 2].filter((i) => i !== idx);
      const bothOthersHazardous = others.every((i) => hazardByLane[i]);
      return !bothOthersHazardous;
    });

    if (availableLanes.length === 0) return;

    const laneX = CONFIG.lanes[Util.choice(availableLanes)];
    const roll = Math.random();

    if (roll < mode.ratioCar) {
      this._spawnVehicle(laneX, isTruckNext, mode);
    } else if (roll < mode.ratioCar + mode.ratioPothole) {
      const pY = -80;
      potholes.push({ x: laneX, y: pY, radius: 26, points: Util.generateCrackedPolygon(26) });
      this.spawnPotholeCoinTrap(laneX, pY);
    } else if (roll < mode.ratioCar + mode.ratioPothole + mode.ratioAnimal) {
      const startFromLeft = Math.random() < 0.5;
      animals.push({
        x: startFromLeft ? 30 : 330, y: -80,
        targetVx: startFromLeft ? 140 : -140, moving: false, mooed: false,
      });
    }
  },

  _spawnVehicle(laneX, isTruck, mode) {
    if (isTruck) {
      obstacles.push({
        x: laneX, y: -160, width: 44, height: 150,
        speed: GameState.gameSpeed * mode.trafficSpeedMult * 0.9,
        isTruck: true, isReversing: false, nearMissed: false,
      });
      return;
    }
    const model = Util.choice(CONFIG.carModels);
    const isReversing = GameState.modeIndex >= 2 && Math.random() < 0.35;
    const speed = isReversing ? GameState.gameSpeed * 1.05 : GameState.gameSpeed * mode.trafficSpeedMult;
    obstacles.push({
      x: laneX, y: -100, width: 42, height: 75,
      speed, model, isTruck: false, isReversing, nearMissed: false,
    });
  },

  _maybeSpawnLooseCoin() {
    const laneX = Util.choice(CONFIG.lanes);
    const occupied = obstacles.some((o) => o.x === laneX && o.y < 50) ||
      potholes.some((p) => p.x === laneX && p.y < 50);
    if (!occupied) coins.push({ x: laneX, y: -50, radius: 12 });
  },

  updateRoadside(dt) {
    roadsideProps.forEach((prop) => {
      prop.y += GameState.gameSpeed * dt;
      if (prop.y > 670) {
        prop.y -= 770;
        prop.leftType = this._randomPropType();
        prop.rightType = this._randomPropType();
      }
    });
  },

  /** Returns a crash reason string if the player collided with something (and had no shield), else null. */
  updateAndCollide(dt) {
    const now = performance.now();
    const magnetActive = now < GameState.magnetUntil;

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obs = obstacles[i];
      obs.y += obs.speed * dt;

      const playerLaneX = CONFIG.lanes[player.currentLane];
      if (obs.x === playerLaneX && obs.y > 100 && obs.y < player.y - 80) {
        if (now - GameState.lastHornTime > 1800) {
          AudioEngine.play('horn');
          GameState.lastHornTime = now;
        }
      }

      if (
        Math.abs(player.x - obs.x) < (player.width / 2 + obs.width / 2) - 6 &&
        Math.abs(player.y - obs.y) < (player.height / 2 + obs.height / 2) - 6
      ) {
        if (Game.consumeShieldIfActive()) { Util.swapRemove(obstacles, i); continue; }
        AudioEngine.play('crash');
        ScreenShake.trigger(12, 0.4);
        Haptics.buzz(35);
        return obs.isTruck ? 'Crashed into Large Truck!' : 'Crashed into Traffic!';
      }

      if (!obs.nearMissed && Math.abs(player.y - obs.y) < obs.height / 2 + 10 &&
        Math.abs(player.x - obs.x) < 62 && Math.abs(player.x - obs.x) > 28) {
        obs.nearMissed = true;
        Game.registerNearMiss();
      }

      if (obs.y > 790) Util.swapRemove(obstacles, i);
    }

    for (let i = potholes.length - 1; i >= 0; i--) {
      const hole = potholes[i];
      hole.y += GameState.gameSpeed * dt;

      if (
        Math.abs(player.x - hole.x) < player.width / 2 + hole.radius - 10 &&
        Math.abs(player.y - hole.y) < player.height / 2 + hole.radius - 10
      ) {
        if (Game.consumeShieldIfActive()) { Util.swapRemove(potholes, i); continue; }
        AudioEngine.play('pothole');
        ScreenShake.trigger(8, 0.3);
        Haptics.buzz(25);
        return 'Slipped in Deep Pothole!';
      }
      if (hole.y > 720) Util.swapRemove(potholes, i);
    }

    for (let i = animals.length - 1; i >= 0; i--) {
      const animal = animals[i];
      animal.y += GameState.gameSpeed * dt;
      const distY = player.y - animal.y;
      if (distY < 320) animal.moving = true;

      if (!animal.mooed && Math.abs(distY) < 60) {
        AudioEngine.play('moo');
        animal.mooed = true;
      }
      if (animal.moving) animal.x += animal.targetVx * dt;

      if (
        Math.abs(player.x - animal.x) < player.width / 2 + 16 &&
        Math.abs(player.y - animal.y) < player.height / 2 + 12
      ) {
        if (Game.consumeShieldIfActive()) { Util.swapRemove(animals, i); continue; }
        AudioEngine.play('crash');
        ScreenShake.trigger(10, 0.35);
        Haptics.buzz(35);
        return 'Crashed into Stray Cow!';
      }
      if (animal.y > 720) Util.swapRemove(animals, i);
    }

    for (let i = coins.length - 1; i >= 0; i--) {
      const coin = coins[i];
      coin.y += GameState.gameSpeed * dt;
      if (magnetActive) {
        const dx = player.x - coin.x, dy = player.y - coin.y;
        if (Math.hypot(dx, dy) < CONFIG.magnet.radius) {
          coin.x += dx * Math.min(1, 6 * dt);
          coin.y += dy * Math.min(1, 6 * dt);
        }
      }

      const dist = Math.hypot(player.x - coin.x, player.y - coin.y);
      if (dist < coin.radius + player.width / 2) {
        GameState.coins++;
        dom.coinsEl.textContent = GameState.coins;
        GameState.score += 2;
        dom.scoreEl.textContent = GameState.score;
        AudioEngine.play('coin');
        Particles.addFloatingText('+2m', coin.x, coin.y, '#ffd700');
        Util.swapRemove(coins, i);
        continue;
      }
      if (coin.y > 690) Util.swapRemove(coins, i);
    }

    for (let i = powerups.length - 1; i >= 0; i--) {
      const pu = powerups[i];
      pu.y += GameState.gameSpeed * dt;

      const dist = Math.hypot(player.x - pu.x, player.y - pu.y);
      if (dist < pu.radius + player.width / 2) {
        Game.activatePowerup(pu.type);
        Util.swapRemove(powerups, i);
        continue;
      }
      if (pu.y > 690) Util.swapRemove(powerups, i);
    }

    return null;
  },

  clearNear(playerY, margin = 220) {
    obstacles = obstacles.filter((o) => Math.abs(o.y - playerY) > margin);
    potholes = potholes.filter((p) => Math.abs(p.y - playerY) > margin);
    animals = animals.filter((a) => Math.abs(a.y - playerY) > margin);
  },

  render() {
    potholes.forEach(drawPothole);
    for (let i = 0; i < coins.length; i++) drawCoin(coins[i], GameState.coinSpinAngle);
    for (let i = 0; i < powerups.length; i++) drawPowerupPickup(powerups[i], GameState.coinSpinAngle);
    animals.forEach(drawCow);
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (obs.isTruck) drawTruck(ctx, obs.x, obs.y, obs.width, obs.height);
      else drawCar(ctx, obs.x, obs.y, obs.width, obs.height, obs.model, obs.isReversing);
    }
  },
};

const Haptics = {
  buzz(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
  },
};

/* ------------------------------------------------------------------------ *
 * Road / environment rendering
 * ------------------------------------------------------------------------ */

function drawRoad() {
  const env = GameState.modeIndex === 3 ? CONFIG.environments[GameState.environmentIndex] : null;
  const shoulderColor = env ? env.shoulderColor : '#27ae60';
  const roadColor = env ? env.roadColor : '#3a3a3a';
  const laneLineColor = env ? env.laneLineColor : '#ffffff';

  ctx.fillStyle = shoulderColor;
  ctx.fillRect(0, 0, 20, 640);
  ctx.fillRect(340, 0, 20, 640);

  ctx.fillStyle = roadColor;
  ctx.fillRect(20, 0, 320, 640);

  ctx.fillStyle = laneLineColor;
  ctx.fillRect(20, 0, 6, 640);
  ctx.fillRect(334, 0, 6, 640);

  ctx.strokeStyle = laneLineColor;
  ctx.lineWidth = 4;
  ctx.setLineDash([20, 20]);
  ctx.lineDashOffset = -GameState.roadOffset;
  ctx.beginPath();
  ctx.moveTo(125, 0); ctx.lineTo(125, 640);
  ctx.moveTo(235, 0); ctx.lineTo(235, 640);
  ctx.stroke();
  ctx.setLineDash([]);

  roadsideProps.forEach((prop) => {
    PROP_RENDERERS[prop.leftType](ctx, 10, prop.y, prop.leftScale);
    PROP_RENDERERS[prop.rightType](ctx, 350, prop.y, prop.rightScale);
  });

  if (env && env.overlay) {
    ctx.save();
    ctx.fillStyle = env.overlay;
    ctx.fillRect(0, 0, 360, 640);
    ctx.restore();
  }
  if (env && env.rain) drawRainStreaks();

  if (GameState.finishLineSpawned) drawFinishLine(GameState.finishLineY);
}

/* ------------------------------------------------------------------------ *
 * ScreenManager — single source of truth for which modal is visible.
 * ------------------------------------------------------------------------ */

const ScreenManager = {
  show(screenEl) {
    [dom.startScreen, dom.respawnScreen, dom.gameOverScreen].forEach((el) => el.classList.add('hidden'));
    if (screenEl) screenEl.classList.remove('hidden');
  },
  showMenu() { this.show(dom.startScreen); },
  showRespawn(reason) {
    dom.respawnReason.textContent = reason;
    this.show(dom.respawnScreen);
  },
  showGameOver({ isWin, reason, score, coins: coinCount, elapsedSec, difficultyLabel }) {
    dom.crashTitle.textContent = isWin ? 'DELIVERY COMPLETED!' : 'DELIVERY FAILED!';
    dom.crashTitle.classList.toggle('accent-teal', isWin);
    dom.crashTitle.classList.toggle('accent-red', !isWin);
    dom.crashReason.textContent = reason;
    dom.finalScoreEl.textContent = `${score}m`;
    dom.finalCoinsEl.textContent = coinCount;
    dom.endTimeEl.textContent = Util.formatTime(elapsedSec);
    dom.endDifficultyEl.textContent = difficultyLabel;
    setTimeout(() => this.show(dom.gameOverScreen), isWin ? 600 : 0);
  },
  updateModeLabel() { dom.modeTitle.textContent = CONFIG.modes[GameState.modeIndex].label; },
  updateVehicleLabel() { dom.vehicleTitle.textContent = CONFIG.vehicles[GameState.vehicleIndex].label; },
  updateBestDistance() {
    if (GameState.bestDistance > 0) {
      dom.bestDistanceRow.hidden = false;
      dom.bestDistanceValue.textContent = GameState.bestDistance;
    }
  },
  renderPreview() {
    previewCtx.clearRect(0, 0, 110, 140);
    drawPlayerVehicle(previewCtx, 55, 70);
  },
  updateLimitlessHud() {
    const isLimitless = GameState.modeIndex === 3 && GameState.state === CONST.PLAYING;
    dom.limitlessHud.hidden = !isLimitless;
    if (!isLimitless) return;

    dom.comboBadge.classList.toggle('hidden', GameState.combo <= 0);
    if (GameState.combo > 0) {
      const tier = 1 + Math.floor((GameState.combo - 1) / CONFIG.combo.tierSize);
      dom.comboValue.textContent = tier;
    }

    const magnetActive = performance.now() < GameState.magnetUntil;
    dom.magnetBadge.classList.toggle('hidden', !magnetActive);
    if (magnetActive) {
      dom.magnetTimer.textContent = Math.max(0, Math.ceil((GameState.magnetUntil - performance.now()) / 1000));
    }

    dom.shieldBadge.classList.toggle('hidden', !GameState.shieldActive);
  },
};

/* ------------------------------------------------------------------------ *
 * InputManager — keyboard, tap buttons, and swipe gestures unified.
 * ------------------------------------------------------------------------ */

const InputManager = {
  setup() {
    const handleLeft = (e) => { e.preventDefault(); Game.shiftLane(-1); };
    const handleRight = (e) => { e.preventDefault(); Game.shiftLane(1); };

    dom.leftBtn.addEventListener('pointerdown', handleLeft);
    dom.rightBtn.addEventListener('pointerdown', handleRight);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') Game.shiftLane(-1);
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') Game.shiftLane(1);
    });

    // Swipe support directly on the canvas, additive to the on-screen buttons.
    let touchStartX = null;
    const SWIPE_THRESHOLD = 32;
    dom.canvas.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].clientX;
    }, { passive: true });
    dom.canvas.addEventListener('touchend', (e) => {
      if (touchStartX === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > SWIPE_THRESHOLD) Game.shiftLane(dx > 0 ? 1 : -1);
      touchStartX = null;
    }, { passive: true });

    dom.prevModeBtn.addEventListener('click', () => {
      AudioEngine.play('click');
      GameState.modeIndex = (GameState.modeIndex - 1 + CONFIG.modes.length) % CONFIG.modes.length;
      ScreenManager.updateModeLabel();
    });
    dom.nextModeBtn.addEventListener('click', () => {
      AudioEngine.play('click');
      GameState.modeIndex = (GameState.modeIndex + 1) % CONFIG.modes.length;
      ScreenManager.updateModeLabel();
    });
    dom.prevVehicleBtn.addEventListener('click', () => {
      AudioEngine.play('select_ride');
      GameState.vehicleIndex = (GameState.vehicleIndex - 1 + CONFIG.vehicles.length) % CONFIG.vehicles.length;
      Game.applyVehicleStats();
    });
    dom.nextVehicleBtn.addEventListener('click', () => {
      AudioEngine.play('select_ride');
      GameState.vehicleIndex = (GameState.vehicleIndex + 1) % CONFIG.vehicles.length;
      Game.applyVehicleStats();
    });

    dom.startBtn.addEventListener('click', () => {
      AudioEngine.init();
      AudioEngine.play('rev_engine');
      Game.start();
    });
    dom.restartBtn.addEventListener('click', () => {
      AudioEngine.play('rev_engine');
      Game.start();
    });
    dom.menuBtn.addEventListener('click', () => {
      AudioEngine.play('click');
      Game.returnToMenu();
    });
    dom.useRespawnBtn.addEventListener('click', () => {
      AudioEngine.play('click');
      Game.performRespawn();
    });
    dom.skipRespawnBtn.addEventListener('click', () => {
      AudioEngine.play('click');
      Game.declineRespawn();
    });
  },
};

/* ------------------------------------------------------------------------ *
 * Game — state machine + main loop.
 * ------------------------------------------------------------------------ */

const Game = {
  get state() { return GameState.state; },

  init() {
    // Bind once — avoids allocating a new closure every single animation
    // frame (60x/sec) for the lifetime of a play session.
    this._loopBound = this._loop.bind(this);
  },

  applyVehicleStats() {
    const v = CONFIG.vehicles[GameState.vehicleIndex];
    player.width = v.width;
    player.height = v.height;
    player.slideSpeed = v.slideSpeed;
    ScreenManager.updateVehicleLabel();
    ScreenManager.renderPreview();
  },

  shiftLane(direction) {
    if (GameState.state !== CONST.PLAYING) return;
    const next = player.currentLane + direction;
    if (next < 0 || next > CONFIG.lanes.length - 1) return;
    player.currentLane = next;
    AudioEngine.play('shift');
    Particles.addDriftSparks(player.x, player.y, direction);
  },

  start() {
    dom.startScreen.classList.add('hidden');
    GameState.state = CONST.PLAYING;

    GameState.score = 0;
    GameState.coins = 0;
    GameState.distancePixelAcc = 0;
    GameState.speedMilestone = 0;
    GameState.gameSpeed = CONFIG.modes[GameState.modeIndex].speed;
    GameState.spawnTimer = 0;
    GameState.finishLineY = -200;
    GameState.finishLineSpawned = false;
    GameState.startTimeMs = performance.now();

    GameState.magnetUntil = 0;
    GameState.shieldActive = false;
    GameState.combo = 0;
    GameState.comboTimer = 0;
    GameState.environmentIndex = 0;

    Particles.clearAll();
    ScreenShake.duration = 0;
    AudioEngine.setTempo(1.0);

    World.reset();
    player.currentLane = 1;
    player.x = CONFIG.lanes[1];
    this.applyVehicleStats();

    dom.scoreEl.textContent = '0';
    dom.coinsEl.textContent = '0';

    this._setupRoundTimer();
    AudioEngine.startMusic(GameState.modeIndex);

    ScreenManager.show(null);
    if (GameState.rafId) cancelAnimationFrame(GameState.rafId);
    GameState.lastFrameTime = performance.now();
    GameState.rafId = requestAnimationFrame(this._loopBound);
  },

  returnToMenu() {
    GameState.state = CONST.MENU;
    AudioEngine.stopMusic();
    if (GameState.timerInterval) clearInterval(GameState.timerInterval);
    if (GameState.rafId) cancelAnimationFrame(GameState.rafId);
    ScreenManager.showMenu();
    ScreenManager.updateLimitlessHud();
  },

  _setupRoundTimer() {
    const mode = CONFIG.modes[GameState.modeIndex];
    if (GameState.timerInterval) clearInterval(GameState.timerInterval);

    if (mode.timeLimit <= 0) {
      dom.timerContainer.classList.add('hidden');
      return;
    }

    dom.timerContainer.classList.remove('hidden');
    GameState.remainingTime = mode.timeLimit;
    dom.timerEl.textContent = GameState.remainingTime;

    GameState.timerInterval = setInterval(() => {
      if (GameState.state !== CONST.PLAYING) return;
      GameState.remainingTime--;
      dom.timerEl.textContent = GameState.remainingTime;

      if (GameState.remainingTime <= 10 && GameState.remainingTime > 0) {
        AudioEngine.play('tick');
        AudioEngine.setTempo(1.25);
      }
      if (GameState.modeIndex === 2) GameState.gameSpeed += 5;

      if (GameState.remainingTime <= 0) {
        clearInterval(GameState.timerInterval);
        if (!GameState.finishLineSpawned) this._triggerFinishLine();
      }
    }, 1000);
  },

  _triggerFinishLine() {
    GameState.finishLineSpawned = true;
    GameState.finishLineY = -100;
  },

  _handleCrash(reason) {
    if (GameState.coins >= CONFIG.respawnCost) {
      GameState.pendingCrashReason = reason;
      GameState.state = CONST.RESPAWN_PROMPT;
      AudioEngine.stopMusic();
      ScreenManager.showRespawn(reason);
    } else {
      this._endRound(reason, false);
    }
  },

  performRespawn() {
    GameState.coins -= CONFIG.respawnCost;
    dom.coinsEl.textContent = GameState.coins;
    GameState.state = CONST.PLAYING;
    World.clearNear(player.y);

    AudioEngine.play('rev_engine');
    AudioEngine.startMusic(GameState.modeIndex);
    ScreenManager.show(null);
    GameState.lastFrameTime = performance.now();
    GameState.rafId = requestAnimationFrame(this._loopBound);
  },

  declineRespawn() {
    ScreenManager.show(null);
    this._endRound(GameState.pendingCrashReason, false);
  },

  _endRound(reason, isWin) {
    GameState.state = CONST.GAME_OVER;
    GameState.elapsedSec = Math.floor((performance.now() - GameState.startTimeMs) / 1000);
    AudioEngine.stopMusic();
    if (GameState.timerInterval) clearInterval(GameState.timerInterval);
    ScreenManager.updateLimitlessHud();

    if (GameState.score > GameState.bestDistance) {
      GameState.bestDistance = GameState.score;
      try { localStorage.setItem(CONFIG.storageKey, String(GameState.bestDistance)); } catch (_) { /* storage unavailable */ }
    }
    ScreenManager.updateBestDistance();

    ScreenManager.showGameOver({
      isWin, reason,
      score: GameState.score,
      coins: GameState.coins,
      elapsedSec: GameState.elapsedSec,
      difficultyLabel: CONFIG.modes[GameState.modeIndex].label,
    });
  },

  /** Consumes the shield if one is active and returns true, so callers can skip the crash. */
  consumeShieldIfActive() {
    if (!GameState.shieldActive) return false;
    GameState.shieldActive = false;
    AudioEngine.play('shield_break');
    ScreenShake.trigger(6, 0.2);
    Particles.addFloatingText('SHIELD BROKEN!', player.x, player.y - 50, '#00d2d3');
    return true;
  },

  registerNearMiss() {
    if (GameState.modeIndex === 3) {
      GameState.combo++;
      GameState.comboTimer = CONFIG.combo.window;
      const tier = 1 + Math.floor((GameState.combo - 1) / CONFIG.combo.tierSize);
      const bonus = CONFIG.combo.baseBonus * tier;
      GameState.score += bonus;
      dom.scoreEl.textContent = GameState.score;
      AudioEngine.play('near_miss');
      ScreenShake.trigger(4, 0.15);
      Particles.addFloatingText(`NEAR MISS! +${bonus}m x${tier}`, player.x, player.y - 40, '#00d2d3');
    } else {
      GameState.score += 5;
      dom.scoreEl.textContent = GameState.score;
      AudioEngine.play('near_miss');
      ScreenShake.trigger(4, 0.15);
      Particles.addFloatingText('NEAR MISS! +5m', player.x, player.y - 40, '#00d2d3');
    }
  },

  activatePowerup(type) {
    AudioEngine.play('powerup');
    if (type === 'magnet') {
      GameState.magnetUntil = performance.now() + CONFIG.magnet.duration;
      Particles.addFloatingText('MAGNET!', player.x, player.y - 50, '#00d2d3');
    } else {
      GameState.shieldActive = true;
      Particles.addFloatingText('SHIELD UP!', player.x, player.y - 50, '#ffd700');
    }
  },

  _update(dt) {
    if (GameState.state !== CONST.PLAYING) return;

    ScreenShake.update(dt);
    GameState.roadOffset = (GameState.roadOffset + GameState.gameSpeed * dt) % CONFIG.roadDashLength;
    GameState.coinSpinAngle += 3 * dt;

    GameState.distancePixelAcc += GameState.gameSpeed * dt;
    if (GameState.distancePixelAcc >= 40) {
      const addedMeters = Math.floor(GameState.distancePixelAcc / 40);
      GameState.score += addedMeters;
      GameState.distancePixelAcc %= 40;
      dom.scoreEl.textContent = GameState.score;
    }

    if (Math.random() < 0.6) Particles.addExhaust(player.x, player.y);
    World.updateRoadside(dt);

    const targetX = CONFIG.lanes[player.currentLane];
    player.x += (targetX - player.x) * Math.min(1, player.slideSpeed * dt);

    if (GameState.modeIndex === 3) {
      const milestone = Math.floor(GameState.score / 100);
      if (milestone > GameState.speedMilestone) {
        GameState.speedMilestone = milestone;
        Particles.addFloatingText('SPEED UP!', player.x, player.y - 60, '#ff4757');
        AudioEngine.play('shift');
      }
      GameState.gameSpeed = 280 + GameState.speedMilestone * 35;

      if (GameState.combo > 0) {
        GameState.comboTimer -= dt;
        if (GameState.comboTimer <= 0) GameState.combo = 0;
      }

      const envIdx = Math.floor(GameState.score / CONFIG.environmentDistance) % CONFIG.environments.length;
      if (envIdx !== GameState.environmentIndex) {
        GameState.environmentIndex = envIdx;
        const env = CONFIG.environments[envIdx];
        Particles.addFloatingText(env.label.toUpperCase(), 180, 300, '#ffda79');
      }

      ScreenManager.updateLimitlessHud();
    }

    if (!GameState.finishLineSpawned && GameState.score >= CONFIG.modes[GameState.modeIndex].targetScore) {
      this._triggerFinishLine();
    }

    if (GameState.finishLineSpawned) {
      GameState.finishLineY += GameState.gameSpeed * dt;
      if (player.y <= GameState.finishLineY + 30) {
        AudioEngine.play('win');
        Particles.spawnConfetti(180, GameState.finishLineY + 20);
        this._endRound('DELIVERY SUCCESSFUL! 📦🎉', true);
        return;
      }
    }

    const crashReason = World.updateAndCollide(dt);
    if (crashReason) { this._handleCrash(crashReason); return; }

    Particles.update(dt);
    World.spawnEntities(dt);
  },

  _render() {
    ctx.clearRect(0, 0, 360, 640);
    ctx.save();
    ScreenShake.applyTo(ctx);

    drawRoad();
    World.render();
    Particles.renderBackLayer(ctx);

    if (GameState.state === CONST.PLAYING || GameState.state === CONST.RESPAWN_PROMPT) {
      drawPlayerVehicle(ctx, player.x, player.y);
      drawPowerupAura(performance.now());
    }

    Particles.renderFrontLayer(ctx);
    drawSpeedLines();

    ctx.restore();
  },

  _loop(now) {
    let dt = (now - GameState.lastFrameTime) / 1000;
    GameState.lastFrameTime = now;
    if (dt > CONFIG.maxDeltaTime) dt = CONFIG.maxDeltaTime;

    this._update(dt);
    this._render();

    const stillAnimating = GameState.state === CONST.PLAYING || Particles.confetti.length > 0;
    if (stillAnimating) {
      GameState.rafId = requestAnimationFrame(this._loopBound);
    }
  },
};

/* ------------------------------------------------------------------------ *
 * Bootstrap
 * ------------------------------------------------------------------------ */

InputManager.setup();
Game.init();
resizeCanvases();
World.initRoadsideProps();
Game.applyVehicleStats();
ScreenManager.updateModeLabel();
ScreenManager.updateBestDistance();
ctx.clearRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);
drawRoad();
