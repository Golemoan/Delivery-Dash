const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const scoreEl = document.getElementById('score');
const coinsEl = document.getElementById('coins');
const timerEl = document.getElementById('timer');
const timerContainer = document.getElementById('timer-container');
const startScreen = document.getElementById('start-screen');
const respawnScreen = document.getElementById('respawn-screen');
const respawnReason = document.getElementById('respawn-reason');
const useRespawnBtn = document.getElementById('useRespawnBtn');
const skipRespawnBtn = document.getElementById('skipRespawnBtn');
const gameOverScreen = document.getElementById('game-over-screen');
const crashReason = document.getElementById('crash-reason');
const finalScoreEl = document.getElementById('final-score');
const finalCoinsEl = document.getElementById('final-coins');
const endTimeEl = document.getElementById('end-time');
const endDifficultyEl = document.getElementById('end-difficulty');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const menuBtn = document.getElementById('menuBtn');
const modeTitle = document.getElementById('modeTitle');
const prevModeBtn = document.getElementById('prevModeBtn');
const nextModeBtn = document.getElementById('nextModeBtn');
const vehicleTitle = document.getElementById('vehicleTitle');
const prevVehicleBtn = document.getElementById('prevVehicleBtn');
const nextVehicleBtn = document.getElementById('nextVehicleBtn');

let audioCtx = null;
let bgMusicTimer = null;
let musicTempo = 1.0;

const VEHICLES = [
  { id: 'scooter', label: 'Delivery Scooter', width: 44, height: 84, slideSpeed: 16 },
  { id: 'skater', label: 'Skater Boy', width: 40, height: 80, slideSpeed: 20 },
  { id: 'tuktuk', label: 'Auto Tuk-Tuk', width: 50, height: 90, slideSpeed: 13 }
];

let currentVehicleIndex = 0;

const MODES = [
  { id: 'easy', label: 'Newbie 😇', speed: 300, spawnInterval: 1.2, trafficSpeedMult: 0.35, ratioCar: 1.0, ratioPothole: 0.0, ratioAnimal: 0.0, targetScore: 250, timeLimit: 0 },
  { id: 'medium', label: 'King of road 😈', speed: 420, spawnInterval: 0.95, trafficSpeedMult: 0.45, ratioCar: 0.6, ratioPothole: 0.4, ratioAnimal: 0.0, targetScore: 350, timeLimit: 40 },
  { id: 'hard', label: 'Indian 👺', speed: 520, spawnInterval: 0.75, trafficSpeedMult: 0.55, ratioCar: 0.6, ratioPothole: 0.3, ratioAnimal: 0.1, targetScore: 550, timeLimit: 30 },
  { id: 'limitless', label: 'Limitless ♾️', speed: 280, spawnInterval: 0.7, trafficSpeedMult: 0.5, ratioCar: 0.6, ratioPothole: 0.3, ratioAnimal: 0.1, targetScore: Infinity, timeLimit: 0 }
];

let currentModeIndex = 0;

let gameSpeed = 300;
let score = 0;
let coinsCollected = 0;
let gameOver = false;
let gameStarted = false;
let roadOffset = 0;
let animationFrameId;
let coinSpinAngle = 0;
let spawnTimer = 0;

let gameStartTime = 0;
let totalTimeTakenSec = 0;
let lastFrameTime = performance.now();

let remainingTime = 0;
let timerInterval = null;

let finishLineY = -200;
let finishLineSpawned = false;

// Limitless Mode State Variables
let distancePixelAcc = 0;
let baseLimitlessSpeed = 280;
let currentSpeedMilestone = 0;

// Respawn State
let pendingCrashReason = '';

// Visual Juice Polish Mechanics
let shakeDuration = 0;
let shakeIntensity = 0;
let visualParticles = [];
let floatingTexts = [];
let lastHornTime = 0;

// Party Popper System
let confettiParticles = [];
const CONFETTI_COLORS = ['#ff4757', '#ffa502', '#2ed573', '#1e90ff', '#e056fd', '#ffda79', '#7d5fff', '#00d2d3'];
let roadsideProps = [];

function triggerScreenShake(intensity = 6, duration = 0.2) {
  shakeIntensity = intensity;
  shakeDuration = duration;
}

function addExhaustParticle(x, y) {
  visualParticles.push({
    x: x + (Math.random() - 0.5) * 6,
    y: y + 36,
    vx: (Math.random() - 0.5) * 15,
    vy: Math.random() * 40 + 60,
    size: Math.random() * 4 + 3,
    color: 'rgba(200, 200, 200, 0.5)',
    life: 0.4
  });
}

function addDriftSparks(x, y, direction) {
  for (let i = 0; i < 4; i++) {
    visualParticles.push({
      x: x + (direction * 12),
      y: y + 20,
      vx: direction * (Math.random() * 80 + 40),
      vy: Math.random() * 50 - 25,
      size: Math.random() * 3 + 2,
      color: Math.random() < 0.5 ? '#00d2d3' : '#ffd700',
      life: 0.25
    });
  }
}

function addFloatingText(text, x, y, color = '#ffd700') {
  floatingTexts.push({ text: text, x: x, y: y, vy: -50, life: 0.8, color: color });
}

function initRoadsideProps() {
  roadsideProps = [];
  for (let y = -100; y < 700; y += 75) {
    roadsideProps.push({
      y: y,
      leftType: Math.random() < 0.5 ? 'tree' : 'bush',
      rightType: Math.random() < 0.5 ? 'tree' : 'bush',
      leftScale: 0.8 + Math.random() * 0.4,
      rightScale: 0.8 + Math.random() * 0.4
    });
  }
}

function spawnPartyPopper() {
  confettiParticles = [];
  for (let i = 0; i < 140; i++) {
    const isStreamer = Math.random() < 0.18;
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 320 + 120;

    confettiParticles.push({
      x: 180 + (Math.random() - 0.5) * 40,
      y: finishLineY + 20,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 150,
      size: isStreamer ? Math.random() * 4 + 4 : Math.random() * 7 + 5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 12,
      isStreamer: isStreamer,
      length: isStreamer ? Math.random() * 40 + 30 : 0,
      waveFrequency: Math.random() * 0.1 + 0.05,
      waveOffset: Math.random() * Math.PI * 2,
      life: 1.0,
      decay: Math.random() * 0.25 + 0.25
    });
  }
}

const lanes = [70, 180, 290];

const player = {
  currentLane: 1,
  x: lanes[1],
  y: 430,
  width: 44,
  height: 84,
  slideSpeed: 16
};

let obstacles = [];
let coins = [];
let potholes = [];
let animals = [];

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr * (rect.width / 360), dpr * (rect.height / 640));
}

window.addEventListener('resize', resizeCanvas);

function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playTone(freq, duration, type = 'sine', gainVal = 0.1) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.start(); osc.stop(audioCtx.currentTime + duration);
}

function playSound(type) {
  if (!audioCtx) return;

  if (type === 'click') {
    playTone(600, 0.04, 'sine', 0.12);
  }
  else if (type === 'select_ride') {
    playTone(440, 0.05, 'square', 0.08);
    setTimeout(() => playTone(880, 0.08, 'triangle', 0.1), 40);
  }
  else if (type === 'rev_engine') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    let now = audioCtx.currentTime;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.35);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.6);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.start(now); osc.stop(now + 0.6);
  }
  else if (type === 'tick') {
    playTone(900, 0.03, 'sine', 0.15);
  }
  else if (type === 'horn') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc.start(); osc.stop(audioCtx.currentTime + 0.25);
  }
  else if (type === 'near_miss') {
    playTone(880, 0.08, 'sine', 0.12);
    setTimeout(() => playTone(1200, 0.1, 'triangle', 0.15), 60);
  }
  else if (type === 'coin') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(987.77, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1318.51, audioCtx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
    osc.start(); osc.stop(audioCtx.currentTime + 0.12);
  } 
  else if (type === 'crash') {
    const bufferSize = audioCtx.sampleRate * 0.4;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, audioCtx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.4);

    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.8, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);

    noise.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
    noise.start(); noise.stop(audioCtx.currentTime + 0.4);
  } 
  else if (type === 'pothole') {
    playTone(110, 0.25, 'triangle', 0.4);
  }
  else if (type === 'shift') {
    playTone(380, 0.04, 'sine', 0.08);
  }
  else if (type === 'moo') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    let now = audioCtx.currentTime;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.linearRampToValueAtTime(150, now + 0.2);
    osc.frequency.linearRampToValueAtTime(100, now + 0.5);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

    osc.start(now); osc.stop(now + 0.5);
  }
  else if (type === 'win') {
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      setTimeout(() => playTone(freq, 0.25, 'triangle', 0.2), idx * 100);
    });
  }
}

function startBgMusic() {
  if (bgMusicTimer) clearInterval(bgMusicTimer);
  if (!audioCtx) return;

  let step = 0;
  musicTempo = 1.0;

  const runMusicStep = () => {
    if (!gameStarted || gameOver) return;

    let speedRatio = musicTempo;

    if (currentModeIndex === 0) {
      const melody = [261.63, 329.63, 392.00, 523.25, 392.00, 329.63, 293.66, 349.23];
      const bass = [130.81, 130.81, 146.83, 164.81];
      playTone(melody[step % melody.length] * speedRatio, 0.16, 'sine', 0.035);
      if (step % 2 === 0) playTone(bass[(step / 2) % bass.length] * speedRatio, 0.22, 'triangle', 0.04);
    } 
    else if (currentModeIndex === 1) {
      const lead = [440.00, 440.00, 523.25, 587.33, 440.00, 659.25, 587.33, 523.25];
      const bassline = [110.00, 110.00, 130.81, 146.83];
      playTone(lead[step % lead.length] * speedRatio, 0.12, 'sawtooth', 0.025);
      if (step % 2 === 1) playTone(bassline[(Math.floor(step / 2)) % bassline.length] * speedRatio, 0.18, 'square', 0.03);
    } 
    else {
      const fastMelody = [587.33, 659.25, 698.46, 783.99, 880.00, 783.99, 698.46, 659.25];
      const subBass = [73.42, 82.41, 87.31, 98.00];
      playTone(fastMelody[step % fastMelody.length] * speedRatio, 0.08, 'square', 0.025);
      if (step % 4 === 0) playTone(subBass[(step / 4) % subBass.length] * speedRatio, 0.25, 'sawtooth', 0.05);
    }
    step++;
  };

  let baseInterval = currentModeIndex === 0 ? 250 : (currentModeIndex === 1 ? 180 : 115);
  bgMusicTimer = setInterval(runMusicStep, baseInterval / musicTempo);
}

function stopBgMusic() {
  if (bgMusicTimer) clearInterval(bgMusicTimer);
}

function drawHeadlightCone(c, width, length) {
  let lightGrad = c.createLinearGradient(0, -10, 0, -length);
  lightGrad.addColorStop(0, 'rgba(255, 235, 150, 0.45)');
  lightGrad.addColorStop(0.3, 'rgba(255, 220, 100, 0.2)');
  lightGrad.addColorStop(1, 'rgba(255, 220, 100, 0)');

  c.fillStyle = lightGrad;
  c.beginPath();
  c.moveTo(-8, -10);
  c.lineTo(-width / 2, -length);
  c.lineTo(width / 2, -length);
  c.lineTo(8, -10);
  c.closePath();
  c.fill();
}

function drawScooter(c, x, y, width, height) {
  c.save();
  c.translate(x, y);

  drawHeadlightCone(c, 130, 220);

  c.fillStyle = 'rgba(0, 0, 0, 0.35)';
  c.beginPath();
  c.ellipse(0, 8, 20, 36, 0, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#1c1d21';
  c.fillRect(-5, -36, 10, 14);
  c.fillRect(-6, 26, 12, 14);

  c.fillStyle = '#2b2d35';
  c.beginPath();
  c.roundRect(-15, -28, 30, 56, 6);
  c.fill();

  c.fillStyle = '#1a1a1a';
  c.fillRect(-28, -20, 56, 5);

  c.fillStyle = '#222';
  c.fillRect(-30, -22, 6, 8);
  c.fillStyle = '#e74c3c';
  c.fillRect(-32, -22, 4, 8);

  c.fillStyle = '#222';
  c.fillRect(24, -22, 6, 8);
  c.fillStyle = '#e74c3c';
  c.fillRect(28, -22, 4, 8);

  c.fillStyle = '#d32f2f';
  c.beginPath();
  c.roundRect(-19, 5, 38, 28, 4);
  c.fill();

  c.fillStyle = '#ef5350';
  c.beginPath();
  c.roundRect(-17, 7, 34, 24, 3);
  c.fill();

  c.fillStyle = '#ffffff';
  c.beginPath();
  c.roundRect(-10, 13, 20, 12, 2);
  c.fill();

  c.fillStyle = '#1976d2';
  c.fillRect(-6, 16, 12, 6);

  c.fillStyle = '#e65100';
  c.beginPath();
  c.roundRect(-14, -15, 28, 26, 6);
  c.fill();

  c.fillStyle = '#f57c00';
  c.beginPath();
  c.roundRect(-13, -15, 26, 22, 5);
  c.fill();

  c.fillStyle = '#f57c00';
  c.beginPath();
  c.moveTo(-12, -8); c.lineTo(-24, -18); c.lineTo(-19, -21); c.lineTo(-8, -12);
  c.closePath(); c.fill();

  c.beginPath();
  c.moveTo(12, -8); c.lineTo(24, -18); c.lineTo(19, -21); c.lineTo(8, -12);
  c.closePath(); c.fill();

  c.fillStyle = '#111111';
  c.beginPath();
  c.arc(0, -6, 12, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#ff9800';
  c.beginPath();
  c.arc(0, -7, 10.5, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#fb8c00';
  c.fillRect(-3, -16, 6, 12);

  c.fillStyle = '#1a1a1a';
  c.fillRect(-8, -15, 16, 4);

  c.fillStyle = '#ff1744';
  c.fillRect(-10, 31, 20, 3);

  c.restore();
}

function drawSkater(c, x, y, width, height) {
  c.save();
  c.translate(x, y);

  drawHeadlightCone(c, 110, 180);

  c.fillStyle = 'rgba(0, 0, 0, 0.4)';
  c.beginPath();
  c.ellipse(0, 6, 16, 38, 0, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#0072ce';
  c.beginPath();
  c.roundRect(-12, -36, 24, 72, 10);
  c.fill();

  c.fillStyle = '#181b20';
  c.beginPath();
  c.roundRect(-10, -34, 20, 68, 8);
  c.fill();

  c.fillStyle = '#242424';
  c.fillRect(-15, -28, 4, 10);
  c.fillRect(11, -28, 4, 10);
  c.fillRect(-15, 18, 4, 10);
  c.fillRect(11, 18, 4, 10);

  c.fillStyle = '#ffffff';
  c.beginPath();
  c.ellipse(-2, -18, 4, 8, -Math.PI / 12, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(1, 14, 4, 8, Math.PI / 8, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#111';
  c.beginPath();
  c.ellipse(-2, -18, 3, 6, -Math.PI / 12, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(1, 14, 3, 6, Math.PI / 8, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#ffb380';
  c.beginPath();
  c.ellipse(-14, -8, 4, 10, -Math.PI / 4, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(14, -3, 4, 10, Math.PI / 4, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#0072ce';
  c.beginPath();
  c.arc(-11, -12, 5, 0, Math.PI * 2);
  c.arc(11, -10, 5, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#0066c4';
  c.beginPath();
  c.roundRect(-16, -10, 32, 30, 6);
  c.fill();

  c.fillStyle = '#0072ce';
  c.beginPath();
  c.roundRect(-14, -8, 28, 26, 4);
  c.fill();

  c.save();
  c.translate(0, 5);
  c.rotate(-Math.PI / 4);

  c.fillStyle = '#ffffff';
  c.fillRect(-9, -9, 18, 18);

  c.fillStyle = '#0066c4';
  c.fillRect(-8, -8, 7, 16);

  c.fillStyle = '#e31837';
  c.fillRect(1, -8, 7, 16);

  c.restore();

  c.fillStyle = '#1f242d';
  c.fillRect(-12, -18, 4, 10);
  c.fillRect(8, -18, 4, 10);

  c.fillStyle = '#004c8c';
  c.beginPath();
  c.arc(0, -20, 15, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#0072ce';
  c.beginPath();
  c.arc(0, -21, 13.5, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#3399ff';
  c.beginPath();
  c.ellipse(0, -21, 3, 11, 0, 0, Math.PI * 2);
  c.fill();

  c.restore();
}

function drawTukTuk(c, x, y, width, height) {
  c.save();
  c.translate(x, y);

  drawHeadlightCone(c, 160, 240);

  c.fillStyle = 'rgba(0, 0, 0, 0.4)';
  c.beginPath();
  c.ellipse(0, 4, 25, 42, 0, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#1e272e';
  c.fillRect(-24, 18, 6, 16);
  c.fillRect(18, 18, 6, 16);

  c.fillRect(-4, -42, 8, 12);
  c.fillStyle = '#27ae60';
  c.fillRect(-6, -40, 12, 8);

  c.fillStyle = '#f1c40f';
  c.beginPath();
  c.roundRect(-22, -10, 44, 48, 6);
  c.fill();

  c.fillStyle = '#27ae60';
  c.beginPath();
  c.roundRect(-18, -36, 36, 28, 8);
  c.fill();

  c.fillStyle = '#2c3e50';
  c.beginPath();
  c.roundRect(-17, -22, 34, 38, 5);
  c.fill();

  c.fillStyle = '#74b9ff';
  c.beginPath();
  c.roundRect(-14, -33, 28, 10, 3);
  c.fill();

  c.fillStyle = '#fff200';
  c.beginPath();
  c.arc(-11, -34, 3, 0, Math.PI * 2);
  c.arc(11, -34, 3, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#e67e22';
  c.fillRect(-17, -30, 3, 4);
  c.fillRect(14, -30, 3, 4);

  c.fillStyle = '#2d3436';
  c.fillRect(-23, -28, 5, 3);
  c.fillRect(18, -28, 5, 3);

  c.fillStyle = '#ff3838';
  c.fillRect(-18, 35, 8, 3);
  c.fillRect(10, 35, 8, 3);

  c.restore();
}

function drawPlayerVehicle(c, x, y, width, height) {
  const type = VEHICLES[currentVehicleIndex].id;
  if (type === 'scooter') drawScooter(c, x, y, width, height);
  else if (type === 'skater') drawSkater(c, x, y, width, height);
  else if (type === 'tuktuk') drawTukTuk(c, x, y, width, height);
}

function drawCar(c, x, y, width, height, model, isReversing) {
  c.save();
  c.translate(x, y);
  if (isReversing) c.rotate(Math.PI);

  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(-width / 2 + 2, -height / 2 + 4, width, height);

  c.fillStyle = model.color;
  c.beginPath();
  c.roundRect(-width / 2, -height / 2, width, height, 10);
  c.fill();

  c.fillStyle = model.color;
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
  c.closePath();
  c.fill();

  if (model.type === 'taxi') {
    c.fillStyle = '#f1c40f';
    c.fillRect(-8, -2, 16, 5);
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
  c.save();
  c.translate(x, y);

  c.fillStyle = 'rgba(0,0,0,0.4)';
  c.fillRect(-width / 2 + 3, -height / 2 + 5, width, height);

  c.fillStyle = '#1a1a1a';
  c.fillRect(-width / 2 - 2, -height / 2 + 20, 3, 14);
  c.fillRect(width / 2 - 1, -height / 2 + 20, 3, 14);
  c.fillRect(-width / 2 - 2, height / 2 - 40, 3, 16);
  c.fillRect(width / 2 - 1, height / 2 - 40, 3, 16);

  c.fillStyle = '#f0eee6';
  c.beginPath();
  c.roundRect(-width / 2 + 1, -height / 2 + 45, width - 2, 100, 4);
  c.fill();
  c.lineWidth = 1.5;
  c.strokeStyle = '#b0ad9e';
  c.stroke();

  c.fillStyle = '#222';
  c.fillRect(-width / 2 - 4, -height / 2 + 25, 4, 8);
  c.fillRect(width / 2, -height / 2 + 25, 4, 8);

  c.fillStyle = '#ff6b00';
  c.beginPath();
  c.roundRect(-width / 2, -height / 2, width, 48, 8);
  c.fill();

  c.fillStyle = '#e05a00';
  c.beginPath();
  c.roundRect(-width / 2 + 5, -height / 2 + 15, width - 10, 26, 4);
  c.fill();

  c.fillStyle = '#2c3e50';
  c.beginPath();
  c.roundRect(-width / 2 + 4, -height / 2 + 6, width - 8, 12, 3);
  c.fill();

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
  ctx.save();
  ctx.translate(hole.x, hole.y);

  ctx.fillStyle = '#171717';
  ctx.beginPath();
  let pts = hole.points;
  ctx.moveTo(pts[0].x * 1.25, pts[0].y * 1.25);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * 1.25, pts[i].y * 1.25);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#080808';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawCow(cow) {
  ctx.save();
  ctx.translate(cow.x, cow.y);

  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-18, -10, 38, 26);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-18, -12, 36, 24);

  ctx.fillStyle = '#2d3436';
  ctx.fillRect(-14, -10, 10, 8);
  ctx.fillRect(4, 2, 10, 8);
  ctx.fillRect(-2, 0, 8, 8);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(14, -14, 12, 14);
  ctx.fillStyle = '#ff7675';
  ctx.fillRect(20, -8, 8, 8);

  ctx.fillStyle = '#ffeaa7';
  ctx.fillRect(14, -18, 4, 4);

  ctx.restore();
}

function drawFinishLine() {
  if (!finishLineSpawned) return;

  ctx.save();
  ctx.translate(20, finishLineY);

  const rows = 2;
  const cols = 16;
  const squareSize = 20;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#000000';
      ctx.fillRect(c * squareSize, r * squareSize, squareSize, squareSize);
    }
  }

  ctx.restore();
}

function drawTree(c, x, y, scale) {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);

  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath();
  c.ellipse(0, 4, 12, 6, 0, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#5d4037';
  c.fillRect(-3, -6, 6, 12);

  c.fillStyle = '#1e824c';
  c.beginPath();
  c.arc(0, -18, 14, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#26af61';
  c.beginPath();
  c.arc(-4, -20, 10, 0, Math.PI * 2);
  c.arc(5, -16, 9, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#2ecc71';
  c.beginPath();
  c.arc(-2, -22, 6, 0, Math.PI * 2);
  c.fill();

  c.restore();
}

function drawBush(c, x, y, scale) {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);

  c.fillStyle = 'rgba(0,0,0,0.2)';
  c.beginPath();
  c.ellipse(0, 2, 10, 4, 0, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#1b5e20';
  c.beginPath();
  c.arc(-5, 0, 8, 0, Math.PI * 2);
  c.arc(4, 0, 9, 0, Math.PI * 2);
  c.arc(0, -5, 8, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = '#2e7d32';
  c.beginPath();
  c.arc(-3, -2, 6, 0, Math.PI * 2);
  c.arc(2, -3, 6, 0, Math.PI * 2);
  c.fill();

  c.restore();
}

function drawRoad() {
  ctx.fillStyle = '#27ae60';
  ctx.fillRect(0, 0, 20, 640);
  ctx.fillRect(340, 0, 20, 640);

  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(20, 0, 320, 640);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(20, 0, 6, 640);
  ctx.fillRect(334, 0, 6, 640);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.setLineDash([20, 20]);
  ctx.lineDashOffset = -roadOffset;

  ctx.beginPath();
  ctx.moveTo(125, 0); ctx.lineTo(125, 640);
  ctx.moveTo(235, 0); ctx.lineTo(235, 640);
  ctx.stroke();
  ctx.setLineDash([]);

  roadsideProps.forEach(prop => {
    if (prop.leftType === 'tree') drawTree(ctx, 10, prop.y, prop.leftScale);
    else drawBush(ctx, 10, prop.y, prop.leftScale);

    if (prop.rightType === 'tree') drawTree(ctx, 350, prop.y, prop.rightScale);
    else drawBush(ctx, 350, prop.y, prop.rightScale);
  });

  drawFinishLine();
}

function drawCoin(coin) {
  ctx.save();
  ctx.translate(coin.x, coin.y);

  let scaleX = Math.cos(coinSpinAngle);
  ctx.scale(scaleX, 1);
  ctx.beginPath();
  ctx.arc(0, 0, coin.radius, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd700';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#e67e22';
  ctx.stroke();

  ctx.restore();
}

function spawnPotholeCoinTrap(laneX, potholeY) {
  if (Math.random() < 0.35) {
    for (let i = 1; i <= 3; i++) {
      coins.push({
        x: laneX,
        y: potholeY + (i * 38),
        radius: 12
      });
    }
  }
}

function spawnEntities(dt) {
  if (finishLineSpawned) return;

  let cfg = MODES[currentModeIndex];
  if (currentModeIndex === 3) {
    cfg = {
      ...cfg,
      ratioCar: 0.6,
      ratioPothole: 0.3,
      ratioAnimal: 0.1
    };
  }

  spawnTimer += dt;

  if (spawnTimer >= cfg.spawnInterval) {
    spawnTimer = 0;

    const isTruckNext = Math.random() < 0.3; 
    const requiredGap = isTruckNext ? 280 : 200; 

    let laneBlocked = [false, false, false];

    lanes.forEach((laneX, idx) => {
      const carNearTop = obstacles.some(o => o.x === laneX && o.y < requiredGap);
      const potholeNearTop = potholes.some(p => p.x === laneX && p.y < requiredGap);
      
      if (carNearTop || potholeNearTop) {
        laneBlocked[idx] = true;
      }
    });

    let availableLanes = [];
    for (let i = 0; i < 3; i++) {
      if (!laneBlocked[i]) availableLanes.push(i);
    }

    let totalUpperBlocked = 0;
    for (let i = 0; i < 3; i++) {
      let hasObstacle = obstacles.some(o => o.x === lanes[i] && o.y < 260) ||
                        potholes.some(p => p.x === lanes[i] && p.y < 260);
      if (hasObstacle) totalUpperBlocked++;
    }

    if (totalUpperBlocked >= 2) availableLanes = [];

    if (availableLanes.length > 0) {
      let chosenLaneIdx = availableLanes[Math.floor(Math.random() * availableLanes.length)];
      let laneX = lanes[chosenLaneIdx];
      let roll = Math.random();

      if (roll < cfg.ratioCar) {
        if (isTruckNext) {
          obstacles.push({
            x: laneX,
            y: -160,
            width: 44,
            height: 150,
            speed: gameSpeed * cfg.trafficSpeedMult * 0.9,
            isTruck: true,
            isReversing: false,
            nearMissed: false
          });
        } else {
          const cars = [
            { color: '#e74c3c', type: 'sport' },
            { color: '#f1c40f', type: 'taxi' },
            { color: '#3498db', type: 'sport' },
            { color: '#2c3e50', type: 'police' }
          ];
          let chosen = cars[Math.floor(Math.random() * cars.length)];

          let isReversing = (currentModeIndex >= 2) && (Math.random() < 0.35);
          let speed = gameSpeed * cfg.trafficSpeedMult;
          if (isReversing) speed = gameSpeed * 1.05;

          obstacles.push({
            x: laneX,
            y: -100,
            width: 42,
            height: 75,
            speed: speed,
            model: chosen,
            isTruck: false,
            isReversing: isReversing,
            nearMissed: false
          });
        }

      } else if (roll < cfg.ratioCar + cfg.ratioPothole) {
        let pY = -80;
        potholes.push({
          x: laneX,
          y: pY,
          radius: 26,
          points: generateCrackedPolygon(26)
        });

        spawnPotholeCoinTrap(laneX, pY);

      } else if (roll < cfg.ratioCar + cfg.ratioPothole + cfg.ratioAnimal) {
        let startFromLeft = Math.random() < 0.5;
        animals.push({
          x: startFromLeft ? 30 : 330,
          y: -80,
          targetVx: startFromLeft ? 140 : -140,
          moving: false,
          mooed: false
        });
      }
    }
  }

  if (Math.random() < 0.03) {
    let coinLane = lanes[Math.floor(Math.random() * 3)];
    let isOccupied = obstacles.some(o => o.x === coinLane && o.y < 50) || 
                     potholes.some(p => p.x === coinLane && p.y < 50);
    if (!isOccupied) {
      coins.push({ x: coinLane, y: -50, radius: 12 });
    }
  }
}

function generateCrackedPolygon(radius) {
  let points = [];
  let numPoints = 8;
  for (let i = 0; i < numPoints; i++) {
    let angle = (i / numPoints) * Math.PI * 2;
    let r = radius * (0.7 + Math.random() * 0.5);
    points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * (r * 0.7) });
  }
  return points;
}

function shiftLeft() {
  if (!gameStarted || gameOver) return;
  if (player.currentLane > 0) {
    player.currentLane--;
    playSound('shift');
    addDriftSparks(player.x, player.y, -1);
  }
}

function shiftRight() {
  if (!gameStarted || gameOver) return;
  if (player.currentLane < lanes.length - 1) {
    player.currentLane++;
    playSound('shift');
    addDriftSparks(player.x, player.y, 1);
  }
}

function updateModeDisplay() {
  modeTitle.innerText = MODES[currentModeIndex].label;
}

function updateVehicleDisplay() {
  const v = VEHICLES[currentVehicleIndex];
  vehicleTitle.innerText = v.label;
  player.width = v.width;
  player.height = v.height;
  player.slideSpeed = v.slideSpeed;
  renderVehiclePreview();
}

function handleCrash(reason) {
  if (coinsCollected >= 50) {
    pendingCrashReason = reason;
    gameOver = true;
    stopBgMusic();
    respawnReason.innerText = reason;
    respawnScreen.classList.remove('hidden');
  } else {
    triggerGameOver(reason);
  }
}

function performRespawn() {
  coinsCollected -= 50;
  coinsEl.innerText = coinsCollected;
  
  respawnScreen.classList.add('hidden');
  gameOver = false;
  
  obstacles = obstacles.filter(o => Math.abs(o.y - player.y) > 220);
  potholes = potholes.filter(p => Math.abs(p.y - player.y) > 220);
  animals = animals.filter(a => Math.abs(a.y - player.y) > 220);
  
  playSound('rev_engine');
  startBgMusic();
  lastFrameTime = performance.now();
  requestAnimationFrame(gameLoop);
}

function setupControls() {
  const leftBtn = document.getElementById('leftBtn');
  const rightBtn = document.getElementById('rightBtn');

  const handleLeft = (e) => { e.preventDefault(); shiftLeft(); };
  const handleRight = (e) => { e.preventDefault(); shiftRight(); };

  leftBtn.addEventListener('pointerdown', handleLeft);
  rightBtn.addEventListener('pointerdown', handleRight);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') shiftLeft();
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') shiftRight();
  });

  prevModeBtn.addEventListener('click', () => {
    playSound('click');
    currentModeIndex = (currentModeIndex - 1 + MODES.length) % MODES.length;
    updateModeDisplay();
  });

  nextModeBtn.addEventListener('click', () => {
    playSound('click');
    currentModeIndex = (currentModeIndex + 1) % MODES.length;
    updateModeDisplay();
  });

  prevVehicleBtn.addEventListener('click', () => {
    playSound('select_ride');
    currentVehicleIndex = (currentVehicleIndex - 1 + VEHICLES.length) % VEHICLES.length;
    updateVehicleDisplay();
  });

  nextVehicleBtn.addEventListener('click', () => {
    playSound('select_ride');
    currentVehicleIndex = (currentVehicleIndex + 1) % VEHICLES.length;
    updateVehicleDisplay();
  });

  startBtn.addEventListener('click', () => {
    initAudio();
    playSound('rev_engine');
    startScreen.classList.add('hidden');
    gameStarted = true;
    resetGame();
  });

  restartBtn.addEventListener('click', () => {
    playSound('rev_engine');
    resetGame();
  });

  menuBtn.addEventListener('click', () => {
    playSound('click');
    gameOverScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
    gameStarted = false;
    stopBgMusic();
    if (timerInterval) clearInterval(timerInterval);
    cancelAnimationFrame(animationFrameId);
  });

  useRespawnBtn.addEventListener('click', () => {
    playSound('click');
    performRespawn();
  });

  skipRespawnBtn.addEventListener('click', () => {
    playSound('click');
    respawnScreen.classList.add('hidden');
    triggerGameOver(pendingCrashReason);
  });
}

function renderVehiclePreview() {
  const pCanvas = document.getElementById('scooter-preview');
  const pCtx = pCanvas.getContext('2d');
  pCtx.clearRect(0, 0, 110, 140);
  
  const v = VEHICLES[currentVehicleIndex];
  drawPlayerVehicle(pCtx, 55, 70, v.width, v.height);
}

function updateTimer() {
  const currentCfg = MODES[currentModeIndex];
  if (currentCfg.timeLimit > 0) {
    timerContainer.classList.remove('hidden');
    remainingTime = currentCfg.timeLimit;
    timerEl.innerText = remainingTime;

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (gameOver || !gameStarted) return;
      remainingTime--;
      timerEl.innerText = remainingTime;

      if (remainingTime <= 10 && remainingTime > 0) {
        playSound('tick');
        musicTempo = 1.25;
      }

      if (currentModeIndex === 2) gameSpeed += 5;

      if (remainingTime <= 0) {
        clearInterval(timerInterval);
        if (!finishLineSpawned) triggerFinishLine();
      }
    }, 1000);
  } else {
    timerContainer.classList.add('hidden');
  }
}

function triggerFinishLine() {
  finishLineSpawned = true;
  finishLineY = -100;
}

function formatTime(seconds) {
  let mins = Math.floor(seconds / 60);
  let secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function drawDayNightOverlay() {
  if (currentModeIndex !== 3) return;

  const cycleIndex = Math.floor(score / 100) % 2;

  if (cycleIndex === 1) {
    ctx.save();
    ctx.fillStyle = 'rgba(10, 15, 40, 0.55)';
    ctx.fillRect(0, 0, 360, 640);
    ctx.restore();
  }
}

function update(dt) {
  if (gameOver || !gameStarted) return;

  if (shakeDuration > 0) {
    shakeDuration -= dt;
  }

  roadOffset = (roadOffset + gameSpeed * dt) % 40;
  coinSpinAngle += 3 * dt;

  distancePixelAcc += gameSpeed * dt;
  if (distancePixelAcc >= 40) {
    let addedMeters = Math.floor(distancePixelAcc / 40);
    score += addedMeters;
    distancePixelAcc %= 40;
    scoreEl.innerText = score;
  }

  if (Math.random() < 0.6) addExhaustParticle(player.x, player.y);

  roadsideProps.forEach(prop => {
    prop.y += gameSpeed * dt;
    if (prop.y > 670) {
      prop.y -= 770;
      prop.leftType = Math.random() < 0.5 ? 'tree' : 'bush';
      prop.rightType = Math.random() < 0.5 ? 'tree' : 'bush';
    }
  });

  let targetX = lanes[player.currentLane];
  player.x += (targetX - player.x) * Math.min(1, player.slideSpeed * dt);

  if (currentModeIndex === 3) {
    const milestone = Math.floor(score / 100);
    if (milestone > currentSpeedMilestone) {
      currentSpeedMilestone = milestone;
      addFloatingText('SPEED UP!', player.x, player.y - 60, '#ff4757');
      playSound('shift');
    }
    gameSpeed = baseLimitlessSpeed + currentSpeedMilestone * 35;
  }

  if (!finishLineSpawned && score >= MODES[currentModeIndex].targetScore) {
    triggerFinishLine();
  }

  if (finishLineSpawned) {
    finishLineY += gameSpeed * dt;
    if (player.y <= finishLineY + 30) {
      playSound('win');
      spawnPartyPopper();
      triggerGameOver('DELIVERY SUCCESSFUL! 📦🎉', true);
    }
  }

  let now = performance.now();
  for (let i = obstacles.length - 1; i >= 0; i--) {
    let obs = obstacles[i];
    obs.y += obs.speed * dt;

    let playerLaneX = lanes[player.currentLane];
    if (obs.x === playerLaneX && obs.y > 100 && obs.y < player.y - 80) {
      if (now - lastHornTime > 1800) {
        playSound('horn');
        lastHornTime = now;
      }
    }

    if (
      Math.abs(player.x - obs.x) < (player.width / 2 + obs.width / 2) - 6 &&
      Math.abs(player.y - obs.y) < (player.height / 2 + obs.height / 2) - 6
    ) {
      playSound('crash');
      triggerScreenShake(12, 0.4);
      handleCrash(obs.isTruck ? 'Crashed into Large Truck!' : 'Crashed into Traffic!');
      return;
    }

    if (!obs.nearMissed && Math.abs(player.y - obs.y) < (obs.height / 2 + 10) && Math.abs(player.x - obs.x) < 62 && Math.abs(player.x - obs.x) > 28) {
      obs.nearMissed = true;
      score += 5;
      scoreEl.innerText = score;
      playSound('near_miss');
      triggerScreenShake(4, 0.15);
      addFloatingText('NEAR MISS! +5m', player.x, player.y - 40, '#00d2d3');
    }

    if (obs.y > 640 + 150) {
      obstacles.splice(i, 1);
    }
  }

  for (let i = potholes.length - 1; i >= 0; i--) {
    let hole = potholes[i];
    hole.y += gameSpeed * dt;

    if (
      Math.abs(player.x - hole.x) < (player.width / 2 + hole.radius) - 10 &&
      Math.abs(player.y - hole.y) < (player.height / 2 + hole.radius) - 10
    ) {
      playSound('pothole');
      triggerScreenShake(8, 0.3);
      handleCrash('Slipped in Deep Pothole!');
      return;
    }

    if (hole.y > 640 + 80) potholes.splice(i, 1);
  }

  for (let i = animals.length - 1; i >= 0; i--) {
    let animal = animals[i];
    animal.y += gameSpeed * dt;

    let distY = player.y - animal.y;
    if (distY < 320) animal.moving = true;

    if (!animal.mooed && Math.abs(distY) < 60) {
      playSound('moo');
      animal.mooed = true;
    }

    if (animal.moving) animal.x += animal.targetVx * dt;

    if (
      Math.abs(player.x - animal.x) < (player.width / 2 + 16) &&
      Math.abs(player.y - animal.y) < (player.height / 2 + 12)
    ) {
      playSound('crash');
      triggerScreenShake(10, 0.35);
      handleCrash('Crashed into Stray Cow!');
      return;
    }

    if (animal.y > 640 + 80) animals.splice(i, 1);
  }

  for (let i = coins.length - 1; i >= 0; i--) {
    let coin = coins[i];
    coin.y += gameSpeed * dt;

    let dist = Math.hypot(player.x - coin.x, player.y - coin.y);
    if (dist < coin.radius + player.width / 2) {
      coinsCollected++;
      coinsEl.innerText = coinsCollected;
      score += 2;
      scoreEl.innerText = score;
      playSound('coin');
      addFloatingText('+2m', coin.x, coin.y, '#ffd700');
      coins.splice(i, 1);
      continue;
    }

    if (coin.y > 640 + 50) coins.splice(i, 1);
  }

  for (let i = visualParticles.length - 1; i >= 0; i--) {
    let p = visualParticles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) visualParticles.splice(i, 1);
  }

  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    let t = floatingTexts[i];
    t.y += t.vy * dt;
    t.life -= dt;
    if (t.life <= 0) floatingTexts.splice(i, 1);
  }

  spawnEntities(dt);
}

function render(dt) {
  ctx.clearRect(0, 0, 360, 640);

  ctx.save();
  if (shakeDuration > 0) {
    let rx = (Math.random() - 0.5) * shakeIntensity;
    let ry = (Math.random() - 0.5) * shakeIntensity;
    ctx.translate(rx, ry);
  }

  drawRoad();

  potholes.forEach(drawPothole);
  coins.forEach(drawCoin);
  animals.forEach(drawCow);

  obstacles.forEach(obs => {
    if (obs.isTruck) {
      drawTruck(ctx, obs.x, obs.y, obs.width, obs.height);
    } else {
      drawCar(ctx, obs.x, obs.y, obs.width, obs.height, obs.model, obs.isReversing);
    }
  });

  visualParticles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  if (gameStarted) {
    drawPlayerVehicle(ctx, player.x, player.y, player.width, player.height);
  }

  drawDayNightOverlay();

  floatingTexts.forEach(t => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, t.life);
    ctx.fillStyle = t.color;
    ctx.font = '900 14px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(t.text, t.x, t.y);
    ctx.restore();
  });

  updateAndDrawParticles(dt);

  ctx.restore();
}

function updateAndDrawParticles(dt) {
  for (let i = confettiParticles.length - 1; i >= 0; i--) {
    let p = confettiParticles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 220 * dt;
    p.vx *= 0.98;
    p.rotation += p.rotSpeed * dt;
    p.life -= p.decay * dt;

    if (p.life <= 0) {
      confettiParticles.splice(i, 1);
      continue;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.strokeStyle = p.color;

    if (p.isStreamer) {
      ctx.lineWidth = p.size;
      ctx.beginPath();
      for (let j = 0; j < p.length; j += 4) {
        let waveX = Math.sin(j * p.waveFrequency + p.waveOffset + p.rotation) * 8;
        let ptX = p.x + waveX;
        let ptY = p.y + j;
        if (j === 0) ctx.moveTo(ptX, ptY);
        else ctx.lineTo(ptX, ptY);
      }
      ctx.stroke();
    } else {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * (0.6 + Math.sin(p.rotation) * 0.4));
    }

    ctx.restore();
  }
}

function gameLoop(now) {
  let dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  if (dt > 0.1) dt = 0.1;

  update(dt);
  render(dt);

  if (!gameOver || confettiParticles.length > 0) {
    animationFrameId = requestAnimationFrame(gameLoop);
  }
}

function triggerGameOver(reason = 'Crashed!', isWin = false) {
  gameOver = true;
  totalTimeTakenSec = Math.floor((performance.now() - gameStartTime) / 1000);
  
  stopBgMusic();
  if (timerInterval) clearInterval(timerInterval);

  const crashTitle = document.getElementById('crash-title');
  crashTitle.innerText = isWin ? 'DELIVERY COMPLETED!' : 'DELIVERY FAILED!';
  crashTitle.style.color = isWin ? '#1dd1a1' : '#ff4757';

  crashReason.innerText = reason;
  finalScoreEl.innerText = `${score}m`;
  finalCoinsEl.innerText = coinsCollected;
  endTimeEl.innerText = formatTime(totalTimeTakenSec);
  endDifficultyEl.innerText = MODES[currentModeIndex].label;
  
  setTimeout(() => {
    gameOverScreen.classList.remove('hidden');
  }, isWin ? 600 : 0);
}

function resetGame() {
  gameOver = false;
  score = 0;
  coinsCollected = 0;
  distancePixelAcc = 0;
  currentSpeedMilestone = 0;
  gameSpeed = MODES[currentModeIndex].speed;
  spawnTimer = 0;
  finishLineY = -200;
  finishLineSpawned = false;
  gameStartTime = performance.now();
  confettiParticles = [];
  visualParticles = [];
  floatingTexts = [];
  shakeDuration = 0;
  musicTempo = 1.0;

  obstacles = [];
  coins = [];
  potholes = [];
  animals = [];
  player.currentLane = 1;
  player.x = lanes[1];

  const activeVehicle = VEHICLES[currentVehicleIndex];
  player.width = activeVehicle.width;
  player.height = activeVehicle.height;
  player.slideSpeed = activeVehicle.slideSpeed;

  scoreEl.innerText = '0';
  coinsEl.innerText = '0';

  initRoadsideProps();
  updateTimer();
  startBgMusic();

  respawnScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  cancelAnimationFrame(animationFrameId);
  lastFrameTime = performance.now();
  gameLoop(lastFrameTime);
}

setupControls();
resizeCanvas();
initRoadsideProps();
updateVehicleDisplay();
render(0);