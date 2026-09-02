import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RectAreaLightHelper } from 'three/addons/helpers/RectAreaLightHelper.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// reload on bfcache restore from the 2D site — avoids broken WebGL context
window.addEventListener('pageshow', (event) => {
  if (event.persisted && sessionStorage.getItem('reload3DOnReturn') === '1') {
    sessionStorage.removeItem('reload3DOnReturn');
    window.location.replace('/');
  }
});

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
RectAreaLightUniformsLib.init();

function makeLazyAudio(src, volume) {
  const a = new Audio();
  a.preload = 'none';
  a.src = src;
  if (volume != null) a.volume = volume;
  return a;
}
const clickSound  = makeLazyAudio('/on.wav', 0.3);
const ukeSound    = makeLazyAudio('/uke.wav', 0.5);
const ambientSound = makeLazyAudio('/ambience.mp3', 0.3);
const zoomIn      = makeLazyAudio('/whoosh.wav');
const zoomOut     = makeLazyAudio('/zoomout.wav');

function warmAudio() {
  setTimeout(() => {
    [clickSound, ukeSound, zoomIn, zoomOut].forEach((a) => {
      try { a.preload = 'auto'; a.load(); } catch (_) {}
    });
  }, 0);
}
// Scene + shared state
const scene = new THREE.Scene();
// Single source of truth for the sky, lerped by the day/night transition.
// 0x1d2a43 is not the colour you see: OutputPass runs ACES tone mapping at
// exposure 0.7 over the whole buffer, background included, so this lands on
// screen as ~#0a1530 — the same deep navy as the UI chrome. Pick a new value
// by what it looks like after that curve, not by the hex.
const skyColor = new THREE.Color(0x1d2a43);
scene.background = skyColor;
let isVideoPlaying = false;
let selectedObject = null;
let tvScreenMesh = null;
let tvVideo = null;
let videoReady = false;
let isFocusedOnBMO = false;
let bmoObject = null;
let mcbed = null;
let onFocusComplete = null;
// A flight into the 2D site is in progress (guards against starting it twice).
let screenOpening = false;
// The iframe exists. It is created ONCE and then kept alive for the whole
// visit — never torn down — so hovering out to the desk and back in returns
// you to the site exactly where you left it.
let screenMounted = false;
// Once the intro video has played through, later clicks go straight to the
// desktop instead of making people sit through it again.
let bmoVideoWatched = false;
// Set when BMO is clicked before the intro video has buffered. The 'canplay'
// handler drains it, so an early click starts the video the moment it's ready
// instead of being silently swallowed.
let pendingVideoPlay = false;
let updateTV = null;
let updateClock = null;
let ukulele = null;
let whiteboardShadow = null;
let whiteboardObject = null;
let switchMesh = null;
let drawWB = null;
// focusPresets — per-object camera/target offsets used by focusOnObject
const focusPresets = {
  Cube009_1: {
    cameraOffset: new THREE.Vector3(-0.012, -0.017, 2.999),
    targetOffset: new THREE.Vector3(0.000, 0.000, 0.000)
  },
  leftArm002_8: {
    cameraOffset: new THREE.Vector3(2.048, 0.229, -0.022),
    targetOffset: new THREE.Vector3(0.000, 0.10, 0.000)
  }
};

// Camera + renderer
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 3, 10);

// antialias is OFF 
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
document.body.appendChild(renderer.domElement);
renderer.domElement.style.opacity = '0';
renderer.domElement.style.transition = 'opacity 0.9s ease-out';
renderer.domElement.style.position = 'relative';
renderer.domElement.style.zIndex = '1';
// A canvas is display:inline by default, so it sits on a text baseline and
// leaves a few pixels of descender space below it. That made the document
// marginally taller than the viewport, so the page itself scrolled: the canvas
// (position:relative) moved with it while the CSS3D layer (position:fixed)
// did not, sliding BMO's screen out of register with the iframe on it.
renderer.domElement.style.display = 'block';
document.documentElement.style.overflow = 'hidden';
document.body.style.overflow = 'hidden';
document.body.style.height = '100%';

/* The 2D site (/bmo_desktop) is shown on BMO's screen as a flat fixed-position
   overlay — see mountScreenIframe. It was a CSS3D layer transformed onto the
   screen plane, which looked right but could not receive clicks. */
const INLINE_SCREEN = !new URLSearchParams(location.search).has('classicscreen');

// Shrinks the iframe relative to the screen plane so BMO's bezel — which sits
// ~0.1 units closer to camera and therefore projects larger — doesn't get
// overlapped at the corners. Raise toward 1.0 for a fuller screen.
const SCREEN_INSET = 1.0;

// Corner rounding, in iframe pixels — the iframe is 1200px wide before being
// scaled down onto the mesh, so these are ~5-6% of its width, matched to the
// curve of BMO's screen cutout rather than literal on-screen pixel values.
// Bottom corners are tighter than the top, following the body's shape.
const SCREEN_RADIUS_TOP = 60;
const SCREEN_RADIUS_BOTTOM = 30;
// CSS order: top-left, top-right, bottom-right, bottom-left.
const SCREEN_CORNER_RADIUS =
  `${SCREEN_RADIUS_TOP}px ${SCREEN_RADIUS_TOP}px ${SCREEN_RADIUS_BOTTOM}px ${SCREEN_RADIUS_BOTTOM}px`;

let screenIframe = null;
let screenOverlay = null;
let isBrowsingScreen = false;

// Disable text/cursor selection on all elements globally
const noSelectStyle = document.createElement('style');
noSelectStyle.innerHTML = `* { user-select: none; -webkit-user-select: none; }`;
document.head.appendChild(noSelectStyle);

let appReady = false;

const loadingScreen = document.createElement('div');
loadingScreen.id = 'loadingScreen';
loadingScreen.innerHTML = `
  <div class="loading-content">
    <div class="loading-title">loading kyle's portfolio</div>
    <div class="loading-bar-track">
      <div class="loading-bar-fill" id="loadingBarFill"></div>
    </div>
    <div class="loading-meta">
      <span id="loadingPercent">0%</span>
      <span class="loading-tip" id="loadingTip">preparing the scene...</span>
    </div>
  </div>
`;

const loadingStyle = document.createElement('style');
loadingStyle.innerHTML = `
  #loadingScreen{
    position:fixed; inset:0;
    background:#0a1530;
    z-index:100000;
    display:flex; align-items:center; justify-content:center;
    transition: opacity 0.6s ease-out;
    font-family:'Minecraftia', 'Courier New', monospace;
    color:#c9f4df;
  }
  #loadingScreen.fade-out{
    opacity:0;
    pointer-events:none;
  }
  #loadingScreen .loading-content{
    text-align:center;
    width:min(360px, 80vw);
  }
  #loadingScreen .loading-title{
    font-size:18px;
    letter-spacing:2px;
    margin-bottom:22px;
    animation: loadingPulse 1.6s ease-in-out infinite;
  }
  @keyframes loadingPulse{
    0%,100%{ opacity:1; }
    50%   { opacity:0.55; }
  }
  #loadingScreen .loading-bar-track{
    width:100%;
    height:10px;
    background:#162043;
    border:2px solid #c9f4df;
    border-radius:6px;
    overflow:hidden;
    box-shadow: 0 0 12px rgba(91,203,154,0.25);
  }
  #loadingScreen .loading-bar-fill{
    height:100%;
    width:0%;
    background: linear-gradient(90deg, #3da87a, #5bcb9a, #c9f4df);
    transition: width 0.18s linear;
    box-shadow: 0 0 8px rgba(91,203,154,0.6);
  }
  #loadingScreen .loading-meta{
    display:flex; justify-content:space-between;
    margin-top:10px;
    font-size:11px;
    opacity:0.75;
    letter-spacing:1px;
  }
  #loadingScreen.indeterminate .loading-bar-fill{
    width:35% !important;
    animation: loadingSlide 1.2s ease-in-out infinite;
  }
  @keyframes loadingSlide{
    0%   { transform: translateX(-100%); }
    100% { transform: translateX(286%); }
  }
`;
document.head.appendChild(loadingStyle);

const loadingTipEl = loadingScreen.querySelector('#loadingTip');
const loadingTips = [
  'preparing the scene...',
  'checking your network...',
  'arranging books...',
  'may take a few seconds...',
  'tuning the tv...',
  'waking up bmo...',
];
let loadingTipIdx = 0;
let loadingTipInterval = null;
function startLoadingTipCycle() {
  if (loadingTipInterval) return;
  loadingTipInterval = setInterval(() => {
    loadingTipIdx = (loadingTipIdx + 1) % loadingTips.length;
    if (loadingTipEl) loadingTipEl.textContent = loadingTips[loadingTipIdx];
  }, 1800);
}

const isMobile = window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;

const titleScreen = document.createElement('div');
titleScreen.id = 'titleScreen';
titleScreen.innerHTML = `
  <div class="title-content">
    <div class="title-text">kyle fernandez</div>
    <div class="title-subtitle">software engineer | data & security analyst</div>
    <div class="title-hint">[ click anywhere to begin  ]</div>
  </div>
`;
titleScreen.style.cssText = `
  position: fixed;
  inset: 0;
  background: transparent;
  z-index: 100001;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  cursor: pointer;
  opacity: 1;
  overflow: hidden;
  transition: opacity 0.45s ease-out;
  font-family: 'Minecraftia', 'Courier New', monospace;
  color: #c9f4df;
`;
const titleStyle = document.createElement('style');
titleStyle.innerHTML = `
  /* Blurred, darkened background image — pseudo-element keeps blur off the text */
  #titleScreen::before {
    content: '';
    position: absolute;
    inset: -60px;          /* overshoot edges so blur fringe is hidden */
    background: url('/background-blur.jpg') center / cover no-repeat;
    filter: blur(50px) brightness(0.5);
    z-index: 0;
  }
  /* Dark tint layer on top of the blurred image, under the text */
  #titleScreen::after {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(10, 21, 48, 0.35);
    z-index: 1;
  }
  /* Keep text above both pseudo-elements */
  #titleScreen .title-content {
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  #titleScreen .title-text{
    font-size: clamp(28px, 6vw, 44px);
    letter-spacing: 6px;
    text-align: center;
    margin-bottom: 0px;
    text-shadow: 0 0 20px rgba(91,203,154,0.25);
  }
  #titleScreen .title-subtitle{
    font-size: clamp(11px, 1.6vw, 14px);
    letter-spacing: 5px;
    text-align: center;
    margin-bottom: 48px;
    opacity: 0.7;
    color: #c9f4df;
    text-transform: lowercase;
  }
  #titleScreen .title-hint{
    text-align: center;
    font-size: 12px;
    letter-spacing: 3px;
    opacity: 0.55;
    animation: titleHintPulse 1.6s ease-in-out infinite;
  }
  @keyframes titleHintPulse{
    0%, 100% { opacity: 0.55; }
    50%      { opacity: 0.15; }
  }
  #titleScreen.fade-out{
    opacity: 0;
    pointer-events: none;
  }

`;
document.head.appendChild(titleStyle);
document.body.appendChild(titleScreen);

// Experience picker — shown after the title is clicked, lets user choose 3D or 2D site
const pickerOverlay = document.createElement('div');
pickerOverlay.id = 'pickerOverlay';
pickerOverlay.style.cssText = `
  position: fixed;
  inset: 0;
  background: transparent;
  overflow: hidden;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s ease;
  font-family: 'Minecraftia', 'Courier New', monospace;
  color: #c9f4df;
`;
const pickerBgImage = document.createElement('div');
pickerBgImage.style.cssText = `
  position: absolute;
  inset: -60px;
  background: url('/background-blur.jpg') center / cover no-repeat;
  filter: blur(60px) brightness(0.3);
  z-index: 0;
`;
pickerOverlay.appendChild(pickerBgImage);

const pickerBgTint = document.createElement('div');
pickerBgTint.style.cssText = `
  position: absolute;
  inset: 0;
  background: rgba(10, 21, 48, 0.35);
  z-index: 1;
`;
pickerOverlay.appendChild(pickerBgTint);

const pickerContent = document.createElement('div');
pickerContent.style.cssText = `
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
`;
pickerOverlay.appendChild(pickerContent);

pickerContent.innerHTML = `
  <div style="font-size:15px;letter-spacing:3px;margin-bottom:10px;opacity:0.8;">choose your experience</div>
  <div style="display:flex;gap:24px;flex-wrap:wrap;justify-content:center;">
    <button id="pick3d" style="
      cursor:pointer;
      background:rgba(10,21,48,0.6);
      border:2px solid rgba(201,244,223,0.4);
      border-radius:14px;
      padding:32px 36px;
      color:#c9f4df;
      font-family:'Minecraftia','Courier New',monospace;
      font-size:12px;
      letter-spacing:1.5px;
      width:200px;
      text-align:center;
      transition:background 0.2s,border-color 0.2s,transform 0.15s;
      display:flex;flex-direction:column;align-items:center;gap:14px;
    ">
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-box-icon lucide-box"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
      <span style="font-size:13px;letter-spacing:2px;">3d interactive (recommended)</span>
      <span style="font-size:9px;opacity:0.55;line-height:1.7;">explore the room,<br>click objects, toggle lights</span>
    </button>
    <button id="pick2d" style="
      cursor:pointer;
      background:rgba(10,21,48,0.6);
      border:2px solid rgba(201,244,223,0.4);
      border-radius:14px;
      padding:32px 36px;
      color:#c9f4df;
      font-family:'Minecraftia','Courier New',monospace;
      font-size:12px;
      letter-spacing:1.5px;
      width:200px;
      text-align:center;
      transition:background 0.2s,border-color 0.2s,transform 0.15s;
      display:flex;flex-direction:column;align-items:center;gap:14px;
    ">
      <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-binary-icon lucide-binary"><rect x="14" y="14" width="4" height="6" rx="2"/><rect x="6" y="4" width="4" height="6" rx="2"/><path d="M6 20h4"/><path d="M14 10h4"/><path d="M6 14h2v6"/><path d="M14 4h2v6"/></svg>
      <span style="font-size:13px;letter-spacing:2px;">2d website</span>
      <span style="font-size:9px;opacity:0.55;line-height:1.7;">straight to the 2d portfolio,<br>no fluff</span>
    </button>
  </div>
`;
document.body.appendChild(pickerOverlay);

const pick3dBtn = pickerOverlay.querySelector('#pick3d');
const pick2dBtn = pickerOverlay.querySelector('#pick2d');

if (isMobile) {
  pick3dBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
    <span style="font-size:12px;letter-spacing:2px;line-height:1.6;">3d portfolio only<br>available on desktops</span>
  `;
  pick3dBtn.style.cursor = 'not-allowed';
  pick3dBtn.style.opacity = '0.45';
  pick3dBtn.disabled = true;
}

['pick3d', 'pick2d'].forEach(id => {
  if (id === 'pick3d' && isMobile) return;
  const btn = pickerOverlay.querySelector(`#${id}`);
  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(61,168,122,0.2)';
    btn.style.borderColor = '#c9f4df';
    btn.style.transform = 'translateY(-3px)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'rgba(10,21,48,0.6)';
    btn.style.borderColor = 'rgba(201,244,223,0.4)';
    btn.style.transform = 'translateY(0)';
  });
});

function closePicker() {
  pickerOverlay.style.opacity = '0';
  pickerOverlay.style.pointerEvents = 'none';
  setTimeout(() => pickerOverlay.remove(), 450);
}

function showPicker() {
  pickerOverlay.style.pointerEvents = 'auto';
  pickerOverlay.style.opacity = '1';
}

titleScreen.addEventListener('click', () => {
  titleScreen.classList.add('fade-out');
  setTimeout(() => showPicker(), 220);
  setTimeout(() => titleScreen.remove(), 500);
}, { once: true });

pick3dBtn.addEventListener('click', () => {
  if (isMobile) return;
  closePicker();
  ambientSound.loop = true;
  ambientSound.preload = 'auto';
  ambientSound.play().catch(err => console.warn('ambient audio blocked:', err));
  document.body.appendChild(loadingScreen);
  startLoadingTipCycle();
  startSceneLoad();
});

pick2dBtn.addEventListener('click', () => {
  sessionStorage.setItem('reload3DOnReturn', '1');
  pickerOverlay.style.opacity = '0';
  setTimeout(() => {
    window.location.href = '/2d-website/';
  }, 350);
});

function dismissLoadingScreen() {
  if (loadingTipInterval) {
    clearInterval(loadingTipInterval);
    loadingTipInterval = null;
  }
  const bar = document.getElementById('loadingBarFill');
  const pct = document.getElementById('loadingPercent');
  if (bar) bar.style.width = '100%';
  if (pct) pct.textContent = '100%';
  setTimeout(() => {
    loadingScreen.classList.add('fade-out');
    setTimeout(() => {
      loadingScreen.remove();
      renderer.domElement.style.opacity = '1';
      appReady = true;
      showHelpTooltip();
    }, 700);
  }, 250);
}

const navCover = document.createElement('div');
navCover.style.cssText = `
  position: fixed;
  inset: 0;
  background: #c9f4df;
  z-index: 99999;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease-out;
`;
document.body.appendChild(navCover);

const fontStyle = document.createElement('style');
fontStyle.innerHTML = `
  @font-face {
    font-family: 'Minecraftia';
    src: url('/fonts/Minecraftia-Regular.ttf') format('truetype');
    font-weight: normal;
    font-style: normal;
  }
`;
document.head.appendChild(fontStyle);

const helpBtn = document.createElement('button');
helpBtn.textContent = '?';
helpBtn.style.cssText = `
  position: fixed;
  padding-top: 14px;
  bottom: 24px;
  right: 24px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid rgba(201, 244, 223, 1);
  background: rgba(10,21,48,0.55);
  color: #c9f4df;
  font-family: 'Minecraftia', 'Courier New', monospace;
  font-size: 18px;
  cursor: pointer;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, border-color 0.2s;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  outline: none;
`;
helpBtn.addEventListener('mouseenter', () => {
  helpBtn.style.background = 'rgba(61,168,122,0.35)';
  helpBtn.style.borderColor = '#c9f4df';
});
helpBtn.addEventListener('mouseleave', () => {
  helpBtn.style.background = 'rgba(10,21,48,0.55)';
  helpBtn.style.borderColor = 'rgba(201,244,223,0.6)';
});
document.body.appendChild(helpBtn);

// Tooltip that appears beside the ? button when the scene first loads
const helpTooltip = document.createElement('div');
helpTooltip.textContent = 'hover BMO to move in · move off him to step back · click anywhere for the full room';
helpTooltip.style.cssText = `
  position: fixed;
  bottom: 30px;
  right: 72px;
  background: rgba(10,21,48,0.75);
  color: #c9f4df;
  font-family: 'Minecraftia', 'Courier New', monospace;
  font-size: 10px;
  letter-spacing: 0.8px;
  line-height: 1.5;
  padding: 11px 14px 5px;
  border-radius: 8px;
  border: 2px solid rgba(201,244,223,1);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 9998;
  pointer-events: none;
  opacity: 0;
  transform: translateX(20px);
  transition: opacity 0.5s ease, transform 0.5s ease;
  white-space: nowrap;
`;
// small arrow pointing right toward the ? button
helpTooltip.innerHTML += `<span style="
  position:absolute;right:-7px;top:50%;transform:translateY(-50%);
  width:0;height:0;
  border-top:6px solid transparent;
  border-bottom:6px solid transparent;
  border-left:7px solid rgba(10,21,48,0.75);
"></span>`;
document.body.appendChild(helpTooltip);

function showHelpTooltip() {
  helpTooltip.style.opacity = '1';
  helpTooltip.style.transform = 'translateX(0)';
  setTimeout(() => {
    helpTooltip.style.opacity = '0';
    helpTooltip.style.transform = 'translateX(20px)';
  }, 4000);
}

const helpOverlay = document.createElement('div');
helpOverlay.style.cssText = `
  position: fixed;
  inset: 0;
  background: rgba(10,21,48,0.45);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
`;
helpOverlay.innerHTML = `
  <div style="
    font-family:'Minecraftia','Courier New',monospace;
    color:#c9f4df;
    background: rgba(10,21,48,0.7);
    border: 2px solid rgba(201,244,223,0.35);
    border-radius: 14px;
    padding: 36px 44px;
    max-width: 420px;
    width: 90vw;
    box-shadow: 0 0 40px rgba(91,203,154,0.15);
    text-align: left;
  ">
    <div style="font-size:20px;letter-spacing:2px;margin-bottom:24px;text-align:center;">
      how to explore
    </div>
    <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:14px;font-size:11px;line-height:1.8;letter-spacing:1px;">
      <li> <strong>move the mouse</strong> - look around the desk</li>
      <li> <strong>hover BMO</strong> - move in: desk view, then his screen</li>
      <li> <strong>move off BMO</strong> - step back out to the desk view</li>
      <li> <strong>left click anywhere</strong> - pull back to the full 3D room</li>
      <li> <strong>click + drag</strong> - rotate the camera around the room</li>
      <li> <strong>scroll</strong> - zoom in and out</li>
      <li> <strong>click an object</strong> - focus in on it (hover BMO or the whiteboard to zoom straight in)</li>
      
      <center> <li> -- examples -- </li></center>
      <li> <strong>BMO (the little robot) </strong> - hover in to his screen and use the site on it</li>
      <li> <strong>light switch</strong> - toggle day / night</li>
      <li> <strong>the bed</strong> - you can try</li>
    </ul>
    <div style="margin-top:28px;text-align:center;font-size:10px;opacity:0.5;letter-spacing:1px;">click anywhere to close</div>
  </div>
`;
document.body.appendChild(helpOverlay);

let helpOpen = false;

function openHelp() {
  helpOpen = true;
  helpOverlay.style.opacity = '1';
  helpOverlay.style.pointerEvents = 'auto';
}
function closeHelp() {
  helpOpen = false;
  helpOverlay.style.opacity = '0';
  helpOverlay.style.pointerEvents = 'none';
  helpBtn.blur();
}
helpBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  helpOpen ? closeHelp() : openHelp();
});
helpOverlay.addEventListener('click', closeHelp);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && helpOpen) closeHelp();
});

const tipBar = document.createElement('div');
tipBar.innerText = 'You may not rest now, there are monsters nearby';
tipBar.style.position = 'absolute';
tipBar.style.top = '20px';
tipBar.style.left = '50%';
tipBar.style.transform = 'translateX(-50%)';
tipBar.style.padding = '14px 20px';
tipBar.style.background = 'rgba(0, 0, 0, 0.75)';
tipBar.style.color = 'white';
tipBar.style.fontFamily = 'Minecraftia, Arial, sans-serif';
tipBar.style.fontSize = '16px';
tipBar.style.borderRadius = '10px';
tipBar.style.zIndex = '999';
tipBar.style.pointerEvents = 'none';
tipBar.style.transition = 'opacity 0.5s ease-in-out';
tipBar.style.opacity = '0';
document.body.appendChild(tipBar);

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.7;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const box = new THREE.Box3().setFromObject(scene);
const center = box.getCenter(new THREE.Vector3());
console.log('center:', center);

// lights
const fillLight = new THREE.HemisphereLight(0x2a3a5a, 0x0a0a15, 0.2);
scene.add(fillLight);

const ambientLight = new THREE.AmbientLight(0x6a7a9a, 0.15);
scene.add(ambientLight);

const moonFill = new THREE.DirectionalLight(0xb0c0e0, 0.4);
moonFill.position.set(-10, 3, 4);
moonFill.target.position.set(center.x, center.y, center.z);
moonFill.target.updateMatrixWorld();
scene.add(moonFill, moonFill.target);
moonFill.castShadow = false;

const sunKey = new THREE.DirectionalLight(0xffd49a, 0);
sunKey.position.set(-4.5, 3.5, 1.5);
sunKey.target.position.set(center.x, center.y, center.z);
sunKey.target.updateMatrixWorld();
sunKey.castShadow = true;
sunKey.shadow.mapSize.set(1024, 1024);
sunKey.shadow.bias        = -0.003;
sunKey.shadow.normalBias  = 0.08;
sunKey.shadow.radius      = 6;
sunKey.shadow.camera.near = 0.1;
sunKey.shadow.camera.far  = 40;
sunKey.shadow.camera.left   = -14;
sunKey.shadow.camera.right  =  14;
sunKey.shadow.camera.top    =  14;
sunKey.shadow.camera.bottom = -14;
sunKey.shadow.camera.updateProjectionMatrix();
sunKey.shadow.autoUpdate = false;
sunKey.shadow.needsUpdate = true;
scene.add(sunKey, sunKey.target);
window._sunKey = sunKey;

const moonKey = new THREE.DirectionalLight(0x8aa6d0, 2.4);
moonKey.position.set(-4.5, 3.5, 1.5);
moonKey.target.position.set(center.x, center.y, center.z);
moonKey.target.updateMatrixWorld();
moonKey.castShadow = true;
moonKey.shadow.mapSize.set(1024, 1024);
moonKey.shadow.bias        = -0.003;
moonKey.shadow.normalBias  = 0.08;
moonKey.shadow.radius      = 6;
moonKey.shadow.camera.near = 0.1;
moonKey.shadow.camera.far  = 40;
moonKey.shadow.camera.left   = -14;
moonKey.shadow.camera.right  =  14;
moonKey.shadow.camera.top    =  14;
moonKey.shadow.camera.bottom = -14;
moonKey.shadow.camera.updateProjectionMatrix();
moonKey.shadow.autoUpdate = false;
moonKey.shadow.needsUpdate = true;
scene.add(moonKey, moonKey.target);
window._moonKey = moonKey;
moonFill.shadow.mapSize.set(1024, 1024);
moonFill.shadow.bias        = -0.0005;
moonFill.shadow.normalBias  = 0.02;
moonFill.shadow.radius      = 0.6;
moonFill.shadow.camera.near = 0.1;
moonFill.shadow.camera.far  = 30;
moonFill.shadow.camera.left   = -8;
moonFill.shadow.camera.right  =  8;
moonFill.shadow.camera.top    =  8;
moonFill.shadow.camera.bottom = -8;
moonFill.shadow.camera.updateProjectionMatrix();
moonFill.shadow.autoUpdate = false;

const bulbLight = new THREE.PointLight(0xffd9a0, 5, 8, 1);
bulbLight.position.set(0.5, 4.5, 0.5);
bulbLight.castShadow = true;
bulbLight.shadow.mapSize.width  = 1024;
bulbLight.shadow.mapSize.height = 1024;
bulbLight.shadow.bias           = -0.0005;
bulbLight.shadow.normalBias     = 0.02;
bulbLight.shadow.radius         = 4;
bulbLight.shadow.camera.near = 0.5;
bulbLight.shadow.camera.far  = 5;
bulbLight.shadow.camera.updateProjectionMatrix();
bulbLight.shadow.autoUpdate = false;
bulbLight.shadow.needsUpdate = true;
scene.add(bulbLight);

const bulbMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.08, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff2c0, toneMapped: false })
);
bulbMesh.position.copy(bulbLight.position);
bulbMesh.position.y += 0.001;
bulbMesh.castShadow = false;
bulbMesh.receiveShadow = false;
scene.add(bulbMesh);
window._bulb = bulbLight;

const deskLamp = new THREE.PointLight(0xffd1a0, 0, 3.0, 1.8);
deskLamp.castShadow = false;
scene.add(deskLamp);
window._deskLamp = deskLamp;

const DESK_LAMP_OFFSET = new THREE.Vector3(-0.3, 0.3, 0);

const deskLampBulbMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.04, 12, 12),
  new THREE.MeshBasicMaterial({ color: 0xffe5b0, toneMapped: false })
);
deskLampBulbMesh.castShadow = false;
deskLampBulbMesh.receiveShadow = false;
scene.add(deskLampBulbMesh);
window._deskLampBulb = deskLampBulbMesh;

window.nudgeLamp = (dx = 0, dy = 0, dz = 0) => {
  deskLamp.position.x += dx;
  deskLamp.position.y += dy;
  deskLamp.position.z += dz;
  deskLampBulbMesh.position.copy(deskLamp.position);
  window.showLampPos();
};
window.setLampPos = (x, y, z) => {
  deskLamp.position.set(x, y, z);
  deskLampBulbMesh.position.copy(deskLamp.position);
  window.showLampPos();
};
window.showLampPos = () => {
  const p = deskLamp.position;
  console.log(`desk lamp pos:  x=${p.x.toFixed(3)}  y=${p.y.toFixed(3)}  z=${p.z.toFixed(3)}`);
};
window.toggleLampHelper = () => {
  deskLampBulbMesh.visible = !deskLampBulbMesh.visible;
  console.log(`Lamp helper visible: ${deskLampBulbMesh.visible}`);
};
toggleLampHelper();

const DUST_COUNT = 130;
const dustGeo = new THREE.BufferGeometry();
const dustPositions  = new Float32Array(DUST_COUNT * 3);
const dustVelocities = new Float32Array(DUST_COUNT * 3);
const dustSeeds      = new Float32Array(DUST_COUNT);
for (let i = 0; i < DUST_COUNT; i++) {
  dustPositions[i * 3 + 0] = (Math.random() - 0.5) * 3.6;
  dustPositions[i * 3 + 1] =  Math.random() * 2.6;
  dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 3.6;
  dustVelocities[i * 3 + 0] = (Math.random() - 0.5) * 0.04;
  dustVelocities[i * 3 + 1] =  Math.random() * 0.025 + 0.005;
  dustVelocities[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
  dustSeeds[i] = Math.random() * Math.PI * 2;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));

const _dustCanvas = document.createElement('canvas');
_dustCanvas.width = _dustCanvas.height = 32;
const _dustCtx = _dustCanvas.getContext('2d');
const _dustGrad = _dustCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
_dustGrad.addColorStop(0.0, 'rgba(255,240,200,1.0)');
_dustGrad.addColorStop(0.4, 'rgba(255,225,170,0.45)');
_dustGrad.addColorStop(1.0, 'rgba(255,210,150,0.0)');
_dustCtx.fillStyle = _dustGrad;
_dustCtx.fillRect(0, 0, 32, 32);
const dustTex = new THREE.CanvasTexture(_dustCanvas);
dustTex.colorSpace = THREE.SRGBColorSpace;

const dustMaterial = new THREE.PointsMaterial({
  size:            0.06,
  map:             dustTex,
  transparent:     true,
  depthWrite:      false,
  blending:        THREE.AdditiveBlending,
  opacity:         0,
  sizeAttenuation: true,
  color:           0xfff0c8,
  toneMapped:      false,
});
const dust = new THREE.Points(dustGeo, dustMaterial);
dust.frustumCulled = false;
dust.position.set(0, 1, 1);
scene.add(dust);
window._dust = dust;

const STEAM_COUNT = 67;
const STEAM_RISE_HEIGHT = 0.4;
const STEAM_WAVE_AMP    = 0.037;
const STEAM_WAVE_FREQ   = Math.PI * 3;
const steamGeo = new THREE.BufferGeometry();
const steamPositions = new Float32Array(STEAM_COUNT * 3);
const steamLife      = new Float32Array(STEAM_COUNT);
const steamSeeds     = new Float32Array(STEAM_COUNT);
for (let i = 0; i < STEAM_COUNT; i++) {
  steamLife[i]  = i / STEAM_COUNT;           
  steamSeeds[i] = (Math.random() - 0.5) * 0.6;
}
steamGeo.setAttribute('position', new THREE.BufferAttribute(steamPositions, 3));
steamGeo.setAttribute('aLife',    new THREE.BufferAttribute(steamLife, 1));

const _steamCanvas = document.createElement('canvas');
_steamCanvas.width  = 64;
_steamCanvas.height = 64;
const _steamCtx  = _steamCanvas.getContext('2d');
const _steamGrad = _steamCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
_steamGrad.addColorStop(0.00, 'rgba(255,255,255,1.0)');
_steamGrad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
_steamGrad.addColorStop(1.00, 'rgba(255,255,255,0.0)');
_steamCtx.fillStyle = _steamGrad;
_steamCtx.fillRect(0, 0, 64, 64);
const steamTex = new THREE.CanvasTexture(_steamCanvas);
steamTex.colorSpace = THREE.SRGBColorSpace;

const steamMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uMap:        { value: steamTex },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.0) },
    uBaseSize:   { value: 55.0 },
  },
  vertexShader: /* glsl */ `
    attribute float aLife;
    varying float vLife;
    uniform float uPixelRatio;
    uniform float uBaseSize;
    void main() {
      vLife = aLife;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float sizeMul = 0.55 + aLife * 0.75;
      gl_PointSize = uBaseSize * sizeMul * uPixelRatio / -mv.z;
      gl_Position  = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uMap;
    varying float vLife;
    void main() {
      vec4 tex = texture2D(uMap, gl_PointCoord);
      float fadeIn  = smoothstep(0.0, 0.18, vLife);
      float fadeOut = 1.0 - smoothstep(0.55, 1.0, vLife);
      float a = tex.a * fadeIn * fadeOut * 0.09;
      gl_FragColor = vec4(vec3(0.95, 0.96, 0.95), a);
    }
  `,
  transparent:  true,
  depthWrite:   false,
  blending:     THREE.NormalBlending,
  toneMapped:   false,
});

const coffeeSteam = new THREE.Points(steamGeo, steamMaterial);
coffeeSteam.frustumCulled = false;
coffeeSteam.renderOrder   = 10;
coffeeSteam.visible       = false;
scene.add(coffeeSteam);

const steamOrigin = new THREE.Vector3();
let   steamReady  = false;

let isDayMode = false;
let dayNightAnimId = null;

let groundPlaneMesh = null;
let groundPlaneDayColor = null;
const GROUND_NIGHT_COLOR = new THREE.Color(0x5f6163);

const NIGHT_PALETTE = {
  background:        new THREE.Color(0x1d2a43),  // tone-maps to ~#0a1530
  beamColor:         new THREE.Color(0xd8e0f0),
  beamIntensity:     0.9,
  moonColor:         new THREE.Color(0xb0c0e0),
  moonIntensity:     0.3,
  ambientColor:      new THREE.Color(0x6a7a9a),
  ambientIntensity:  0.15,
  hemiSky:           new THREE.Color(0x2a3a5a),
  hemiGround:        new THREE.Color(0x0a0a15),
  hemiIntensity:     0.2,
  bulbIntensity:     5,
  deskLampIntensity: 1.0,
  sunKeyColor:       new THREE.Color(0xffd49a),
  sunKeyIntensity:   0,
  moonKeyColor:      new THREE.Color(0x8aa6d0),
  moonKeyIntensity:  2.4,
  dustOpacity:       0,
  groundColor:       GROUND_NIGHT_COLOR,
};

const DAY_PALETTE = {
  background:        new THREE.Color(0xa6c8e0),
  beamColor:         new THREE.Color(0xffb050),
  beamIntensity:     2.6,
  moonColor:         new THREE.Color(0xb8d0e8),
  moonIntensity:     0.6,
  ambientColor:      new THREE.Color(0xe8dccc),
  ambientIntensity:  0.18,
  hemiSky:           new THREE.Color(0xa6c8e0),
  hemiGround:        new THREE.Color(0xb88858),
  hemiIntensity:     0.4,
  bulbIntensity:     0.6,
  deskLampIntensity: 0,
  sunKeyColor:       new THREE.Color(0xffc278),
  sunKeyIntensity:   2.6,
  moonKeyColor:      new THREE.Color(0x8aa6d0),
  moonKeyIntensity:  0,
  dustOpacity:       0.7,
};


const paperMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uSpeed: { value: 8.5 },
    uStrength: { value: 0.11 },
  },
  vertexShader: /* glsl */`
    uniform float uTime;
    uniform float uSpeed;
    uniform float uStrength;
    varying vec2 vUv;

    void main() {
      vUv = uv;
      vec3 pos = position;

      float windWeight = pow(1.0 - uv.y, 2.0);
      float flutter = sin(pos.y * 10.0 + uTime * uSpeed) * cos(uTime * uSpeed * 0.5);
      pos.z += flutter * uStrength * windWeight;
      pos.y += windWeight * (uStrength * 0.5);

      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      gl_FragColor = vec4(0.45, 0.52, 0.49, 1.0);
    }
  `,
  side: THREE.DoubleSide
});

const paperGeo = new THREE.PlaneGeometry(0.05, 0.3, 1, 15); 
const paperMesh = new THREE.Mesh(paperGeo, paperMaterial);
paperMesh.position.set(0.5, 3.75, -1.8); // center of scene at eye level
paperMesh.frustumCulled = false;
paperMesh.visible = true;
scene.add(paperMesh);


function setDayNight(toDay) {

  clickSound.currentTime = 0;
  clickSound.play();
  if (toDay === isDayMode) return;
  isDayMode = toDay;

  if (whiteboardShadow) {
    whiteboardShadow.traverse((child) => {
      if (child.isMesh) {
        child.receiveShadow = toDay;
        child.castShadow    = toDay;
      }
    });
    if (toDay) {
      moonFill.shadow.needsUpdate = true;
    }
  }

  if (toDay) {
    sunKey.shadow.needsUpdate = true;
  } else {
    moonKey.shadow.needsUpdate = true;
  }

  const to = toDay ? DAY_PALETTE : NIGHT_PALETTE;

  const groundTarget = toDay
    ? (groundPlaneDayColor || GROUND_NIGHT_COLOR)
    : GROUND_NIGHT_COLOR;

  const start = {
    background:        skyColor.clone(),
    moonColor:         moonFill.color.clone(),
    moonIntensity:     moonFill.intensity,
    ambientColor:      ambientLight.color.clone(),
    ambientIntensity:  ambientLight.intensity,
    hemiSky:           fillLight.color.clone(),
    hemiGround:        fillLight.groundColor.clone(),
    hemiIntensity:     fillLight.intensity,
    bulbIntensity:     bulbLight.intensity,
    deskLampIntensity: deskLamp.intensity,
    sunKeyColor:       sunKey.color.clone(),
    sunKeyIntensity:   sunKey.intensity,
    moonKeyColor:      moonKey.color.clone(),
    moonKeyIntensity:  moonKey.intensity,
    dustOpacity:       window._dust ? window._dust.material.opacity : 0,
    beamColor:         window._beam ? window._beam.material.uniforms.uColor.value.clone() : null,
    beamIntensity:     window._beam ? window._beam.material.uniforms.uIntensity.value : null,
    groundColor:       (() => {
                          if (!groundPlaneMesh || !groundPlaneMesh.material) return null;
                          const m = Array.isArray(groundPlaneMesh.material)
                            ? groundPlaneMesh.material[0]
                            : groundPlaneMesh.material;
                          return m && m.color ? m.color.clone() : null;
                        })(),
  };

  if (dayNightAnimId) cancelAnimationFrame(dayNightAnimId);

  const duration = 1500;
  const t0 = performance.now();

  function step() {
    const elapsed = performance.now() - t0;
    const t = Math.min(elapsed / duration, 1);
    const eased = t * t * (3 - 2 * t);

    skyColor.copy(start.background).lerp(to.background, eased);
    moonFill.color.copy(start.moonColor).lerp(to.moonColor, eased);
    moonFill.intensity = THREE.MathUtils.lerp(start.moonIntensity, to.moonIntensity, eased);
    ambientLight.color.copy(start.ambientColor).lerp(to.ambientColor, eased);
    ambientLight.intensity = THREE.MathUtils.lerp(start.ambientIntensity, to.ambientIntensity, eased);
    fillLight.color.copy(start.hemiSky).lerp(to.hemiSky, eased);
    fillLight.groundColor.copy(start.hemiGround).lerp(to.hemiGround, eased);
    fillLight.intensity = THREE.MathUtils.lerp(start.hemiIntensity, to.hemiIntensity, eased);
    bulbLight.intensity = THREE.MathUtils.lerp(start.bulbIntensity, to.bulbIntensity, eased);
    deskLamp.intensity  = THREE.MathUtils.lerp(start.deskLampIntensity, to.deskLampIntensity, eased);
    sunKey.color.copy(start.sunKeyColor).lerp(to.sunKeyColor, eased);
    sunKey.intensity    = THREE.MathUtils.lerp(start.sunKeyIntensity, to.sunKeyIntensity, eased);
    moonKey.color.copy(start.moonKeyColor).lerp(to.moonKeyColor, eased);
    moonKey.intensity   = THREE.MathUtils.lerp(start.moonKeyIntensity, to.moonKeyIntensity, eased);
    if (window._dust) {
      window._dust.material.opacity = THREE.MathUtils.lerp(start.dustOpacity, to.dustOpacity, eased);
    }

    if (window._beam && start.beamColor) {
      const u = window._beam.material.uniforms;
      u.uColor.value.copy(start.beamColor).lerp(to.beamColor, eased);
      u.uIntensity.value = THREE.MathUtils.lerp(start.beamIntensity, to.beamIntensity, eased);
    }

    if (groundPlaneMesh && groundPlaneMesh.material && start.groundColor) {
      const gm = Array.isArray(groundPlaneMesh.material)
        ? groundPlaneMesh.material[0]
        : groundPlaneMesh.material;
      if (gm && gm.color) {
        gm.color.copy(start.groundColor).lerp(groundTarget, eased);
      }
    }

    if (t < 1) {
      dayNightAnimId = requestAnimationFrame(step);
    } else {
      dayNightAnimId = null;
    }
  }
  step();
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Room-view orbit limits. These are deliberately lifted while the camera is
// flying to (or holding) a focus pose: several focus framings sit dead on the
// horizontal, i.e. at polar angle exactly PI/2, which is OUTSIDE this range.
// Leaving the clamp on meant controls.update() shoved the camera back 0.05rad
// every frame, the "arrived" test never passed, and the 3s timeout finished
// the move with a hard snap.
const ORBIT_MIN_POLAR = 0.15;
const ORBIT_MAX_POLAR = Math.PI / 2 - 0.05;
controls.maxPolarAngle = ORBIT_MAX_POLAR;
controls.minPolarAngle = ORBIT_MIN_POLAR;

let orbitLimitsFreed = false;
function freeOrbitLimits(free) {
  if (free === orbitLimitsFreed) return;
  orbitLimitsFreed = free;
  controls.minPolarAngle = free ? 0.001 : ORBIT_MIN_POLAR;
  controls.maxPolarAngle = free ? Math.PI - 0.001 : ORBIT_MAX_POLAR;
}

/* Called at the start of every scripted camera move. Frees the limits and
   flushes any leftover drag inertia — with enableDamping on, OrbitControls
   keeps applying the last spin for many frames, which would otherwise bleed
   into the focus move and leave it off-mark. */
const _txPos  = new THREE.Vector3();
const _txQuat = new THREE.Quaternion();
const _txDir  = new THREE.Vector3();

function beginCameraTransition() {
  freeOrbitLimits(true);

  /* Reconcile controls.target with where the camera is ACTUALLY pointing
     before anything reads it.

     While a BMO view is held, the mouse-pan aims the camera at
     focusControlsTarget + panOffset, but controls.target still holds the
     un-panned point. Both controls.update() below and animateObjectFocus do
     camera.lookAt(controls.target), so starting a move without reconciling
     them re-aimed the camera by the whole pan offset on frame one — the view
     jumped to the un-panned desk pose and only then began to dolly. */
  const dist = Math.max(camera.position.distanceTo(controls.target), 0.001);
  _txDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  controls.target.copy(camera.position).addScaledVector(_txDir, dist);

  /* Flush leftover drag inertia (with damping off, update() clears
     sphericalDelta/scale), then restore the camera exactly — update() also
     re-derives position from the spherical and re-runs lookAt, and neither
     should be allowed to nudge the starting pose of the move. */
  _txPos.copy(camera.position);
  _txQuat.copy(camera.quaternion);
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
  camera.position.copy(_txPos);
  camera.quaternion.copy(_txQuat);
}

const defaultCameraPosition = new THREE.Vector3();
const defaultControlsTarget = new THREE.Vector3();

// --- Hover to focus --------------------------------------------------------
// The idle auto-drift that used to live here is gone: the camera only moves
// when you ask it to. Instead, hovering BMO dollies the camera in and hovering
// away eases it back to the room view.
let userIsInteracting = false;
let hoverFocusActive = false;         // camera is in a hover-driven focus
let hoverFocusSubject = null;        // which subject owns it ('bmo' | 'whiteboard')
// Hovering away no longer pulls the camera back — a left click anywhere is the
// way out. But after returning to the room view the cursor is often still
// parked on the thing we just left, so hover-in is latched off until the
// pointer is seen somewhere that isn't a focus subject.
let hoverRearmNeeded = false;
const supportsHoverFocus = typeof window.matchMedia === 'function'
  ? window.matchMedia('(hover: hover) and (pointer: fine)').matches
  : true;

controls.addEventListener('start', () => { userIsInteracting = true; });
controls.addEventListener('end',   () => { userIsInteracting = false; });

let isEscapeAnimating = false;
let lastEscapeTime = 0;
let isFocusingObject = false;
let lastFocusTime = 0;
let focusAnimStartTime = 0;

const focusCameraPosition = new THREE.Vector3();
const focusControlsTarget = new THREE.Vector3();

const mouseNDC = new THREE.Vector2();
const bmoParallaxCurrent  = new THREE.Vector3();
const bmoParallaxVelocity = new THREE.Vector3(); // spring velocity
const bmoParallaxTarget   = new THREE.Vector3();
// Mouse-driven pan while the camera is held on BMO's desk. Expressed as a
// fraction of the camera's distance to its target, so the pan feels the same
// whether you're at the wide intro framing or dollied in close.
const BMO_PAN_X_FRACTION = 0.11;   // full mouse deflection, left/right
const BMO_PAN_Y_FRACTION = 0.05;   // full mouse deflection, up/down
/* The two constants that decide how the mouse-look feels. Mouse input has no
   smoothing of its own — the target jumps the instant the pointer does — so
   these are the only thing between a flick of the wrist and the camera. At
   6/8 the camera covered most of its pan travel in ~200ms, which read as a
   snap rather than a drift. Lower = slower, heavier, calmer. */
const BMO_PAN_SMOOTHNESS = 3;      // how fast the pan target is chased
const BMO_HOLD_SMOOTHNESS = 4.5;   // how hard the camera holds the panned pose
let lastPanTime = performance.now();
const _panLookAt   = new THREE.Vector3();
const WORLD_UP     = new THREE.Vector3(0, 1, 0);
const _focusGoalPos = new THREE.Vector3();
const _focusGoalTgt = new THREE.Vector3();

/* The views, and the only transitions between them:

     INTRO  (temporary opening pose)  --hover BMO-->  DESK
     DESK   (his body + the mug)      --hover BMO-->  BMO
     BMO    (super close, 2D site)    --hover off--> DESK
     any                              --left click--> ROOM
     ROOM   (full isometric)          --click empty--> back where you were

   INTRO and DESK pan with the mouse. BMO deliberately does not: the 2D site
   has to hold still to be clickable. */
const VIEW_ROOM  = 'room';
const VIEW_INTRO = 'intro';
const VIEW_DESK  = 'desk';
const VIEW_BMO   = 'bmo';
let viewState = VIEW_ROOM;

// Stepping BMO -> DESK is debounced so a pixel of jitter at the edge of his
// silhouette can't flicker the camera between the two.
const BMO_EXIT_DELAY_MS = 180;
let bmoExitTimer = null;
// Moving in is tested against a tight box around the screen so it takes intent;
// staying in is tested against a looser one so the edge doesn't flicker. Both
// are the FACE, never the body — see the VIEW_DESK case in evaluateHoverFocus.
const FACE_ENTER_MARGIN = 0.06;

/* Leaving the BMO view is measured against the VIEWPORT, not against BMO.

   The screen covers roughly the middle 60% of the frame at this distance, so
   testing "off the screen rect" meant that drifting a little onto his body
   already counted as leaving. Now you have to move out to the band where the
   room actually is — the outer 14% on any side. Everything inside that, his
   body and bezel included, still counts as staying on him.

   A raycast can't answer this: this close his bounding box covers the whole
   viewport, so the picker says "on BMO" wherever the cursor is. */
const BMO_EXIT_VIEWPORT_INSET = 0.14;

let isIntroView = false;

// The pose you last clicked out of. A click in the room view puts you back.
let savedView = null;

const _bmoForward = new THREE.Vector3();
const _bmoRight   = new THREE.Vector3();
const _bmoUp      = new THREE.Vector3();

window.addEventListener('mousemove', (e) => {
  mouseNDC.set(
    (e.clientX / window.innerWidth)  * 2 - 1,
   -(e.clientY / window.innerHeight) * 2 + 1
  );
});

const composerTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  stencilBuffer: false,
});
const composer = new EffectComposer(renderer, composerTarget);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2)),
  0.18,
  0.3,
  0.65
);
composer.addPass(bloomPass);

const outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
outlinePass.edgeStrength = 4.0;
outlinePass.edgeGlow = 1.0;
outlinePass.visibleEdgeColor.set(0xffffff);
composer.addPass(outlinePass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

const clickableObjects = [];
const interactionBoundingBoxes = [];
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function registerClickable(target) {
  if (!target || clickableObjects.indexOf(target) !== -1) return;
  clickableObjects.push(target);

  const aabb = new THREE.Box3().setFromObject(target);
  if (aabb.isEmpty()) return;

  const size   = new THREE.Vector3();
  const center = new THREE.Vector3();
  aabb.getSize(size);
  aabb.getCenter(center);

  // BoxGeometry throws on zero-sized dims — clamp to a tiny minimum.
  const sx = Math.max(size.x, 0.01);
  const sy = Math.max(size.y, 0.01);
  const sz = Math.max(size.z, 0.01);

  const proxy = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  proxy.position.copy(center);
  proxy.matrixAutoUpdate = false;
  proxy.updateMatrix();
  proxy.userData.clickableTarget = target;
  proxy.castShadow = false;
  proxy.receiveShadow = false;
  scene.add(proxy);
  interactionBoundingBoxes.push(proxy);
}

function unregisterClickable(target) {
  const idx = clickableObjects.indexOf(target);
  if (idx !== -1) clickableObjects.splice(idx, 1);

  const proxyIdx = interactionBoundingBoxes.findIndex(
    p => p.userData.clickableTarget === target
  );
  if (proxyIdx !== -1) {
    const proxy = interactionBoundingBoxes[proxyIdx];
    interactionBoundingBoxes.splice(proxyIdx, 1);
    scene.remove(proxy);
    proxy.geometry.dispose();
    proxy.material.dispose();
  }
}

/* Starts the BMO intro video. Split out of the click handler so the 'canplay'
   listener can also call it when a click arrived before the video buffered. */
function playBMOVideo() {
  if (!tvVideo || isVideoPlaying) return;
  pendingVideoPlay = false;
  screenOpening = false;
  isVideoPlaying = true;
  // Marked on START, not on 'ended'. Bailing out with Escape half way through
  // still counts as watched, so nobody is made to sit through the intro twice
  // in one visit. A refresh brings it back.
  bmoVideoWatched = true;
  tvVideo.currentTime = 0;
  tvVideo.muted = false;
  tvVideo.volume = 0.8;
  tvVideo.play().catch((err) => {
    // Autoplay policy can still refuse unmuted playback — fall back rather
    // than leaving BMO frozen on a click that looked like it did nothing.
    console.warn('Video play failed, retrying muted:', err);
    tvVideo.muted = true;
    tvVideo.play().catch((err2) => {
      console.warn('Muted retry also failed:', err2);
      isVideoPlaying = false;
    });
  });
}

/* Single entry point for "the user asked to advance BMO". Never returns
   silently on a not-yet-ready video — it queues the intent instead, which is
   what made an early second click feel like it did nothing for a few seconds. */
function requestBMOVideo() {
  if (bmoVideoWatched) {
    zoomToScreenThenShowStatic();
    return;
  }
  if (isVideoPlaying) return;
  if (!tvVideo || !videoReady) {
    pendingVideoPlay = true;
    if (window._loadBMOVideo) window._loadBMOVideo();
    return;
  }
  playBMOVideo();
}

window.addEventListener('pointerdown', (event) => {
  if (!appReady) return;

  // The desktop iframe owns every click while it's mounted. Without this,
  // clicks that land just off the screen plane re-target BMO and yank the
  // camera out from under whatever you were trying to press.
  if (isBrowsingScreen) return;

  // Don't let a stray click re-frame the camera mid-intro.
  if (isVideoPlaying) return;

  // Mid-flight into the desktop. The mount is queued on the focus completing,
  // so a click here would cancel it and leave the screen permanently
  // unopenable. Let the transition land; Escape still bails out.
  if (screenOpening && !isBrowsingScreen) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(interactionBoundingBoxes, false);
  const selected = intersects.length > 0 ? intersects[0].object.userData.clickableTarget : null;

  // These two act on the object without moving the camera, so they work from
  // any view and are checked before the click-to-exit rule below.
  if (selected && (selected === switchMesh ||
      selected.name === 'Object_0003_1' ||
      selected.name === 'switch' ||
      selected.name === 'Switch')) {
    setDayNight(!isDayMode);
    return;
  }

  if (selected && selected === ukulele) {
    ukeSound.currentTime = 0;
    ukeSound.play();
    return;
  }

  // Left click anywhere is the way back to the full isometric room — the only
  // exception being a click on BMO while you're already looking at him, which
  // opens the desktop instead.
  const inFocusedView = isFocusedOnBMO || hoverFocusActive || isFocusingObject || selectedObject !== null;
  if (inFocusedView) {
    if (isFocusedOnBMO && hoverSubjectFor(selected) === 'bmo') {
      // The first click boots the computer (the intro video needs a real user
      // gesture for its audio anyway). After that he is hover-only: clicking
      // him again must not re-zoom or replay the video.
      if (!screenMounted && !screenOpening) {
        if (viewState !== VIEW_BMO) goToBmo();
        requestBMOVideo();
      }
      return;
    }
    returnToRoomView();
    return;
  }

  // From here down we're in the room view. A click on empty space toggles
  // back to the pose you left; a click on an object focuses that object.
  if (!selected) {
    outlinePass.selectedObjects = [];
    restoreSavedView();
    return;
  }

  zoomIn.volume = 0.05;
  zoomIn.currentTime = 0;
  zoomIn.play();

  if (hoverSubjectFor(selected) === 'bmo') {
    goToDesk(true);
    return;
  }

  if (selected === mcbed) {
    tipBar.innerText = isDayMode
      ? 'Sorry, you can only sleep at night'
      : 'You may not rest now, there are monsters nearby';
    tipBar.style.opacity = '1';
    if (tipBar.fadeTimeout) clearTimeout(tipBar.fadeTimeout);
    tipBar.fadeTimeout = setTimeout(() => {
      tipBar.style.opacity = '0';
    }, 3000);
  }

  pendingVideoPlay = false;
  if (tvScreenMesh) unregisterClickable(tvScreenMesh);
  selectedObject = selected;
  outlinePass.selectedObjects = [selected];
  focusOnObject(selected);
});

let pendingPointerEvent = null;
let pointerRaycastQueued = false;
// Last known cursor position in client space, so the hover test can be re-run
// from the animation loop while the camera is moving under a still mouse.
const pointerClient = { x: 0, y: 0, valid: false };

/* Ray from the last known cursor position into the interaction proxies.
   Returns the clickable target under the pointer, or null. */
function pickAtPointer() {
  if (!pointerClient.valid) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((pointerClient.x - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((pointerClient.y - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(interactionBoundingBoxes, false);
  return hits.length > 0 ? hits[0].object.userData.clickableTarget : null;
}

/* Which hover-to-focus subject does this object belong to, if any? Hovering
   ANY part of a subject counts as staying on it — BMO's body, his arm and his
   screen are all "BMO", because once the camera is in close it's the screen
   proxy that sits under the cursor, not the body. */
function hoverSubjectFor(obj) {
  if (!obj) return null;
  if (obj === bmoObject || obj === tvScreenMesh || obj.name === 'leftArm002_8') return 'bmo';
  if (whiteboardObject && obj === whiteboardObject) return 'whiteboard';
  return null;
}

function playCue(sound) {
  try {
    sound.volume = 0.05;
    sound.currentTime = 0;
    const play = sound.play();
    if (play && play.catch) play.catch(() => {});
  } catch (_) {}
}

const _screenBoxLocal = new THREE.Box3();
let _screenBoxReady = false;
const _projV = new THREE.Vector3();

/* Where BMO's screen lands on the viewport, in CSS pixels.

   Needed because at BMO_SCREEN_DISTANCE his bounding box is bigger than the
   whole frame — a raycast hits him no matter where the cursor is, so "hovering
   off BMO" is not something the picker can answer. The screen's projected rect
   is what the user actually sees, so that's what we test against. */
function screenRectOnViewport() {
  if (!tvScreenMesh) return null;
  if (!_screenBoxReady) {
    _screenBoxLocal.setFromObject(tvScreenMesh);
    _screenBoxReady = true;
  }
  const b = _screenBoxLocal;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    _projV.set(i & 1 ? b.max.x : b.min.x,
               i & 2 ? b.max.y : b.min.y,
               i & 4 ? b.max.z : b.min.z).project(camera);
    const sx = (_projV.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-_projV.y * 0.5 + 0.5) * window.innerHeight;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  return { left: minX, right: maxX, top: minY, bottom: maxY };
}

/* Has the pointer moved out to the room, i.e. into the outer band of the
   viewport? An invalid pointer (left the window entirely) counts as away. */
function isPointerInRoomArea() {
  if (!pointerClient.valid) return true;
  const mx = window.innerWidth  * BMO_EXIT_VIEWPORT_INSET;
  const my = window.innerHeight * BMO_EXIT_VIEWPORT_INSET;
  return pointerClient.x < mx || pointerClient.x > window.innerWidth  - mx ||
         pointerClient.y < my || pointerClient.y > window.innerHeight - my;
}

/* Is the cursor on the screen (plus a forgiving margin)? */
function isPointerOverScreen(margin = 0.18) {
  if (!pointerClient.valid) return false;
  const r = screenRectOnViewport();
  if (!r) return false;
  const mx = (r.right - r.left) * margin;
  const my = (r.bottom - r.top) * margin;
  return pointerClient.x >= r.left - mx && pointerClient.x <= r.right + mx &&
         pointerClient.y >= r.top  - my && pointerClient.y <= r.bottom + my;
}

function clearBmoExitTimer() {
  if (bmoExitTimer) { clearTimeout(bmoExitTimer); bmoExitTimer = null; }
}

/* DESK — BMO's body and the mug. Reached by hovering him from the opening
   view, and by hovering off him from the 2D site. */
function goToDesk(zoomingIn) {
  clearBmoExitTimer();
  if (isBrowsingScreen) exitBrowseMode();

  viewState = VIEW_DESK;
  isIntroView = false;
  isFocusedOnBMO = true;
  hoverFocusActive = false;
  hoverFocusSubject = 'bmo';
  selectedObject = null;
  screenOpening = false;
  pendingVideoPlay = false;
  onFocusComplete = null;
  outlinePass.selectedObjects = [];

  if (window._loadBMOVideo) window._loadBMOVideo();
  if (tvScreenMesh) registerClickable(tvScreenMesh);
  playCue(zoomingIn ? zoomIn : zoomOut);
  setAudioPerspective('speaker', 0.9, SPEAKER_LEVEL_DESK);
  focusOnBmoAxis(BMO_INTRO_DISTANCE);
}

/* BMO — super close on the screen with the 2D site live on it. requestBMOVideo
   plays the intro the first time and goes straight in on every later visit. */
function goToBmo() {
  if (viewState === VIEW_BMO) return;
  clearBmoExitTimer();

  viewState = VIEW_BMO;
  isIntroView = false;
  isFocusedOnBMO = true;
  hoverFocusActive = false;
  hoverFocusSubject = 'bmo';
  selectedObject = null;
  outlinePass.selectedObjects = [];

  if (window._loadBMOVideo) window._loadBMOVideo();
  if (tvScreenMesh) registerClickable(tvScreenMesh);
  playCue(zoomIn);
  setAudioPerspective('direct');

  focusOnBmoAxis(BMO_SCREEN_DISTANCE);
  // Already booted: hand pointer events back on arrival and you land exactly
  // where you left the site. Not booted yet: this just moves in close, and the
  // first click boots it — hovering must never start the intro video.
  if (screenMounted) onFocusComplete = enterBrowseMode;
}

/* The whiteboard and anything else with a focus preset. BMO has his own two
   states above, so this never handles him. */
function enterHoverFocus(target, subject) {
  hoverFocusActive = true;
  isIntroView = false;
  hoverFocusSubject = subject;
  selectedObject = target;
  outlinePass.selectedObjects = [];
  playCue(zoomIn);
  focusOnObject(target);
}

/* Remember the pose being left, so the next click in the room view puts you
   back where you were instead of making you re-find it. */
function captureSavedView() {
  savedView = {
    camera:  focusCameraPosition.clone(),
    target:  focusControlsTarget.clone(),
    // A 2D-site view is saved as the desk behind it: coming back should put
    // you on the desk, not straight back into the site.
    state:   viewState === VIEW_BMO ? VIEW_DESK : viewState,
    bmo:     isFocusedOnBMO,
    intro:   isIntroView,
    selected: selectedObject,
    subject: hoverFocusSubject,
  };
}

/* Fly back to the pose captured on the way out. Returns false if there isn't
   one yet, so the caller can fall through to its normal behaviour. */
function restoreSavedView() {
  if (!savedView || isEscapeAnimating) return false;

  // A saved BMO view is always restored as the desk framing, never the 2D
  // site — the site is something you hover into, not something you land in.
  if (savedView.state === VIEW_DESK) {
    goToDesk(true);
    return true;
  }

  focusCameraPosition.copy(savedView.camera);
  focusControlsTarget.copy(savedView.target);
  viewState        = savedView.state;
  isFocusedOnBMO   = savedView.bmo;
  isIntroView      = savedView.intro;
  selectedObject   = savedView.selected;
  hoverFocusSubject = savedView.subject;
  hoverFocusActive = false;
  hoverRearmNeeded = true;
  outlinePass.selectedObjects = [];

  if (savedView.bmo) {
    if (window._loadBMOVideo) window._loadBMOVideo();
    if (tvScreenMesh) registerClickable(tvScreenMesh);
  }

  try {
    zoomIn.volume = 0.05;
    zoomIn.currentTime = 0;
    const play = zoomIn.play();
    if (play && play.catch) play.catch(() => {});
  } catch (_) {}

  isEscapeAnimating = false;
  isFocusingObject = true;
  lastFocusTime = performance.now();
  focusAnimStartTime = performance.now();
  controls.enabled = false;
  beginCameraTransition();
  return true;
}

/* The one way back to the full isometric room: a left click anywhere that
   isn't what you're looking at, or Escape. Hovering away deliberately does
   NOT do this any more — the camera stays where you put it. */
function returnToRoomView() {
  if (isEscapeAnimating) return;
  // Hand pointer events back to the canvas, but leave the site mounted so it
  // keeps its state for the next visit.
  if (isBrowsingScreen) exitBrowseMode();

  const wasFocused = isFocusedOnBMO || hoverFocusActive || isFocusingObject || selectedObject !== null;
  if (wasFocused) {
    captureSavedView();
    try {
      zoomOut.currentTime = 0;
      zoomOut.volume = 0.05;
      const play = zoomOut.play();
      if (play && play.catch) play.catch(() => {});
    } catch (_) {}
  }

  hoverFocusActive = false;
  hoverFocusSubject = null;
  // The cursor is probably still sitting on whatever we just left.
  hoverRearmNeeded = true;
  clearBmoExitTimer();
  viewState = VIEW_ROOM;
  isFocusedOnBMO = false;
  isIntroView = false;
  // Critical: this latch is what stops zoomToScreenThenShowStatic() running
  // twice. If we leave without the desktop having mounted, it has to come back
  // down — otherwise every future attempt early-returns and BMO's screen can
  // never be opened again for the rest of the session.
  screenOpening = false;
  isFocusingObject = false;
  pendingVideoPlay = false;
  onFocusComplete = null;
  selectedObject = null;
  outlinePass.selectedObjects = [];
  if (tvScreenMesh) unregisterClickable(tvScreenMesh);

  setAudioPerspective('speaker');

  isEscapeAnimating = true;
  lastEscapeTime = performance.now();
  controls.enabled = false;
  animateEscape();
}

/* Hover drives the INTRO -> DESK -> BMO ladder, and steps back down from BMO
   when the pointer leaves him. Everything else is a click. */
function evaluateHoverFocus(hovered) {
  if (!supportsHoverFocus || !appReady) return;
  // Never fight a transition that's already running, a playing video, the
  // help panel, or an active drag.
  if (isVideoPlaying || pendingVideoPlay || helpOpen || userIsInteracting) return;
  if (isEscapeAnimating || isFocusingObject) return;

  if (hovered === undefined) hovered = pickAtPointer();
  const onBmo = hoverSubjectFor(hovered) === 'bmo';

  switch (viewState) {
    case VIEW_INTRO:
      // The opening pose steps in to the desk.
      if (onBmo) goToDesk(true);
      break;

    case VIEW_DESK:
      /* The FACE steps in to the 2D site — his body does not.

         This used to trigger anywhere on BMO, which fought the stay test in
         VIEW_BMO below (that one has always measured the screen rect). Hover
         his body and you'd move in, fail the stay test 180ms later, and get
         dropped straight back to the desk — the "it snaps to the body but
         doesn't zoom, then zooms when I move again" behaviour. Entry and stay
         now ask the same question, with hysteresis between them. */
      if (isPointerOverScreen(FACE_ENTER_MARGIN)) goToBmo();
      break;

    case VIEW_BMO:
      /* Staying is anywhere in the middle of the frame — the screen, the
         bezel, his body. Leaving is the outer band, where the room is. */
      if (!isPointerInRoomArea()) {
        clearBmoExitTimer();
      } else if (!bmoExitTimer) {
        bmoExitTimer = setTimeout(() => {
          bmoExitTimer = null;
          if (viewState === VIEW_BMO) goToDesk(false);
        }, BMO_EXIT_DELAY_MS);
      }
      break;

    case VIEW_ROOM: {
      const subject = hoverSubjectFor(hovered);
      // Clear of everything: re-arm, so leaving and coming back works.
      if (!subject) { hoverRearmNeeded = false; break; }
      if (hoverRearmNeeded || selectedObject) break;
      if (subject === 'bmo') goToDesk(true);
      else enterHoverFocus(hovered, subject);
      break;
    }
  }
}

function processPointerHover() {
  pointerRaycastQueued = false;
  const event = pendingPointerEvent;
  pendingPointerEvent = null;
  if (!event) return;

  pointerClient.x = event.clientX;
  pointerClient.y = event.clientY;
  pointerClient.valid = true;

  // Browsing the desktop: no halos, but the hover test still runs — leaving
  // BMO is how you step back out to the desk view now.
  if (isBrowsingScreen) {
    document.body.style.cursor = 'default';
    outlinePass.selectedObjects = [];
    evaluateHoverFocus();
    return;
  }

  const hovered = pickAtPointer();

  // In the opening and desk views a left click anywhere pulls back to the full
  // room, so the whole viewport is clickable — say so with the cursor.
  const clickExitsToRoom = viewState === VIEW_INTRO || viewState === VIEW_DESK;

  if (hovered || clickExitsToRoom) {
    document.body.style.cursor = 'pointer';
    // Once you're zoomed into BMO the outline just rings the thing you're
    // looking at, so keep the cursor affordance but drop the halo.
    /* Never halo a hover-focus subject. The outline means "click me", and BMO
       and the whiteboard mean "hover me" — the camera moves on its own, so the
       halo is redundant. It used to be invisible by accident: hovering BMO set
       isFocusedOnBMO in the same frame, which suppressed it. Now that
       hoverRearmNeeded can hold the transition off (so returning to the room
       with the cursor still on him doesn't dive straight back in), there are
       frames where he is hovered but not focused — and the halo showed. */
    const noHalo = !hovered || hoverSubjectFor(hovered) || isFocusedOnBMO || hoverFocusActive;
    outlinePass.selectedObjects = noHalo ? [] : [hovered];
  } else {
    document.body.style.cursor = 'default';
    outlinePass.selectedObjects = [];
  }

  evaluateHoverFocus(hovered);
}

window.addEventListener('pointermove', (event) => {
  pendingPointerEvent = event;
  if (!pointerRaycastQueued) {
    pointerRaycastQueued = true;
    requestAnimationFrame(processPointerHover);
  }
});

window.addEventListener('pointerleave', () => {
  pointerClient.valid = false;
});

const loader = new GLTFLoader();

// please never remove, this allows it to even load in browsers
loader.setDRACOLoader(dracoLoader);

const SCENE_GLB = '/scene-revised.glb';

function startSceneLoad() {
  console.log(`[load] requesting ${SCENE_GLB}`);
  const loadStart = performance.now();
  loader.load(
  SCENE_GLB,
  (gltf) => {
    console.log(`[load] loaded ${SCENE_GLB} in ${Math.round(performance.now() - loadStart)}ms`);
    const model = gltf.scene;
    model.traverse((object) => {

      if (object.isLight) {
        console.log('GLB light:', object.name, object.type, object.intensity);
        if (object.isDirectionalLight) {
          object.intensity = 0.8;
          object.castShadow = true;
          object.shadow.mapSize.set(1024, 1024);
          object.shadow.bias = -0.0005;
          object.shadow.normalBias = 0.02;
          object.shadow.radius = 2;
          object.shadow.camera.near = 0.1;
          object.shadow.camera.far  = 30;
          object.shadow.camera.left   = -8;
          object.shadow.camera.right  =  8;
          object.shadow.camera.top    =  8;
          object.shadow.camera.bottom = -8;
          object.shadow.camera.updateProjectionMatrix();
          object.shadow.autoUpdate = false;
          object.shadow.needsUpdate = true;
        }
      }

      if (object.isMesh) {
          const name = object.name || '';
        const isShadowCaster =
          /floor|wall|ceiling|room|cube|plane|bed|desk|shelf|door|window|whiteboard|bookcase|dresser|wardrobe|table|chair|sofa|couch|lamp|monitor|computer|Cube|Plane|Box/i.test(name);
        object.castShadow = isShadowCaster;
        object.receiveShadow = true;

        if (object.name === 'Cube009_1') object.receiveShadow = false;
        if (object.name === 'Cube016_1') object.receiveShadow = false;


        if (object.material?.map) {
          object.material.map.anisotropy = 2;
          object.material.map.minFilter = THREE.LinearMipMapLinearFilter;
          object.material.map.magFilter = THREE.LinearFilter;
        }
      }

      const beam = gltf.scene.getObjectByName('Emission');
      if (beam) {
        beam.geometry.computeBoundingBox();
        const bb        = beam.geometry.boundingBox;
        const localMin  = bb.min.clone();
        const localMax  = bb.max.clone();
        const localSize = bb.getSize(new THREE.Vector3());
        const diag      = localSize.length();

        beam.castShadow = false;
        beam.receiveShadow = false;

        const brightEnd = new THREE.Vector3(
          (localMin.x + localMax.x) * 0.5,
           localMax.y,
          (localMin.z + localMax.z) * 0.5
        );
        const dimEnd = new THREE.Vector3(
          (localMin.x + localMax.x) * 0.5,
           localMin.y,
          (localMin.z + localMax.z) * 0.5
        );
        const beamRadius = Math.max(localSize.x, localSize.z) * 0.7;

        const beamMaterial = new THREE.ShaderMaterial({
          uniforms: {
            uColor:       { value: new THREE.Color(0xd8e0f0) },
            uIntensity:   { value: 0.9 },
            uOpacity:     { value: 0.5 },
            uRampStart:   { value: 0.0 },
            uRampEnd:     { value: 1.1 },
            uEdgePower:   { value: 3.5 },
            uRadialPower: { value: 1.8 },
            uAxisStart:   { value: brightEnd },
            uAxisEnd:     { value: dimEnd },
            uReach:       { value: diag },
            uBeamRadius:  { value: beamRadius },
          },
          vertexShader: /* glsl */`
            varying vec3 vLocalPos;
            varying vec3 vWorldNormal;
            varying vec3 vViewDir;
            void main() {
              vLocalPos    = position;
              vec4 worldPos = modelMatrix * vec4(position, 1.0);
              vWorldNormal = normalize(mat3(modelMatrix) * normal);
              vViewDir     = normalize(cameraPosition - worldPos.xyz);
              gl_Position  = projectionMatrix * viewMatrix * worldPos;
            }
          `,
          fragmentShader: /* glsl */`
            uniform vec3  uColor;
            uniform float uIntensity;
            uniform float uOpacity;
            uniform float uRampStart;
            uniform float uRampEnd;
            uniform float uEdgePower;
            uniform float uRadialPower;
            uniform vec3  uAxisStart;
            uniform vec3  uAxisEnd;
            uniform float uReach;
            uniform float uBeamRadius;
            varying vec3  vLocalPos;
            varying vec3  vWorldNormal;
            varying vec3  vViewDir;

            void main() {
              vec3 axis     = uAxisEnd - uAxisStart;
              float axisLen = max(length(axis), 0.0001);
              vec3 axisDir  = axis / axisLen;
              vec3 toPoint  = vLocalPos - uAxisStart;

              float t          = clamp(dot(toPoint, axisDir) / axisLen, 0.0, 1.0);
              float lengthFade = 1.0 - smoothstep(uRampStart, uRampEnd, t);

              vec3 onAxis    = axisDir * dot(toPoint, axisDir);
              vec3 radial    = toPoint - onAxis;
              float radialD  = length(radial) / max(uBeamRadius, 0.0001);
              float radialFade = 1.0 - smoothstep(0.0, 1.0, radialD);
              radialFade = pow(radialFade, uRadialPower);

              float facing   = abs(dot(normalize(vWorldNormal), normalize(vViewDir)));
              float edgeFade = pow(facing, uEdgePower);

              float fade = lengthFade * radialFade * edgeFade;
              vec3 col = uColor * uIntensity * fade;
              gl_FragColor = vec4(col, fade * uOpacity);
            }
          `,
          transparent: true,
          depthWrite:  false,
          blending:    THREE.AdditiveBlending,
          side:        THREE.DoubleSide,
          toneMapped:  false,
        });

        beam.material      = beamMaterial;
        beam.renderOrder   = 999;
        beam.frustumCulled = false;
        window._beam       = beam;
      }
    });

    model.scale.set(1, 1, 1);
    model.position.set(0, 0, 0);
    scene.add(model);



    
    const bmoMeshRef = model.getObjectByName('leftArm002_8');
    let bmoRoot = bmoMeshRef;
    if (bmoRoot) {
      let cursor = bmoRoot.parent;
      while (cursor && cursor !== model && cursor !== scene) {
        bmoRoot = cursor;
        cursor = cursor.parent;
      }
    }

    downsampleTextures(model, 2048, bmoRoot ? [bmoRoot] : []);

    bulbLight.castShadow = true;
    bulbLight.shadow.needsUpdate = true;
    moonFill.castShadow = true;
    moonFill.shadow.needsUpdate = true;
    sunKey.shadow.needsUpdate = true;
    moonKey.shadow.needsUpdate = true;

    groundPlaneMesh = model.getObjectByName('GroundPlane') || model.getObjectByName('Plane004');
    if (groundPlaneMesh && groundPlaneMesh.material) {
      if (Array.isArray(groundPlaneMesh.material)) {
        groundPlaneMesh.material = groundPlaneMesh.material.map(m => m.clone());
        const first = groundPlaneMesh.material[0];
        if (first && first.color) {
          groundPlaneDayColor = first.color.clone();
          if (!isDayMode) first.color.copy(GROUND_NIGHT_COLOR);
        }
      } else {
        groundPlaneMesh.material = groundPlaneMesh.material.clone();
        if (groundPlaneMesh.material.color) {
          groundPlaneDayColor = groundPlaneMesh.material.color.clone();
          if (!isDayMode) groundPlaneMesh.material.color.copy(GROUND_NIGHT_COLOR);
        }
      }
    } else {
      console.warn('No mesh named "GroundPlane" or "Plane004" found — night-mode ground tint disabled.');
    }

    ukulele = model.getObjectByName('ukulele');
    if (ukulele) registerClickable(ukulele);
    // bmo_body's mesh (leftArm.002) has 13 primitives, so GLTFLoader turns it
    // into a Group with children leftArm002_0..12. Targeting leftArm002_8 got
    // a single slice, so the click proxy only covered part of him and hits
    // were hit-or-miss. Register the whole group instead.
    const bmoMesh   = model.getObjectByName('bmo_body')
                   || model.getObjectByName('leftArm002_8');
    bmoObject = bmoMesh;
    const whiteboard = model.getObjectByName('Whiteboard');
    whiteboardShadow = whiteboard;
    whiteboardObject = whiteboard;
  

    if (whiteboardShadow) {
      whiteboardShadow.traverse((child) => {
        if (child.isMesh) {
          child.receiveShadow = false;
          child.castShadow    = false;
        }
      });
      renderer.compile(scene, camera);

      const scheduleIdle = window.requestIdleCallback
        ? (cb) => window.requestIdleCallback(cb, { timeout: 1500 })
        : (cb) => setTimeout(cb, 100);
      scheduleIdle(() => {
        whiteboardShadow.traverse((child) => {
          if (child.isMesh) {
            child.receiveShadow = true;
            child.castShadow    = true;
          }
        });
        renderer.compile(scene, camera);
        whiteboardShadow.traverse((child) => {
          if (child.isMesh) {
            child.receiveShadow = false;
            child.castShadow    = false;
          }
        });
      });
    }

    const bed        = model.getObjectByName('MCBed');
    const pokeball   = model.getObjectByName('Pokeball');
    if (pokeball) registerClickable(pokeball);
    mcbed = bed;
    if (bmoMesh) registerClickable(bmoMesh);
    if (whiteboard) registerClickable(whiteboard);
    if (bed) registerClickable(bed);

    switchMesh = model.getObjectByName('Object_0003_1')
              || model.getObjectByName('switch')
              || model.getObjectByName('Switch');
    if (switchMesh) {
      registerClickable(switchMesh);
    } else {
      console.warn('Day/night switch mesh not found in the GLB — toggle disabled.');
    }


    const pokeballGroup = model.getObjectByName('pokeball')
                       || model.getObjectByName('Pokeball')
                       || model.getObjectByName('PokeBall');
    if (pokeballGroup) {
      registerClickable(pokeballGroup);
    } else {
      console.warn('No object named "pokeball" found in the GLB.');
    }


   


    const coffeeSmoke = model.getObjectByName('CoffeeSmoke');
    if (coffeeSmoke) {
      coffeeSmoke.visible = false;
      coffeeSmoke.getWorldPosition(steamOrigin);
      for (let i = 0; i < STEAM_COUNT; i++) {
        const ix = i * 3;
        steamPositions[ix    ] = steamOrigin.x;
        steamPositions[ix + 1] = steamOrigin.y;
        steamPositions[ix + 2] = steamOrigin.z;
      }
      steamGeo.attributes.position.needsUpdate = true;
      coffeeSteam.visible = true;
      steamReady = true;
    } else {
      console.warn('No mesh named "CoffeeSmoke" found — steam disabled.');
    }

    const deskLampMesh = model.getObjectByName('Cylinder005');
    if (deskLampMesh) {
      deskLampMesh.getWorldPosition(deskLamp.position);
      deskLamp.position.add(DESK_LAMP_OFFSET);
      deskLampBulbMesh.position.copy(deskLamp.position);
      deskLamp.intensity = isDayMode
        ? DAY_PALETTE.deskLampIntensity
        : NIGHT_PALETTE.deskLampIntensity;
      window.showLampPos();
    } else {
      console.warn('No mesh named "Cylinder005" found — desk lamp light disabled.');
      deskLamp.intensity = 0;
      deskLampBulbMesh.visible = false;
    }

    const tv = model.getObjectByName('tv') || model;
    const screen = tv.getObjectByName('bmo_face')
      || tv.getObjectByName('Screen')
      || (() => { let m = null; tv.traverse(o => { if (!m && o.isMesh && /screen/i.test(o.name)) m = o; }); return m; })();

    if (!screen) {
      console.warn('No screen mesh found. Name a child "screen" in Blender or adjust selector.');
    } else {
      const video = document.createElement('video');
      video.src = '/videogames.mp4';
      video.loop = false;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'none';
      video.crossOrigin = 'anonymous';

      let screenMode = 'video';

      video.addEventListener('ended', () => {
        console.log('Video ended. Changing screen color, then zooming...');
        isVideoPlaying = false;
        bmoVideoWatched = true;
        setBMOScreenSolidColor('#c9f4df');
        zoomToScreenThenShowStatic();
      });

      video.addEventListener('pause', () => {
        if (video.ended) return;
        isVideoPlaying = false;
      });

      tvScreenMesh = screen;
      tvVideo = video;
      const g = screen.geometry;
      g.computeBoundingBox();
      const centerLocal = g.boundingBox.getCenter(new THREE.Vector3());
      g.translate(-centerLocal.x, -centerLocal.y, -centerLocal.z);
      screen.scale.set(1, 1, 1);
      screen.position.add(centerLocal);

      normalizeMeshUVs(screen);

      const videoTex = new THREE.VideoTexture(video);
      videoTex.colorSpace     = THREE.SRGBColorSpace;
      videoTex.minFilter      = THREE.LinearFilter;
      videoTex.magFilter      = THREE.LinearFilter;
      videoTex.generateMipmaps = false;

      const solidCvs = document.createElement('canvas');
      solidCvs.width = 4;
      solidCvs.height = 4;
      const solidCtx = solidCvs.getContext('2d');
      solidCtx.fillStyle = '#c9f4df';
      solidCtx.fillRect(0, 0, 4, 4);
      const solidTex = new THREE.CanvasTexture(solidCvs);
      solidTex.colorSpace     = THREE.SRGBColorSpace;
      solidTex.minFilter      = THREE.LinearFilter;
      solidTex.magFilter      = THREE.LinearFilter;
      solidTex.generateMipmaps = false;

      const screenMaterial = new THREE.MeshBasicMaterial({ map: solidTex, toneMapped: false });
      screen.material = screenMaterial;

      function setBMOScreenSolidColor(color = '#c9f4df') {
        screenMode = 'solid';
        solidCtx.fillStyle = color;
        solidCtx.fillRect(0, 0, 4, 4);
        solidTex.needsUpdate = true;
        if (screenMaterial.map !== solidTex) {
          screenMaterial.map = solidTex;
          screenMaterial.needsUpdate = true;
        }
      }

      video.addEventListener('canplay', () => {
        videoReady = true;
        // Someone clicked BMO before the file was buffered — honour it now
        // rather than making them click a third time.
        if (pendingVideoPlay && isFocusedOnBMO) playBMOVideo();
        pendingVideoPlay = false;
      });

      video.addEventListener('error', () => {
        console.error('Video failed to load:', video.error);
      });

      video.addEventListener('seeked', () => {
        if (video.paused && !isVideoPlaying) {
          screenMode = 'video';
          if (screenMaterial.map !== videoTex) {
            screenMaterial.map = videoTex;
            screenMaterial.needsUpdate = true;
          }
        }
      }, { once: true });

      let videoLoadStarted = false;
      function loadVideo() {
        if (videoLoadStarted) return;
        videoLoadStarted = true;
        video.preload = 'auto';
        // Seek once metadata exists. Setting currentTime immediately after
        // load() can be dropped, since readyState is still 0 at that point.
        video.addEventListener('loadedmetadata', () => {
          try { video.currentTime = 0.066; } catch (_) {}
        }, { once: true });
        video.load();
      }
      window._loadBMOVideo = loadVideo;

      // Warm the first frame up front so BMO's face is visible before he's
      // clicked. This only seeks to a paused frame — the 'seeked' handler
      // above swaps in videoTex, and playback still only starts on click.
      // Deferred to idle so the fetch/decode doesn't compete with shader
      // compilation during the first frames.
      // Timeout kept short: the old 3s ceiling meant an early click on BMO
      // hit a video that hadn't even started fetching.
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => loadVideo(), { timeout: 600 });
      } else {
        setTimeout(loadVideo, 400);
      }

      updateTV = null;
    }

    /* --- Alarm clock (Cube.026): the user's real local time --------------
       The clock imports as a group of two primitives — a near-black body and
       a small faceplate raised on one side. We find the faceplate by geometry
       rather than by name, because GLTFLoader names primitives after the glTF
       *mesh* ("Cube.034" here, not the node), and appends _1, _2... on
       collision — so those names shift whenever the export changes. A thin
       unlit plane sits just in front of the faceplate carrying the digits. */
    const clockRoot = model.getObjectByName('Cube026') || (() => {
      let found = null;
      model.traverse(o => { if (!found && /^cube[._ ]?026$/i.test(o.name || '')) found = o; });
      return found;
    })();

    if (!clockRoot) {
      console.warn('[clock] No object named "Cube026" found — skipping the time display.');
    } else {
      // Faceplate = the child whose local geometry starts furthest along +X,
      // i.e. the panel sitting proud of the body.
      let panel = null;
      let bestMinX = -Infinity;
      clockRoot.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        o.geometry.computeBoundingBox();
        const minX = o.geometry.boundingBox.min.x;
        if (minX > bestMinX) { bestMinX = minX; panel = o; }
      });

      if (!panel) {
        console.warn('[clock] "Cube026" has no mesh children — skipping the time display.');
      } else {
        model.updateWorldMatrix(true, true);
        const panelBox  = new THREE.Box3().setFromObject(panel);
        const panelSize = panelBox.getSize(new THREE.Vector3());
        const panelMid  = panelBox.getCenter(new THREE.Vector3());
        const rootMid   = new THREE.Box3().setFromObject(clockRoot).getCenter(new THREE.Vector3());

        // Thinnest axis is the one the display faces along; the sign is
        // whichever way the faceplate sits relative to the body's centre.
        const thin = panelSize.x <= panelSize.z ? 'x' : 'z';
        const wide = thin === 'x' ? 'z' : 'x';
        const dir  = Math.sign(panelMid[thin] - rootMid[thin]) || 1;

        const planeW = panelSize[wide] * 0.94;
        const planeH = panelSize.y * 0.90;

        const TEX_W = 512;
        const TEX_H = Math.max(64, Math.round(TEX_W * (planeH / planeW)));

        const cvs = document.createElement('canvas');
        cvs.width = TEX_W;
        cvs.height = TEX_H;
        const ctx = cvs.getContext('2d');

        // Seven-segment layout:  aaa / f b / ggg / e c / ddd
        const SEG_MAP = {
          '0': 'abcdef', '1': 'bc',     '2': 'abdeg',  '3': 'abcdg', '4': 'bcfg',
          '5': 'acdfg',  '6': 'acdefg', '7': 'abc',    '8': 'abcdefg', '9': 'abcdfg',
          ' ': ''
        };

        const fillSeg = (x, y, w, h, r) => {
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
          else ctx.rect(x, y, w, h);
          ctx.fill();
        };

        function drawDigit(ch, x, y, w, h) {
          const on = SEG_MAP[ch] || '';
          const t = w * 0.19;
          const half = h / 2;
          const r = t * 0.35;
          const segs = {
            a: [x + t * 0.5, y,                    w - t,      t],
            b: [x + w - t,   y + t * 0.5,          t,          half - t],
            c: [x + w - t,   y + half + t * 0.5,   t,          half - t],
            d: [x + t * 0.5, y + h - t,            w - t,      t],
            e: [x,           y + half + t * 0.5,   t,          half - t],
            f: [x,           y + t * 0.5,          t,          half - t],
            g: [x + t * 0.5, y + half - t * 0.5,   w - t,      t],
          };
          for (const key in segs) {
            if (on.indexOf(key) === -1) continue;
            const [sx, sy, sw, sh] = segs[key];
            fillSeg(sx, sy, sw, sh, r);
          }
        }

        // Respect the viewer's locale rather than assuming 12-hour.
        const CLOCK_12H = (() => {
          try {
            return new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
              .resolvedOptions().hour12 !== false;
          } catch (_) { return true; }
        })();

        let lastSignature = '';

        function drawClock(force) {
          const now = new Date();
          let hours = now.getHours();
          let suffix = '';
          if (CLOCK_12H) {
            suffix = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
          }
          // Leading zero is blanked on a 12-hour clock, kept on a 24-hour one.
          const hStr = CLOCK_12H
            ? (hours < 10 ? ' ' + hours : String(hours))
            : String(hours).padStart(2, '0');
          const mStr = String(now.getMinutes()).padStart(2, '0');
          const colonOn = now.getSeconds() % 2 === 0;

          const signature = hStr + mStr + suffix + (colonOn ? '1' : '0');
          if (!force && signature === lastSignature) return;   // no texture upload
          lastSignature = signature;

          // Reserve a column on the right for AM/PM, otherwise it sits on top
          // of the last digit.
          const suffixCol = suffix ? TEX_W * 0.15 : 0;
          const dh = TEX_H * 0.56;
          const dw = dh * 0.54;
          const gap = dw * 0.18;
          const colonW = dw * 0.32;
          const totalW = dw * 4 + gap * 4 + colonW;
          let x = (TEX_W - suffixCol - totalW) / 2;
          const y = (TEX_H - dh) / 2;

          ctx.clearRect(0, 0, TEX_W, TEX_H);
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
          ctx.shadowBlur = TEX_H * 0.05;

          drawDigit(hStr[0], x, y, dw, dh); x += dw + gap;
          drawDigit(hStr[1], x, y, dw, dh); x += dw + gap;

          if (colonOn) {
            const cw = colonW * 0.55;
            fillSeg(x + (colonW - cw) / 2, y + dh * 0.28 - cw / 2, cw, cw, cw * 0.3);
            fillSeg(x + (colonW - cw) / 2, y + dh * 0.72 - cw / 2, cw, cw, cw * 0.3);
          }
          x += colonW + gap;

          drawDigit(mStr[0], x, y, dw, dh); x += dw + gap;
          drawDigit(mStr[1], x, y, dw, dh);

          if (suffix) {
            ctx.shadowBlur = TEX_H * 0.03;
            ctx.font = `600 ${Math.round(TEX_H * 0.15)}px "Helvetica Neue", Arial, sans-serif`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(suffix, TEX_W - TEX_W * 0.035, TEX_H * 0.5);
          }

          clockTex.needsUpdate = true;
        }

        const clockTex = new THREE.CanvasTexture(cvs);
        clockTex.colorSpace      = THREE.SRGBColorSpace;
        clockTex.minFilter       = THREE.LinearFilter;
        clockTex.magFilter       = THREE.LinearFilter;
        clockTex.generateMipmaps = false;
        clockTex.anisotropy      = renderer.capabilities.getMaxAnisotropy();

        const clockMat = new THREE.MeshBasicMaterial({
          map: clockTex,
          transparent: true,
          toneMapped: false,
          depthWrite: false,
        });
        // Above 1.0 on purpose: the digits are drawn white and tinted here, so
        // they clear the bloom pass's 0.65 luminance threshold and pick up the
        // glow while still reading as amber rather than washing out to white.
        clockMat.color = new THREE.Color(1.9, 0.55, 0.30);

        const clockPlane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), clockMat);
        clockPlane.position.copy(panelMid);
        // Sit just proud of the faceplate so it can't z-fight with it.
        clockPlane.position[thin] = (dir > 0 ? panelBox.max[thin] : panelBox.min[thin]) + dir * 0.0015;
        clockPlane.rotation.y = thin === 'x'
          ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2)
          : (dir > 0 ? 0 : Math.PI);
        clockPlane.renderOrder = 2;
        clockPlane.castShadow = false;
        clockPlane.receiveShadow = false;

        /* Slide the display along its own face. Positive = the viewer's LEFT.
           The face normal crossed with world up gives that direction for any
           orientation the clock ends up in (for this +X-facing panel it works
           out to world +Z). Tune it live with window._clock.nudge(v) and put
           the value you settle on here. */
        const CLOCK_NUDGE = 0.035;
        const clockNormal = new THREE.Vector3();
        clockNormal[thin] = dir;
        const clockLeft = clockNormal.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
        const clockBasePos = clockPlane.position.clone();
        const applyClockNudge = (v) => {
          clockPlane.position.copy(clockBasePos).addScaledVector(clockLeft, v);
        };
        applyClockNudge(CLOCK_NUDGE);

        scene.add(clockPlane);

        drawClock(true);

        // Polled a few times a second; drawClock only touches the texture when
        // the displayed string actually changes (twice a second, for the blink).
        let lastClockPoll = 0;
        updateClock = function () {
          const t = performance.now();
          if (t - lastClockPoll < 250) return;
          lastClockPoll = t;
          drawClock(false);
        };

        window._clock = {
          plane: clockPlane,
          panel,
          redraw: () => drawClock(true),
          // Absolute, not cumulative — call it repeatedly to dial it in.
          nudge: (v) => {
            applyClockNudge(v);
            console.log(`[clock] nudge ${v} — keep it by setting CLOCK_NUDGE = ${v} in main.js`);
          },
        };
        console.log(`[clock] Time display attached to "${panel.name}" ` +
                    `(${planeW.toFixed(3)} x ${planeH.toFixed(3)}, facing ${dir > 0 ? '+' : '-'}${thin}, ` +
                    `${CLOCK_12H ? '12h' : '24h'})`);
      }
    }

    const leftLeg =
      model.getObjectByName('leftLeg') ||
      model.getObjectByName('Leg.L') ||
      model.getObjectByName('leg_L') ||
      model.getObjectByName('thigh.L');

    const rightLeg =
      model.getObjectByName('rightLeg') ||
      model.getObjectByName('Leg.R') ||
      model.getObjectByName('leg_R') ||
      model.getObjectByName('thigh.R');

    if (!leftLeg || !rightLeg) {
      model.traverse((o) => { if (o.isBone) console.log('BONE:', o.name); });
      console.warn('Update the bone name strings for your rig.');
    }

    if (window._debugSkeleton) {
      const helper = new THREE.SkeletonHelper(model);
      scene.add(helper);
    }

    window._rig = {
      model,
      leftLeg,
      rightLeg,
      baseRotL: leftLeg ? leftLeg.rotation.clone() : null,
      baseRotR: rightLeg ? rightLeg.rotation.clone() : null
    };

    const FRAMING_EXCLUDE = /ground/i;
    const box = new THREE.Box3();
    model.traverse((obj) => {
      if (!obj.isMesh) return;
      if (FRAMING_EXCLUDE.test(obj.name)) return;
      const meshBox = new THREE.Box3().setFromObject(obj);
      if (!meshBox.isEmpty()) box.union(meshBox);
    });
    if (box.isEmpty()) box.setFromObject(model);

    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());

    controls.maxDistance = size * 1.8;

    // The DEFAULT view is the full isometric room. It is what a left click
    // anywhere (or Escape) returns to — but it is not where the site opens.
    defaultCameraPosition.copy(center.clone().add(new THREE.Vector3(size*1.1, size*0.4, size*1.1)));
    defaultControlsTarget.copy(center);

    /* The site opens on BMO's desk instead. This is deliberately expressed as
       a BMO focus rather than as its own special case: that one flag gives us
       the mouse-pan in the render loop, the click-to-open-the-desktop branch
       in the click handler, and the click-anywhere-to-leave rule, with no
       parallel code path to keep in sync. */
    focusCameraPosition.set(4.780, 2.841, -0.228);
    focusControlsTarget.set(-0.056, 2.599, -0.265);
    camera.position.copy(focusCameraPosition);
    controls.target.copy(focusControlsTarget);
    camera.lookAt(controls.target);
    // This pose sits within a whisker of the room-view polar limit, so free
    // the clamp before controls.update() gets a chance to shove it.
    freeOrbitLimits(true);
    controls.update();

    isFocusedOnBMO = true;
    isIntroView = true;
    viewState = VIEW_INTRO;
    controls.enabled = false;
    lastPanTime = performance.now();
    // Same preparation a click on BMO does, so the first click opens the
    // desktop rather than having to set this up first.
    if (window._loadBMOVideo) window._loadBMOVideo();
    if (tvScreenMesh) registerClickable(tvScreenMesh);

    dismissLoadingScreen();
    dracoLoader.dispose();
    warmAudio();
  },
  (xhr) => {
    const bar = document.getElementById('loadingBarFill');
    const pct = document.getElementById('loadingPercent');
    const ESTIMATED_GLB_BYTES = 26_766_960;
    const total = (xhr && xhr.lengthComputable && xhr.total > 0)
      ? xhr.total
      : ESTIMATED_GLB_BYTES;
    const ratio = Math.min(1, (xhr?.loaded || 0) / total);
    const percent = Math.round(ratio * 100);
    if (bar) bar.style.width = percent + '%';
    if (pct) pct.textContent = percent + '%';
  },
  (error) => {
    console.error('GLTF load error:', error);
    const title = loadingScreen.querySelector('.loading-title');
    const tip   = loadingScreen.querySelector('.loading-tip');
    if (title) title.textContent = 'failed to load scene';
    if (tip)   tip.textContent   = 'check the console';
    if (loadingTipInterval) {
      clearInterval(loadingTipInterval);
      loadingTipInterval = null;
    }
  }
);
}

const fpsDisplay = document.createElement('div');
fpsDisplay.style.cssText = `
  position: fixed;
  top: 12px;
  left: 12px;
  background: rgba(0,0,0,0.55);
  color: #c9f4df;
  font-family: 'Minecraftia', 'Courier New', monospace;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  letter-spacing: 1px;
  z-index: 99998;
  pointer-events: none;
  border: 1px solid rgba(201,244,223,0.25);
`;
fpsDisplay.textContent = 'FPS: --';
// document.body.appendChild(fpsDisplay);

let fpsFrameCount = 0;
let fpsLastTime = performance.now();

// --- Adaptive performance ---------------------------------------------------
// This used to average FPS over the first 3 seconds of PAGE LIFE and remove
// the bloom pass outright if it came in under 45. Those 3 seconds are the GLB
// fetch, the DRACO decode, shader compilation and the first texture uploads —
// on a cold load the average lands under 45 for reasons that say nothing about
// how fast the GPU is, and BMO's screen lost its glow for the whole session. A
// warm reload measured an already-cached scene, cleared the bar, and kept the
// bloom. That's why the glow came and went between loads.
//
// Now the sample waits for the scene to be up and warm, throws out hitch
// frames, refuses to measure a backgrounded tab, and steps quality down in
// stages so bloom is the LAST thing dropped rather than the first.
let perfMode = false;
let perfStage = 0;              // 0 = full, 1 = reduced render scale, 2 = no bloom
let perfSamplingDone = false;
let perfWarmupStart = 0;
let perfLastFrame   = 0;
let perfFrames      = 0;
let perfElapsed     = 0;        // ms of non-hitch frame time
const PERF_WARMUP_MS = 1200;    // let shader compilation and first paints settle
const PERF_SAMPLE_MS = 3000;    // measure over this much clean frame time
const PERF_HITCH_MS  = 100;     // a frame longer than this is not a GPU verdict

function resetPerfSample() {
  perfWarmupStart = 0;
  perfLastFrame = 0;
  perfFrames = 0;
  perfElapsed = 0;
}

/* Stage 1: render fewer pixels, keep the look. */
function reduceRenderScale() {
  perfMode = true;
  perfStage = 1;
  const scale = Math.min(window.devicePixelRatio, 1.0) * 0.75;
  renderer.setPixelRatio(scale);
  composer.setPixelRatio(scale);
  bloomPass.setSize(Math.floor(window.innerWidth / 3), Math.floor(window.innerHeight / 3));
  fpsDisplay.title = 'performance mode: reduced render scale (bloom kept)';
  console.log(`[perf] Low FPS — render scale dropped to ${scale.toFixed(2)}, bloom kept`);
}

/* Stage 2: last resort, and only for hardware that stayed slow even at the
   reduced render scale. */
function disableBloom() {
  perfMode = true;
  perfStage = 2;
  composer.removePass(bloomPass);
  fpsDisplay.title = 'performance mode: bloom off';
  console.log('[perf] Still slow after the render-scale drop — bloom removed');
}

function checkAdaptivePerf(now) {
  if (perfSamplingDone) return;

  // Nothing worth measuring until the scene is actually on screen. A hidden
  // tab throttles requestAnimationFrame to a crawl, which is not a slow GPU
  // either — that alone used to be enough to kill the glow.
  if (!appReady || document.hidden) { resetPerfSample(); return; }

  if (!perfWarmupStart) { perfWarmupStart = now; perfLastFrame = now; return; }
  if (now - perfWarmupStart < PERF_WARMUP_MS) { perfLastFrame = now; return; }

  const frameMs = now - perfLastFrame;
  perfLastFrame = now;
  // Hitch: a stall from a late texture upload, GC, or the tab being away.
  // Counting it would let one 300ms frame decide the whole verdict.
  if (frameMs <= 0 || frameMs > PERF_HITCH_MS) return;

  perfFrames++;
  perfElapsed += frameMs;
  if (perfElapsed < PERF_SAMPLE_MS) return;

  const avgFps = (perfFrames * 1000) / perfElapsed;
  console.log(`[perf] Steady-state avg FPS (stage ${perfStage}): ${avgFps.toFixed(1)}`);

  if (perfStage === 0) {
    if (avgFps >= 45) { perfSamplingDone = true; return; }
    reduceRenderScale();
    resetPerfSample();   // re-measure before touching the bloom
    return;
  }

  perfSamplingDone = true;
  if (avgFps < 40) disableBloom();
}

function updateFPS() {
  fpsFrameCount++;
  const now = performance.now();
  const elapsed = now - fpsLastTime;
  if (elapsed >= 1000) {
    const fps = Math.round((fpsFrameCount * 1000) / elapsed);
    const color = fps >= 50 ? '#c9f4df' : fps >= 30 ? '#f4e0a0' : '#f47a7a';
    fpsDisplay.style.color = color;
    fpsDisplay.textContent = `FPS: ${fps}${perfMode ? ' (perf)' : ''}`;
    fpsFrameCount = 0;
    fpsLastTime = now;
  }
}

function animate() {
  requestAnimationFrame(animate);
  updateFPS();
  checkAdaptivePerf(performance.now());

  if (updateTV) updateTV();
  if (updateClock) updateClock();

  if (paperMaterial) {
    paperMaterial.uniforms.uTime.value = performance.now() * 0.001;
  }

  if (dustMaterial.opacity > 0.01) {
    const arr = dustGeo.attributes.position.array;
    const t = performance.now() * 0.001;
    for (let i = 0; i < DUST_COUNT; i++) {
      const ix = i * 3;
      arr[ix    ] += dustVelocities[ix    ] * 0.016 + Math.sin(t + dustSeeds[i]) * 0.0008;
      arr[ix + 1] += dustVelocities[ix + 1] * 0.016;
      arr[ix + 2] += dustVelocities[ix + 2] * 0.016 + Math.cos(t + dustSeeds[i]) * 0.0008;
      if (arr[ix + 1] >  2.6) arr[ix + 1] = 0;
      if (arr[ix    ] >  2.0) arr[ix    ] = -2.0;
      if (arr[ix    ] < -2.0) arr[ix    ] =  2.0;
      if (arr[ix + 2] >  2.0) arr[ix + 2] = -2.0;
      if (arr[ix + 2] < -2.0) arr[ix + 2] =  2.0;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  if (steamReady) {
    const pos     = steamGeo.attributes.position.array;
    const lifeArr = steamGeo.attributes.aLife.array;
    const dt = 0.016;
    const t  = performance.now() * 0.001;
    const globalDriftX = Math.sin(t * 0.5) * 0.6;  // shared phase, slow drift
    const globalDriftZ = Math.cos(t * 0.4) * 0.6;
    for (let i = 0; i < STEAM_COUNT; i++) {
      const ix = i * 3;
      lifeArr[i] += dt * 0.22;
      if (lifeArr[i] >= 1.0) lifeArr[i] -= 1.0;

      const life  = lifeArr[i];
      const seed  = steamSeeds[i];
      const widen = 0.4 + life * 1.1;
      const phase = life * STEAM_WAVE_FREQ + seed + globalDriftX;
      pos[ix    ] = steamOrigin.x + Math.sin(phase) * STEAM_WAVE_AMP * widen;
      pos[ix + 1] = steamOrigin.y + life * STEAM_RISE_HEIGHT;
      pos[ix + 2] = steamOrigin.z + Math.cos(phase * 0.9 + globalDriftZ) * STEAM_WAVE_AMP * 0.6 * widen;
    }
    steamGeo.attributes.position.needsUpdate = true;
    steamGeo.attributes.aLife.needsUpdate    = true;
  }

  if (window._rig?.leftLeg && window._rig?.rightLeg) {
    const { leftLeg, rightLeg, baseRotL, baseRotR } = window._rig;
    const t = performance.now() * 0.002;
    const angle = Math.sin(t) * 0.05;
    leftLeg.rotation.set(baseRotL.x, baseRotL.y + angle, baseRotL.z);
    rightLeg.rotation.set(baseRotR.x, baseRotR.y - angle, baseRotR.z);
  }

  // Pan first, so the focus flight below aims at the panned goal too.
  const framePanNow = performance.now();
  const framePanDt = Math.min((framePanNow - lastPanTime) / 1000, 0.1);
  lastPanTime = framePanNow;
  if (isFocusedOnBMO && !isEscapeAnimating) {
    updateBmoPan(framePanDt);
  } else {
    bmoParallaxCurrent.set(0, 0, 0);
    bmoParallaxTarget.set(0, 0, 0);
    bmoParallaxVelocity.set(0, 0, 0);
  }

  animateObjectFocus();

  if (isFocusedOnBMO && !isFocusingObject && !isEscapeAnimating) {
    controls.enabled = false;
    // Damped rather than hard-set. animateObjectFocus flies to the SAME panned
    // goal, so when it hands over there is no discontinuity — that handover
    // used to land the camera on the un-panned pose and then slide it to meet
    // the cursor, which is what read as a snap on the way in.
    camera.position.x = THREE.MathUtils.damp(camera.position.x, focusCameraPosition.x + bmoParallaxCurrent.x, BMO_HOLD_SMOOTHNESS, framePanDt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, focusCameraPosition.y + bmoParallaxCurrent.y, BMO_HOLD_SMOOTHNESS, framePanDt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, focusCameraPosition.z + bmoParallaxCurrent.z, BMO_HOLD_SMOOTHNESS, framePanDt);
    _panLookAt.copy(focusControlsTarget).add(bmoParallaxCurrent);
    camera.lookAt(_panLookAt);
  } else {
    if (!isEscapeAnimating && !isFocusingObject) controls.update();
  }

  const transitioning = isFocusingObject || isEscapeAnimating;

  // Outlines are off entirely once you're zoomed into BMO or reading the
  // desktop — a glowing halo around the screen you're trying to read.
  outlinePass.enabled = !transitioning && !isFocusedOnBMO && !isBrowsingScreen &&
    outlinePass.selectedObjects.length > 0;

  composer.render();
  // Only costs anything while the iframe is actually mounted.
  if (isBrowsingScreen) layoutScreenOverlay();
}
animate();

function animateEscape() {
  if (!isEscapeAnimating) return;

  const now = performance.now();
  const delta = (now - lastEscapeTime) / 1000;
  lastEscapeTime = now;
  const smoothness = 5;

  camera.position.x = THREE.MathUtils.damp(camera.position.x, defaultCameraPosition.x, smoothness, delta);
  camera.position.y = THREE.MathUtils.damp(camera.position.y, defaultCameraPosition.y, smoothness, delta);
  camera.position.z = THREE.MathUtils.damp(camera.position.z, defaultCameraPosition.z, smoothness, delta);
  controls.target.x = THREE.MathUtils.damp(controls.target.x, defaultControlsTarget.x, smoothness, delta);
  controls.target.y = THREE.MathUtils.damp(controls.target.y, defaultControlsTarget.y, smoothness, delta);
  controls.target.z = THREE.MathUtils.damp(controls.target.z, defaultControlsTarget.z, smoothness, delta);

  // No controls.update() while we're driving the camera by hand: it re-clamps
  // polar angle / distance every frame and re-applies damped drag inertia,
  // both of which fight the damp above.
  camera.lookAt(controls.target);

  const cameraDone = camera.position.distanceTo(defaultCameraPosition) < 0.01;
  const targetDone = controls.target.distanceTo(defaultControlsTarget) < 0.01;

  if (cameraDone && targetDone) {
    camera.position.copy(defaultCameraPosition);
    controls.target.copy(defaultControlsTarget);
    camera.lookAt(controls.target);
    // Back in the room: the normal orbit limits apply again.
    freeOrbitLimits(false);
    controls.update();
    isEscapeAnimating = false;
    controls.enabled = true;
    selectedObject = null;
    outlinePass.selectedObjects = [];
    // Back at the room view: if the cursor is genuinely on BMO again (and the
    // user has moved it since we pulled out), dive straight back in.
    evaluateHoverFocus();
    return;
  }

  requestAnimationFrame(animateEscape);
}

window.addEventListener('beforeunload', () => {
  renderer.setAnimationLoop(null);
  composer.passes.forEach(pass => { if (pass.dispose) pass.dispose(); });
  composerTarget.dispose();
  bulbMesh.geometry.dispose();
  bulbMesh.material.dispose();
  deskLampBulbMesh.geometry.dispose();
  deskLampBulbMesh.material.dispose();
  if (tvScreenMesh?.material?.map) tvScreenMesh.material.map.dispose();
  if (window._beam?.material) window._beam.material.dispose();
  renderer.dispose();
});

let resizePending = false;
window.addEventListener('resize', () => {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => {
    resizePending = false;
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    composer.setSize(width, height);
    composerTarget.setSize(width, height);

    outlinePass.setSize(width, height);
    const bloomDiv = perfStage >= 1 ? 3 : 2;
    bloomPass.setSize(Math.floor(width / bloomDiv), Math.floor(height / bloomDiv));
    if (screenOverlay) layoutScreenOverlay();
  });
});

window.addEventListener('keydown', (event) => {
  // Browsing the screen: Escape steps back out instead of the normal path.
  if (event.key === 'Escape' && isBrowsingScreen) {
    exitBrowseAndZoomOut();
    return;
  }
  // The intro video locks out scene clicks while it runs, so Escape has to be
  // able to bail out of it — otherwise you're stuck until it finishes.
  if (event.key === 'Escape' && isVideoPlaying && tvVideo) {
    tvVideo.pause();      // the 'pause' listener clears isVideoPlaying
    isVideoPlaying = false;
    pendingVideoPlay = false;
  }
  // The browsing case returned above, so this covers everything else —
  // including a flight into the desktop that the user changed their mind about.
  if (event.key === 'Escape' && !isEscapeAnimating && !helpOpen && !isVideoPlaying) {
    returnToRoomView();
  }
});

function focusOnObject(object) {
  isEscapeAnimating = false;
  // Drop any stale "when this move finishes, open the desktop" callback left
  // over from an interrupted BMO sequence.
  onFocusComplete = null;

  let presetTarget = focusPresets[object.name] ? object : null;
  if (!presetTarget) {
    object.traverse(o => {
      if (!presetTarget && focusPresets[o.name]) presetTarget = o;
    });
  }
  const preset = presetTarget ? focusPresets[presetTarget.name] : null;
  const subject = presetTarget || object;

  const box = new THREE.Box3().setFromObject(subject);
  const center = box.getCenter(new THREE.Vector3());

  if (preset) {
    focusControlsTarget.copy(center).add(preset.targetOffset);
    focusCameraPosition.copy(center).add(preset.cameraOffset);
  } else {
    const size = box.getSize(new THREE.Vector3()).length();
    const direction = camera.position.clone().sub(controls.target).normalize();
    const distance = Math.max(size * 2.5, 4);
    focusControlsTarget.copy(center);
    focusCameraPosition.copy(center).add(direction.multiplyScalar(distance));
  }

  console.log('Clicked object:', object.name || object.type,
              preset ? `(using preset on "${presetTarget.name}")` : '(no preset)');
  console.log('Subject center:', center);
  console.log('Focus target:', focusControlsTarget);
  console.log('Camera position:', focusCameraPosition);

  isFocusingObject = true;
  lastFocusTime = performance.now();
  focusAnimStartTime = performance.now();
  controls.enabled = false;
  beginCameraTransition();
}

/* A single BMO camera position, used for both clicking him and for opening
   the screen. Previously the click framed his body and the screen zoom moved
   somewhere else, so there was always a second move to snap through. One
   anchor (the screen centre), one axis, one distance — so the camera arrives
   once and never moves again. */
const BMO_VIEW_DIR = new THREE.Vector3(1, 0, 0);
const BMO_INTRO_DISTANCE  = 2.061;  // click BMO — wide desk framing
const BMO_SCREEN_DISTANCE = 0.55;   // after the video — settles onto the screen

function focusOnBmoAxis(distance) {
  if (!tvScreenMesh) return false;
  onFocusComplete = null;

  const box = new THREE.Box3().setFromObject(tvScreenMesh);
  const center = box.getCenter(new THREE.Vector3());

  focusControlsTarget.copy(center);
  focusCameraPosition.copy(center)
    .addScaledVector(BMO_VIEW_DIR.clone().normalize(), distance);

  isEscapeAnimating = false;
  isFocusingObject = true;
  lastFocusTime = performance.now();
  focusAnimStartTime = performance.now();
  controls.enabled = false;
  beginCameraTransition();
  return true;
}

/* Mouse-driven look around the desk. Camera AND look-at move together, so the
   framing trucks sideways — mouse right reveals the bookshelf, mouse down
   reveals more desk — rather than pivoting on a fixed point.

   It eases to zero (never snaps) the moment the desktop iframe is mounted or
   the intro video plays. A view that drifts under the cursor is exactly what
   made the old parallax impossible to click through, and the 2D site has to
   stay clickable. */
function computeBmoPanTarget(out) {
  out.set(0, 0, 0);
  // No pan in the BMO view: the iframe must not drift under the cursor.
  if (viewState === VIEW_BMO || isBrowsingScreen || isVideoPlaying) return out;

  // Basis taken from the DESTINATION pose, not camera.quaternion. During a
  // flight the camera still carries the old orientation, and priming the pan
  // from that would aim the zoom at the wrong place.
  const reach = focusCameraPosition.distanceTo(focusControlsTarget);
  _bmoForward.subVectors(focusCameraPosition, focusControlsTarget).normalize();
  _bmoRight.crossVectors(WORLD_UP, _bmoForward).normalize();
  _bmoUp.crossVectors(_bmoForward, _bmoRight).normalize();

  return out
    .addScaledVector(_bmoRight, mouseNDC.x * BMO_PAN_X_FRACTION * reach)
    .addScaledVector(_bmoUp,    mouseNDC.y * BMO_PAN_Y_FRACTION * reach);
}

function updateBmoPan(dt) {
  computeBmoPanTarget(bmoParallaxTarget);
  bmoParallaxCurrent.x = THREE.MathUtils.damp(bmoParallaxCurrent.x, bmoParallaxTarget.x, BMO_PAN_SMOOTHNESS, dt);
  bmoParallaxCurrent.y = THREE.MathUtils.damp(bmoParallaxCurrent.y, bmoParallaxTarget.y, BMO_PAN_SMOOTHNESS, dt);
  bmoParallaxCurrent.z = THREE.MathUtils.damp(bmoParallaxCurrent.z, bmoParallaxTarget.z, BMO_PAN_SMOOTHNESS, dt);
}

function animateObjectFocus() {
  if (!isFocusingObject) return;

  const now = performance.now();
  const delta = Math.min((now - lastFocusTime) / 1000, 0.1); // clamp delta to avoid huge jumps
  lastFocusTime = now;
  const smoothness = 5;

  // Fly to the panned goal when a BMO view is the destination. Aiming at the
  // un-panned pose and letting the pan take over on arrival is what produced
  // the snap-to-the-mouse on the way in.
  /* Aim at the SMOOTHED pan, never the raw target.

     Three things were tried here, so the reasoning is worth keeping:

       1. Aim un-panned, and let the hold hard-set the panned pose on arrival.
          The camera landed centred and then jumped the full offset — the
          original "zoom in, then snap to the mouse".
       2. Snap the accumulator to the mouse when the pose is set (primeBmoPan),
          so the goal is right from frame one. Fine zooming in, but zooming OUT
          of the BMO view the pan is forced to 0, so the accumulator jumped 0 →
          full offset in a single frame and the goal lurched sideways.
       3. Aim at the raw target. Stable across a transition, but the target
          follows the mouse with no smoothing at all, so flicking the pointer
          mid-flight yanked the goal — the snap when you leave the face and
          dart to his body.

     The accumulator is the answer to all three: it is continuous by
     construction, so it can't jump on a state change, and it damps (~330ms)
     so it can't be yanked. The hold damps toward the same value, which is what
     makes the handover seamless — that, not the priming, was the real fix. */
  _focusGoalPos.copy(focusCameraPosition);
  _focusGoalTgt.copy(focusControlsTarget);
  if (isFocusedOnBMO) {
    _focusGoalPos.add(bmoParallaxCurrent);
    _focusGoalTgt.add(bmoParallaxCurrent);
  }

  camera.position.x = THREE.MathUtils.damp(camera.position.x, _focusGoalPos.x, smoothness, delta);
  camera.position.y = THREE.MathUtils.damp(camera.position.y, _focusGoalPos.y, smoothness, delta);
  camera.position.z = THREE.MathUtils.damp(camera.position.z, _focusGoalPos.z, smoothness, delta);
  controls.target.x = THREE.MathUtils.damp(controls.target.x, _focusGoalTgt.x, smoothness, delta);
  controls.target.y = THREE.MathUtils.damp(controls.target.y, _focusGoalTgt.y, smoothness, delta);
  controls.target.z = THREE.MathUtils.damp(controls.target.z, _focusGoalTgt.z, smoothness, delta);

  // Deliberately no controls.update() here — see animateEscape.
  camera.lookAt(controls.target);

  // Against the (possibly moving) goal, with a little more tolerance than the
  // static case: while the mouse is moving the camera trails the pan slightly
  // and a 0.01 threshold would never be met.
  const cameraDone = camera.position.distanceTo(_focusGoalPos) < 0.02;
  const targetDone = controls.target.distanceTo(_focusGoalTgt) < 0.02;
  // Safety net only. It should never be what ends the move now that the orbit
  // clamp isn't holding the camera short of the goal — if it does fire, the
  // final copy() below is a visible snap.
  const timedOut = (now - focusAnimStartTime) > 3000;

  if ((cameraDone && targetDone) || timedOut) {
    if (timedOut && !cameraDone) {
      console.warn('[focus] timed out short of target by',
                   camera.position.distanceTo(focusCameraPosition).toFixed(3));
    }
    // A BMO view is held by a damper that keeps running, so snapping the
    // camera onto the pose here would undo the whole point. Only the static
    // focuses land exactly.
    if (!isFocusedOnBMO) {
      camera.position.copy(focusCameraPosition);
    }
    controls.target.copy(focusControlsTarget);
    camera.lookAt(isFocusedOnBMO ? _focusGoalTgt : controls.target);
    controls.update();
    isFocusingObject = false;
    controls.enabled = true;
    if (onFocusComplete) {
      const callback = onFocusComplete;
      onFocusComplete = null;
      callback();
    }
  }
}

function logCurrentViewForObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const cameraOffset = camera.position.clone().sub(center);
  const targetOffset = controls.target.clone().sub(center);
  console.log(`
${object.name}: {
  cameraOffset: new THREE.Vector3(${cameraOffset.x.toFixed(3)}, ${cameraOffset.y.toFixed(3)}, ${cameraOffset.z.toFixed(3)}),
  targetOffset: new THREE.Vector3(${targetOffset.x.toFixed(3)}, ${targetOffset.y.toFixed(3)}, ${targetOffset.z.toFixed(3)})
}
`);
}

/* K — dump the exact camera pose you're currently looking from, as a
   paste-ready snippet. The companion to L: L gives you offsets relative to a
   selected object (for focusPresets), K gives you the absolute pose. */
function logCameraPose() {
  const p = camera.position;
  const t = controls.target;
  const offset = p.clone().sub(t);
  const sph = new THREE.Spherical().setFromVector3(offset);
  const deg = (r) => THREE.MathUtils.radToDeg(r).toFixed(1);

  const snippet =
`camera.position.set(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)});
controls.target.set(${t.x.toFixed(3)}, ${t.y.toFixed(3)}, ${t.z.toFixed(3)});`;

  // Polar angle matters: a pose outside the room-view limits can't be reached
  // by controls.update(), which is what made focus moves end in a hard snap.
  const outOfRange = sph.phi < ORBIT_MIN_POLAR || sph.phi > ORBIT_MAX_POLAR;
  const limits = `orbit limits ${deg(ORBIT_MIN_POLAR)}deg..${deg(ORBIT_MAX_POLAR)}deg`;

  console.log(
`--- camera pose ---
${snippet}
distance ${sph.radius.toFixed(3)} | azimuth ${deg(sph.theta)}deg | polar ${deg(sph.phi)}deg
${outOfRange ? `WARNING: polar is OUTSIDE the room-view ${limits} — fine as a focus pose (limits are lifted for those), but the free-orbit camera can never sit here.` : `within the room-view ${limits}`}
${selectedObject ? `selected: ${selectedObject.name || selectedObject.type} (press L for an offset preset)` : 'nothing selected'}`);

  // Zoom here is dolly distance (above) — OrbitControls moves a perspective
  // camera rather than touching camera.zoom/fov. Nothing writes these today,
  // so they're only worth printing if that ever changes.
  if (camera.zoom !== 1 || camera.fov !== 30) {
    console.log(`projection zoom ${camera.zoom.toFixed(3)} | fov ${camera.fov.toFixed(1)}deg`);
  }

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(snippet).catch(() => {});
  }

  tipBar.innerText = `camera pose logged to console (dist ${sph.radius.toFixed(2)})`;
  tipBar.style.opacity = '1';
  if (tipBar.fadeTimeout) clearTimeout(tipBar.fadeTimeout);
  tipBar.fadeTimeout = setTimeout(() => { tipBar.style.opacity = '0'; }, 2000);
}
window.logCameraPose = logCameraPose;

window.addEventListener('keydown', (event) => {
  // Don't hijack browser shortcuts or typing in a field.
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const el = event.target;
  if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName || ''))) return;

  const key = event.key.toLowerCase();

  if (key === 'l') {
    if (!selectedObject) { console.log('No object selected.'); return; }
    logCurrentViewForObject(selectedObject);
  }

  if (key === 'k') logCameraPose();
});

function downsampleTextures(model, maxPx = 1024, protectRoots = []) {
  const seen = new Set();
  const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'];

  const protectedUUIDs = new Set();
  protectRoots.forEach(root => {
    if (!root) return;
    root.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(mat => {
        TEXTURE_SLOTS.forEach(slot => { if (mat[slot]) protectedUUIDs.add(mat[slot].uuid); });
      });
    });
  });

  const queue = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(mat => {
      TEXTURE_SLOTS.forEach(slot => {
        const tex = mat[slot];
        if (!tex || seen.has(tex.uuid)) return;
        seen.add(tex.uuid);
        if (protectedUUIDs.has(tex.uuid)) return;
        const img = tex.image;
        if (!img || !img.width) return;
        if (img.width <= maxPx && img.height <= maxPx) return;
        queue.push(tex);
      });
    });
  });

  if (queue.length === 0) return;

  const schedule = window.requestIdleCallback
    ? (cb) => window.requestIdleCallback(cb, { timeout: 500 })
    : (cb) => requestAnimationFrame(cb);

  function processNext() {
    const tex = queue.shift();
    if (!tex) return;
    const img = tex.image;
    if (img && img.width && (img.width > maxPx || img.height > maxPx)) {
      const scale = maxPx / Math.max(img.width, img.height);
      const w = Math.max(1, Math.round(img.width  * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cvs = document.createElement('canvas');
      cvs.width = w;
      cvs.height = h;
      cvs.getContext('2d').drawImage(img, 0, 0, w, h);
      tex.image = cvs;
      tex.needsUpdate = true;
    }
    if (queue.length) schedule(processNext);
  }

  schedule(processNext);
}

function normalizeMeshUVs(mesh) {
  const uv = mesh.geometry.attributes.uv;
  if (!uv) return;

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;

  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }

  const rangeU = maxU - minU, rangeV = maxV - minV;

  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - minU) / rangeU, (uv.getY(i) - minV) / rangeV);
  }

  uv.needsUpdate = true;
}

/* Mounts /bmo_desktop as a live iframe sitting exactly on the screen mesh.
   The mesh switches to a depth-only material so it renders no colour but
   still occludes correctly — BMO's body hides the iframe when you orbit. */
/* ============================================================================
   Screen audio — one track, two ways of hearing it.

   The music lives on BMO. From the room you should hear it the way you'd hear
   a small speaker across a room: no bass, a honky mid-range peak, a bit of
   grit from a cone being driven too hard, and positioned in 3D. Move in to the
   screen and it should open out into clean, centred stereo, as if you'd put
   headphones on.

   Both are fed from ONE MediaElementSource — createMediaElementSource can only
   ever be called once per element — split into two parallel chains whose gains
   crossfade. Nothing is rebuilt or reconnected on a view change, so there is
   nothing to click or pop.

              ┌─ hp → peak → saturate → lp → speakerGain → panner ─┐
     source ──┤                                                    ├─→ listener
              └─ directGain ──────────────────────────────────────-┘
                             (bypasses the panner entirely)

   The track is owned here rather than inside the iframe because Web Audio can
   only process an element from its own document; the desktop's mini-player
   drives it over postMessage. ========================================== */

const SCREEN_MUSIC_URL = '/hotel.wav';
const SCREEN_MUSIC_VOLUME = 0.32;
/* Trim on the speaker path per view. The panner already attenuates by
   distance, but the desk framing puts your ear about a foot from the thing,
   where the raw distance curve is louder than it wants to be. */
const SPEAKER_LEVEL_ROOM = 1.0;
const SPEAKER_LEVEL_DESK = 0.55;
let screenAudio = null;

/* Soft-clip curve for the cone-being-overdriven grit. tanh-shaped: linear in
   the middle, compressing towards the rails, so quiet passages stay clean and
   only peaks distort. */
function makeSaturationCurve(drive = 2.2, samples = 2048) {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
  }
  return curve;
}

/* Ramp an AudioParam from wherever it actually is right now.
   cancelScheduledValues() on its own leaves the param snapping back to the
   last explicitly-set value, which is precisely the click this is avoiding —
   so read the live value first and anchor it at `now`. */
function rampParam(param, target, duration, ctx) {
  const now = ctx.currentTime;
  const current = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  param.linearRampToValueAtTime(target, now + Math.max(0.01, duration));
}

function initScreenAudio() {
  if (screenAudio) return screenAudio;

  const listener = new THREE.AudioListener();
  camera.add(listener);                 // rides the camera, so 3D pans follow the view
  const ctx = listener.context;

  const el = new Audio(SCREEN_MUSIC_URL);
  el.loop = true;
  el.volume = SCREEN_MUSIC_VOLUME;
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';

  const source = ctx.createMediaElementSource(el);

  // ---- Speaker path -------------------------------------------------------
  // Bass roll-off: a 2" cone simply cannot move enough air below ~350Hz.
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 360;
  highpass.Q.value = 0.7;

  // The boxy resonance that makes a small enclosure sound like one.
  const midPeak = ctx.createBiquadFilter();
  midPeak.type = 'peaking';
  midPeak.frequency.value = 1900;
  midPeak.Q.value = 1.6;
  midPeak.gain.value = 7.5;

  const saturator = ctx.createWaveShaper();
  saturator.curve = makeSaturationCurve(2.2);
  saturator.oversample = '2x';          // no aliasing from the harmonics we add

  // Top-end roll-off — cheap drivers give up long before 20kHz.
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 4200;
  lowpass.Q.value = 0.6;

  const speakerGain = ctx.createGain();
  speakerGain.gain.value = 1;           // the room view is where we start

  source.connect(highpass);
  highpass.connect(midPeak);
  midPeak.connect(saturator);
  saturator.connect(lowpass);
  lowpass.connect(speakerGain);

  // three's PositionalAudio owns the panner and keeps it glued to the mesh it
  // is added to; setNodeSource lets our filtered chain be its input.
  const positional = new THREE.PositionalAudio(listener);
  positional.setNodeSource(speakerGain);
  positional.setDistanceModel('exponential');
  positional.setRefDistance(0.8);
  positional.setRolloffFactor(1.4);
  (tvScreenMesh || bmoObject || scene).add(positional);

  // ---- Direct path --------------------------------------------------------
  // Straight to the listener's input: no panner, no filters, so it stays
  // centred and full-range no matter where the camera is.
  const directGain = ctx.createGain();
  directGain.gain.value = 0;
  source.connect(directGain);
  directGain.connect(listener.getInput());

  screenAudio = {
    el, ctx, listener, source, positional,
    speakerGain, directGain,
    filters: { highpass, midPeak, saturator, lowpass },
    perspective: 'speaker',
  };
  window._audio = screenAudio;
  console.log('[audio] graph ready — speaker + direct paths');
  return screenAudio;
}

/* Crossfade between the two ways of hearing it.
   mode: 'speaker' (in the room) | 'direct' (on the screen). */
function setAudioPerspective(mode, duration = 0.9, speakerLevel = SPEAKER_LEVEL_ROOM) {
  const a = screenAudio;
  if (!a) return;
  const toDirect = mode === 'direct';
  // Linear, not equal-power: the two paths carry the SAME signal, so they sum
  // coherently and a linear fade holds the level steady. An equal-power curve
  // would bulge in the middle of the transition.
  rampParam(a.speakerGain.gain, toDirect ? 0 : speakerLevel, duration, a.ctx);
  rampParam(a.directGain.gain,  toDirect ? 1 : 0, duration, a.ctx);
  a.perspective = mode;
}

function screenMusicPlaying() {
  return !!(screenAudio && !screenAudio.el.paused);
}

function setScreenMusic(action) {
  const a = initScreenAudio();
  if (a.ctx.state === 'suspended') a.ctx.resume().catch(() => {});
  const wantPlay = action === 'play' || (action === 'toggle' && a.el.paused);
  if (wantPlay) a.el.play().catch(() => {});
  else a.el.pause();
  return !a.el.paused;
}

/* The desktop's mini-player lives in the iframe and can't reach the graph, so
   it asks for playback over postMessage and we answer with the new state. */
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (!screenIframe || event.source !== screenIframe.contentWindow) return;
  const msg = event.data;
  if (!msg || msg.source !== 'bmo-desktop' || msg.type !== 'music') return;

  const playing = setScreenMusic(msg.action);
  event.source.postMessage(
    { source: 'bmo-host', type: 'music-state', playing },
    window.location.origin
  );
});

/* The 2D site as a FLAT, untransformed overlay.

   It used to be a CSS3DObject transformed onto the screen plane. That renders
   beautifully and is completely unclickable here: CSS3DRenderer nests the
   object under domElement > viewElement > cameraElement with a perspective and
   `transform-style: preserve-3d`, and Chrome hit-tests straight past that
   subtree — document.elementFromPoint over the middle of the site returned
   first <body>, then (once every level was made interactive) the CSS3D root
   div, never the iframe. The site was mounted, visible and running, and could
   not receive a single click.

   It does not need a 3D transform. The BMO view is locked dead-on to the
   screen along (1,0,0) with the pan disabled, so the screen projects to a
   plain axis-aligned rectangle. Position an ordinary fixed-position iframe on
   that rectangle and it is pixel-accurate and trivially clickable.

   The iframe is created once and only ever hidden, never reparented —
   reparenting an iframe reloads its document and would lose your place. */
/* The site renders at a FIXED logical size and is scaled to whatever the
   screen projects to, rather than laying out against the raw pixel rect.

   The rect changes with the window size and the zoom distance, so letting the
   site lay out against it directly meant its viewport was some arbitrary size
   nothing was designed for — cramped columns, clipped panels. At a fixed
   1280-wide viewport it always lays out like a normal desktop and the scale
   just makes it bigger or smaller, which is how a real screen behaves.

   Height is derived from the screen mesh's own aspect so the scale stays
   uniform and nothing is stretched. Raise this to fit more on the screen at
   smaller text; lower it for larger text and less content. */
const SCREEN_DESIGN_WIDTH = 1280;

/* Grow the site overlay outward, in CSS pixels added to the LEFT and RIGHT
   edges (negative shrinks it).

   The overlay is derived from the bmo_face plane, but the lit screen you
   actually see is painted on BMO's body shell too and is slightly larger than
   that plane — so a thin band of BMO's own screen texture shows around the
   site. Measured off a render it's about 21 CSS pixels a side.

   Top and bottom grow proportionally, so the box keeps the screen's aspect
   and the site still fills it exactly instead of letterboxing. */
const SCREEN_EXPAND = 1;
let screenDesignW = SCREEN_DESIGN_WIDTH;
let screenDesignH = 838;

/* Keyframes for the refresh sweep. Injected rather than kept in a stylesheet
   because everything else about this overlay is built here too. Honours
   prefers-reduced-motion: the band parks out of frame instead of drifting. */
function injectScreenGlassStyles() {
  if (document.getElementById('bmo-screen-glass-styles')) return;
  const style = document.createElement('style');
  style.id = 'bmo-screen-glass-styles';
  style.textContent = `
    /* One direction only, right to left. The wrap is invisible because the
       band is fully outside the screen at BOTH ends of the travel — at 400%
       its left edge is past the right side, at -110% its right edge is past
       the left — so there is no frame where the reset can be seen. Linear,
       because an eased one-way loop visibly slows down at the seam. */
    @keyframes bmoScreenSweep {
      from { transform: translateX(400%); }
      to   { transform: translateX(-110%); }
    }
    @media (prefers-reduced-motion: reduce) {
      #bmo-screen-sweep { animation: none !important; opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

function mountScreenIframe() {
  if (screenOverlay) return;
  injectScreenGlassStyles();

  if (tvScreenMesh) {
    const box = new THREE.Box3().setFromObject(tvScreenMesh);
    const size = box.getSize(new THREE.Vector3());
    const dims = [size.x, size.y, size.z].sort((a, b) => b - a);
    screenDesignW = SCREEN_DESIGN_WIDTH;
    screenDesignH = Math.round(SCREEN_DESIGN_WIDTH / (dims[0] / dims[1]));
  }

  screenOverlay = document.createElement('div');
  Object.assign(screenOverlay.style, {
    position: 'fixed',
    left: '0px', top: '0px', width: '0px', height: '0px',
    zIndex: '4',              // above the WebGL canvas (z-index 1)
    overflow: 'hidden',
    borderRadius: SCREEN_CORNER_RADIUS,
    background: '#0a0e27',
    display: 'none',
    opacity: '0',
    transition: 'opacity 0.28s ease-out',
    pointerEvents: 'auto',
  });

  screenIframe = document.createElement('iframe');
  screenIframe.src = '/bmo_desktop';
  screenIframe.title = "BMO's desktop";
  Object.assign(screenIframe.style, {
    display: 'block',
    // Fixed logical viewport; layoutScreenOverlay scales it to the rect.
    width: `${screenDesignW}px`,
    height: `${screenDesignH}px`,
    transformOrigin: '0 0',
    border: '0', background: '#0a0e27', pointerEvents: 'auto',
  });
  screenOverlay.appendChild(screenIframe);

  // Non-interactive CRT cues, so the site reads as a screen rather than a
  // browser window pasted over the scene.
  /* Grime, not scanlines.

     The first pass leaned on a hard scanline + RGB grille, which reads as a
     filter laid over the page. What actually sells a real tube is that the
     glass is DIRTY and the phosphor is UNEVEN: soft smudges, a few brighter
     patches, a faint colour drift across the face, and light pooling in the
     middle. So the structure is dialled right back and the irregularity does
     the work.

     Layer order (front to back):
       1. glare       the room on the curve of the glass
       2. smudges     four soft off-centre blooms at 2-3%, deliberately not on
                      a grid — regular spacing is what makes an overlay look
                      procedural
       3. colour cast one warm and one cool pool, so the white isn't uniform
       4. scanlines   still there, but at 6% instead of 13% — felt, not seen
       5. vignette    light pooling centre, falling into the corners */
  const glass = document.createElement('div');
  glass.style.cssText = `
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: ${SCREEN_CORNER_RADIUS};
    background:
      linear-gradient(108deg,
        rgba(255,255,255,0.10) 0%,
        rgba(255,255,255,0.04) 15%,
        rgba(255,255,255,0.00) 32%),
      radial-gradient(38% 26% at 27% 31%, rgba(255,255,255,0.030), rgba(255,255,255,0) 70%),
      radial-gradient(30% 34% at 71% 22%, rgba(255,255,255,0.024), rgba(255,255,255,0) 72%),
      radial-gradient(44% 30% at 62% 74%, rgba(255,255,255,0.022), rgba(255,255,255,0) 70%),
      radial-gradient(26% 22% at 18% 68%, rgba(255,255,255,0.018), rgba(255,255,255,0) 74%),
      radial-gradient(52% 44% at 78% 44%, rgba(255,238,190,0.030), rgba(255,238,190,0) 72%),
      radial-gradient(48% 40% at 22% 56%, rgba(190,232,255,0.026), rgba(190,232,255,0) 74%),
      repeating-linear-gradient(to bottom,
        rgba(0,0,0,0.06) 0px, rgba(0,0,0,0.06) 1px,
        rgba(0,0,0,0.00) 1px, rgba(0,0,0,0.00) 3px),
      radial-gradient(ellipse at 50% 46%,
        rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.00) 46%,
        rgba(0,0,0,0.14) 78%, rgba(0,0,0,0.40) 100%);
    box-shadow:
      inset 0 0 64px rgba(0,0,0,0.40),
      inset 0 2px 0 rgba(255,255,255,0.13),
      inset 0 -2px 0 rgba(0,0,0,0.28),
      inset 7px 0 15px -10px rgba(90,180,255,0.24),
      inset -7px 0 15px -10px rgba(255,120,90,0.20);
  `;
  screenOverlay.appendChild(glass);

  /* A wide, very faint vertical band drifting across the face — the slow
     side-to-side shimmer of a tube rather than a refresh bar rolling down it.
     Peak alpha 3.5%, so it should be something you notice on the second look.
     Transform only, so it stays on the compositor. */
  const sweep = document.createElement('div');
  sweep.id = 'bmo-screen-sweep';
  sweep.style.cssText = `
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 26%;
    pointer-events: none;
    background: linear-gradient(to right,
      rgba(255,255,255,0.000) 0%,
      rgba(255,255,255,0.018) 38%,
      rgba(255,255,255,0.035) 52%,
      rgba(255,255,255,0.014) 66%,
      rgba(255,255,255,0.000) 100%);
    will-change: transform;
    animation: bmoScreenSweep 13s linear infinite;
  `;
  screenOverlay.appendChild(sweep);
  document.body.appendChild(screenOverlay);

  screenMounted = true;
  initScreenAudio();
  window._screen = { overlay: screenOverlay, iframe: screenIframe };
  console.log('[screen] iframe mounted on BMO');
  enterBrowseMode();
}

/* Park the overlay exactly on the screen's projected rectangle. Cheap enough
   to run every frame, which keeps it glued while the camera damps in. */
function layoutScreenOverlay() {
  if (!screenOverlay) return;
  const r = screenRectOnViewport();
  if (!r) return;
  // Vertical expansion is derived from the horizontal so the aspect holds.
  const expandX = SCREEN_EXPAND;
  const expandY = SCREEN_EXPAND * (screenDesignH / screenDesignW);
  const left = r.left - expandX;
  const top  = r.top  - expandY;
  const w = Math.max(0, (r.right  + expandX) - left);
  const h = Math.max(0, (r.bottom + expandY) - top);
  screenOverlay.style.left   = `${left}px`;
  screenOverlay.style.top    = `${top}px`;
  screenOverlay.style.width  = `${w}px`;
  screenOverlay.style.height = `${h}px`;

  /* Full-bleed: the site fills the glass edge to edge. The rounded aperture
     still clips the very corners, so the desktop keeps its own safe-area
     padding (--screen-safe in bmo_desktop.html) and puts nothing there. */
  if (screenIframe) {
    // Uniform scale, centred. The box keeps the screen's aspect, so the two
    // ratios agree and nothing is letterboxed or stretched.
    const scale = Math.min(w / screenDesignW, h / screenDesignH);
    const offsetX = (w - screenDesignW * scale) / 2;
    const offsetY = (h - screenDesignH * scale) / 2;
    screenIframe.style.transform =
      `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }
}

function enterBrowseMode() {
  isBrowsingScreen = true;
  screenOpening = false;
  controls.enabled = false;
  // Hard-disable the canvas so every click in the viewport belongs to the
  // iframe. The pointerdown guard covers the JS side; this covers the case
  // where the canvas would otherwise swallow the event before it gets there.
  renderer.domElement.style.pointerEvents = 'none';
  if (screenOverlay) {
    screenOverlay.style.display = 'block';
    layoutScreenOverlay();
    requestAnimationFrame(() => { if (screenOverlay) screenOverlay.style.opacity = '1'; });
  }
  document.body.style.cursor = 'default';
  outlinePass.selectedObjects = [];

  /* Self-check. Every listener in this file is bound to `window`, so the 3D
     scene keeps responding even when something is stacked over the viewport —
     but an iframe only gets events if it is the actual hit-test target. That
     makes "the site is silently unclickable" invisible from the outside, so
     name the culprit in the console rather than leaving it to guesswork. */
  requestAnimationFrame(() => {
    const el = screenOverlay;
    const top = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    if (el && top && (top === el || el.contains(top))) {
      console.log('[screen] live — the 2D site is the topmost element and has pointer events');
    } else {
      const stack = (document.elementsFromPoint
        ? document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2)
        : []).map(n => n.tagName.toLowerCase() +
                       (n.id ? '#' + n.id : '') +
                       ' {pointer-events:' + getComputedStyle(n).pointerEvents + '}');
      console.warn('[screen] BLOCKED — topmost element at the centre of the viewport is', top,
                   '\n           hit-test stack:', stack,
                   '\n           iframe mounted:', screenMounted, '| overlay:', !!screenOverlay);
    }
  });
}

/* Hand pointer events back to the 3D scene WITHOUT destroying the iframe.
   Tearing it down would reload /bmo_desktop on the way back in and lose
   whatever was open on it. */
function exitBrowseMode() {
  isBrowsingScreen = false;
  screenOpening = false;
  renderer.domElement.style.pointerEvents = 'auto';
  if (screenOverlay) {
    screenOverlay.style.opacity = '0';
    // Hidden, never removed: display:none keeps the iframe's document (and
    // whatever you had open on it) alive for the next visit.
    clearTimeout(screenOverlay._hideTimer);
    screenOverlay._hideTimer = setTimeout(() => {
      if (screenOverlay && !isBrowsingScreen) screenOverlay.style.display = 'none';
    }, 300);
  }
}

// DOM button — the canvas has pointer-events off while browsing, so the
// exit affordance has to live outside it.
const screenExitBtn = document.createElement('button');
screenExitBtn.textContent = '[ esc — step back ]';
screenExitBtn.style.cssText = `
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: 5; display: none; cursor: pointer;
  padding: 10px 18px; font-family: monospace; font-size: 12px;
  letter-spacing: 1px; color: #4ade80; background: rgba(10,14,39,0.85);
  border: 1px solid #4ade80;
`;
screenExitBtn.addEventListener('click', () => exitBrowseAndZoomOut());
// Deliberately NOT appended. Stepping back out of the 2D site is done by
// moving the pointer off BMO, so the button would just be clutter over the
// site. Kept constructed so the show/hide calls below stay harmless.


function exitBrowseAndZoomOut() {
  if (!isBrowsingScreen) return;
  exitBrowseMode();
  returnToRoomView();
}

function showStaticScreen() {
  if (tvVideo) {
    tvVideo.pause();
    isVideoPlaying = false;
  }

  if (INLINE_SCREEN) {
    mountScreenIframe();
    return;
  }

  // Fallback: full page navigation (?classicscreen)
  navCover.style.opacity = '1';
  setTimeout(() => {
    window.location.href = '/bmo_desktop';
  }, 260);
}

function zoomToScreenThenShowStatic() {
  if (!tvScreenMesh || screenOpening || screenMounted) return;
  screenOpening = true;

  // Animates in from wherever the desk framing left the camera — damped in
  // animateObjectFocus, so this is a real move, not a cut.
  focusOnBmoAxis(INLINE_SCREEN ? BMO_SCREEN_DISTANCE : 0.4);

  onFocusComplete = () => { showStaticScreen(); };
}


/*
TO DO
need to fix performance fps wise
different containers different devices
need to fix possible bugs
need to fix all load time issues
need to fix any camera bugs
*/