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

// bfcache guard — when the user navigates from here to the 2D site and then
// hits browser back, the page is restored from bfcache with a half-dead WebGL
// context (only the bulb paints, the rest of the room is gone). We only want
// the reload-to-root behavior for that specific flow, NOT for the BMO desktop
// round-trip (clicking BMO's screen → /bmo_desktop → back), which would
// otherwise also trip pageshow.persisted and force an unwanted refresh.
//
// To scope this, the 2D-site navigation sets a sessionStorage flag below.
// Here, we only act on a bfcache restore (event.persisted === true) AND only
// when that flag is set, then clear it. Initial loads (persisted=false) and
// all other bfcache restores are left alone.
window.addEventListener('pageshow', (event) => {
  if (event.persisted && sessionStorage.getItem('reload3DOnReturn') === '1') {
    sessionStorage.removeItem('reload3DOnReturn');
    window.location.replace('/');
  }
});

// Draco loader — points to decoder files served from /public/draco/
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
RectAreaLightUniformsLib.init();

// audio fx
const clickSound = new Audio('/on.wav');
const ukeSound = new Audio('/uke.wav');
const ambientSound = new Audio('/ambience.mp3');
// const clickSound2 = new Audio('/whoosh.wav')
const zoomIn = new Audio('/whoosh.wav')
const zoomOut = new Audio('/zoomout.wav')
// Scene + shared state
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1530);
let isVideoPlaying = false;
let selectedObject = null;
let tvScreenMesh = null;
let tvVideo = null;
let videoReady = false;
let isFocusedOnBMO = false;
let bmoObject = null;
let mcbed = null;
let onFocusComplete = null;
let hasOpenedStaticScreen = false;
let updateTV = null;
let ukulele = null;
let whiteboardShadow = null;
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

// antialias is OFF — EffectComposer renders to its own HalfFloat target and
// then runs OutputPass for the final blit, so hardware MSAA on the default
// drawing buffer is never sampled. Leaving it on costs memory + GPU cycles
// for a buffer nothing reads.
const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
document.body.appendChild(renderer.domElement);

// appReady — flips true only once the GLB has finished loading and the scene
// is interactive. The pointerdown handler short-circuits on !appReady, so
// stray clicks on the title / picker / loading overlays never hit the
// (still empty) scene graph.
let appReady = false;

// Loading screen — shown only after the user picks 3D, drives a progress bar.
// Created up front so loadingScreen.querySelector(...) works, but NOT appended
// to the body yet — that happens inside startSceneLoad() when the user picks 3D.
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

// loadingTipInterval — cycles tip text in the loading bar so it doesn't feel frozen.
// Not started at module load — kicked off inside startSceneLoad() once 3D is picked.
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

// isMobile — narrow viewport OR a primary input device that doesn't have a
// real mouse. The 3D experience needs OrbitControls + a hover cursor, neither
// of which work great on touch, so we gate it behind this flag.
const isMobile = window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;

// Title screen — first thing the user sees. Click anywhere to dismiss and
// reveal the experience picker. The heavy 3D scene + GLB fetch don't even
// start until the user explicitly opts into 3D from the picker.
const titleScreen = document.createElement('div');
titleScreen.id = 'titleScreen';
titleScreen.innerHTML = `
  <div class="title-content">
    <div class="title-text">kyle's portfolio</div>
    <div class="title-hint">click anywhere to begin</div>
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
    background: url('/background.png') center / cover no-repeat;
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
    margin-bottom: 28px;
    text-shadow: 0 0 20px rgba(91,203,154,0.25);
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
// Inject real bg divs so the blurred image reliably covers whatever is behind the picker
const pickerBgImage = document.createElement('div');
pickerBgImage.style.cssText = `
  position: absolute;
  inset: -60px;
  background: url('/background.png') center / cover no-repeat;
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

// Picker content — z-index 2 so it floats above the background layers
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

// On mobile, the 3D button is visually disabled and shows a "desktop only"
// label. Its click handler is a no-op so the heavy GLB never starts loading.
if (isMobile) {
  pick3dBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
    <span style="font-size:12px;letter-spacing:2px;line-height:1.6;">3d portfolio only<br>available on desktops</span>
  `;
  pick3dBtn.style.cursor = 'not-allowed';
  pick3dBtn.style.opacity = '0.45';
  pick3dBtn.disabled = true;
}

// Hover affordance — only on the 2D button on mobile (3D is disabled).
['pick3d', 'pick2d'].forEach(id => {
  if (id === 'pick3d' && isMobile) return; // no hover lift on a disabled button
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

// closePicker — fades out and removes the experience picker overlay
function closePicker() {
  pickerOverlay.style.opacity = '0';
  pickerOverlay.style.pointerEvents = 'none';
  setTimeout(() => pickerOverlay.remove(), 450);
}

// showPicker — fades in the experience picker (called from the title screen click).
function showPicker() {
  pickerOverlay.style.pointerEvents = 'auto';
  pickerOverlay.style.opacity = '1';
}

// Title screen click → fade title out, fade picker in.
titleScreen.addEventListener('click', () => {
  titleScreen.classList.add('fade-out');
  showPicker();
  setTimeout(() => titleScreen.remove(), 500);
}, { once: true });

pick3dBtn.addEventListener('click', () => {
  if (isMobile) return;                   // hard guard, also covered by `disabled`
  closePicker();
  // Start ambient music — loop forever, kick off inside the click handler so
  // the browser's autoplay policy is satisfied (user gesture required).
  ambientSound.loop = true;
  ambientSound.volume = 0.5;
  ambientSound.play().catch(err => console.warn('ambient audio blocked:', err));
  // Mount + show the loading overlay, start cycling tips, and fire the GLB fetch.
  document.body.appendChild(loadingScreen);
  startLoadingTipCycle();
  startSceneLoad();
});

pick2dBtn.addEventListener('click', () => {
  // Mark this navigation as a 2D-site jump so the pageshow handler at the top
  // of the file knows to hard-reload when the user comes back via bfcache.
  // Without this, bfcache restores the 3D page with a broken WebGL context.
  sessionStorage.setItem('reload3DOnReturn', '1');
  pickerOverlay.style.opacity = '0';
  setTimeout(() => {
    window.location.href = '/2d-website/front.html';
  }, 350);
});

// dismissLoadingScreen — fills bar to 100%, fades out loading screen,
// and flips appReady so the scene's pointerdown handler comes online.
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
      appReady = true;
    }, 700);
  }, 250);
}

// navCover — mint-colored flash cover used during BMO page transition
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

// fontStyle — loads the Minecraftia pixel font from /public/fonts/
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

// Help overlay — "?" button in the bottom-right corner with instructions panel
const helpBtn = document.createElement('button');
helpBtn.textContent = '?';
helpBtn.style.cssText = `
  position: fixed;
  padding-top: 12px;
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
      <li> <strong>click + drag</strong> - rotate the camera around the room</li>
      <li> <strong>scroll</strong> - zoom in and out</li>
      <li> <strong>click an object</strong> - focus in on it</li>
      <li> <strong>esc</strong> - return to the default 3D view</li>
      
      <center> <li> -- examples -- </li></center>
      <li> <strong>BMO (the little robot) </strong> - click BMO to focus, click again to play</li>
      <li> <strong>light switch</strong> - toggle day / night</li>
      <li> <strong>the bed</strong> - you can try</li>
    </ul>
    <div style="margin-top:28px;text-align:center;font-size:10px;opacity:0.5;letter-spacing:1px;">click anywhere to close</div>
  </div>
`;
document.body.appendChild(helpOverlay);

let helpOpen = false;

// openHelp / closeHelp — shows or hides the instructions overlay
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

// tipBar — Minecraft-style toast shown when the user clicks the bed
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

// Renderer settings — tone mapping, shadows, color space
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.7;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const box = new THREE.Box3().setFromObject(scene);
const center = box.getCenter(new THREE.Vector3());
console.log('center:', center);

// Lights — hemisphere fill, ambient, directional moon, ceiling bulb, desk lamp
const fillLight = new THREE.HemisphereLight(0x2a3a5a, 0x0a0a15, 0.2);
scene.add(fillLight);

const ambientLight = new THREE.AmbientLight(0x6a7a9a, 0.55);
scene.add(ambientLight);

const moonFill = new THREE.DirectionalLight(0xb0c0e0, 0.4);
moonFill.position.set(-5, 3, 2);
moonFill.target.position.set(center.x, center.y, center.z);
moonFill.target.updateMatrixWorld();
scene.add(moonFill, moonFill.target);
moonFill.castShadow = false;
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

// bulbLight — warm ceiling point light that casts shadows in night mode.
// PointLight shadows are 6 cubemap face renders, so every wasted unit of frustum
// costs 6× as much as a directional light. The bulb sits at y=2 in a small
// isometric room (~5×5×3); tightening near/far cuts depth-precision waste and
// gives us crisper, cheaper shadow samples.
const bulbLight = new THREE.PointLight(0xffd9a0, 4, 8, 1);
bulbLight.position.set(0.5, 2, 0.5);
bulbLight.castShadow = true;
bulbLight.shadow.mapSize.width  = 1024;
bulbLight.shadow.mapSize.height = 1024;
bulbLight.shadow.bias           = -0.0005;
bulbLight.shadow.normalBias     = 0.02;
bulbLight.shadow.radius         = 4;
bulbLight.shadow.camera.near = 0.5;   // skip the bulb mesh itself + reclaim z-precision
bulbLight.shadow.camera.far  = 5;     // room floor is ~2 units below, walls ~2.5 away
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

// deskLamp — warm point light anchored to the desk lamp mesh after GLB loads
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

// Desk lamp console helpers — nudgeLamp, setLampPos, showLampPos, toggleLampHelper
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

// Day / night palettes — color targets for setDayNight transitions
let isDayMode = false;
let dayNightAnimId = null;

const NIGHT_PALETTE = {
  background:        new THREE.Color(0x0a1530),
  beamColor:         new THREE.Color(0xd8e0f0),
  beamIntensity:     0.9,
  moonColor:         new THREE.Color(0xb0c0e0),
  moonIntensity:     0.4,
  ambientColor:      new THREE.Color(0x6a7a9a),
  ambientIntensity:  0.15,
  hemiSky:           new THREE.Color(0x2a3a5a),
  hemiGround:        new THREE.Color(0x0a0a15),
  hemiIntensity:     0.2,
  bulbIntensity:     5,
  deskLampIntensity: 1.0,
};

const DAY_PALETTE = {
  background:        new THREE.Color(0x8aafc8),  // was 0x9bb2c1 — cooler blue sky
  beamColor:         new THREE.Color(0xffe066),  // was 0xfff0c8 — richer yellow sunbeam
  beamIntensity:     2.4,
  moonColor:         new THREE.Color(0xe8f2ff),  // was 0xfff8e8 — cool blue-white sunlight
  moonIntensity:     4.0,
  ambientColor:      new THREE.Color(0xc8dcf8),  // was 0xe8ecf0 — noticeably bluer ambient
  ambientIntensity:  0.3,
  hemiSky:           new THREE.Color(0x90b8e8),  // was 0xb6d0e8 — deeper blue sky dome
  hemiGround:        new THREE.Color(0xa08868),
  hemiIntensity:     0.55,
  bulbIntensity:     0,
  deskLampIntensity: 0,
};


const paperMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uSpeed: { value: 10.0 },    // How fast it flutters
    uStrength: { value: 0.11 }, // How far it bends out
  },
  vertexShader: /* glsl */`
    uniform float uTime;
    uniform float uSpeed;
    uniform float uStrength;
    varying vec2 vUv;

    void main() {
      vUv = uv;
      vec3 pos = position;

      // uv.y goes from 0 (bottom tip) to 1 (top attached edge)
      // (1.0 - uv.y) means 0 influence at the top anchor, 1.0 at the loose tip
      float windWeight = pow(1.0 - uv.y, 2.0);

      // Create a high-frequency fluttering motion along the Z/X axis
      float flutter = sin(pos.y * 10.0 + uTime * uSpeed) * cos(uTime * uSpeed * 0.5);
      
      // Push the paper outward in the direction of the AC blast (e.g., Z axis)
      pos.z += flutter * uStrength * windWeight;
      
      // Add a slight constant lift from the continuous air stream
      pos.y += windWeight * (uStrength * 0.5);

      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(pos, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      // Clean, flat, unlit paper look (matching a stylized room)
      gl_FragColor = vec4(0.45, 0.52, 0.49, 1.0);
    }
  `,
  side: THREE.DoubleSide
});

// Give it 1 horizontal segment, but 10-20 vertical segments so it has joints to flex!
const paperGeo = new THREE.PlaneGeometry(0.05, 0.3, 1, 15);
const paperMesh = new THREE.Mesh(paperGeo, paperMaterial);

// Position it right at your AC vent opening
paperMesh.position.set(0.5, 1.2, -1.8); 
scene.add(paperMesh);


// setDayNight — smoothstep-lerps all lights and beam shader between day and night palettes
function setDayNight(toDay) {

  clickSound.currentTime = 0;
  clickSound.play();
  if (toDay === isDayMode) return;
  isDayMode = toDay;

  // Whiteboard shadow: cast + receive sunlight shadows in day, suppress both at night.
  // When switching to day, force the directional shadow map to re-render so the
  // pre-baked night map is replaced with one that projects shadows onto the whiteboard.
  // Traverse children so multi-mesh whiteboards are fully covered, not just the parent.
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

  const to = toDay ? DAY_PALETTE : NIGHT_PALETTE;

  const start = {
    background:        scene.background.clone(),
    moonColor:         moonFill.color.clone(),
    moonIntensity:     moonFill.intensity,
    ambientColor:      ambientLight.color.clone(),
    ambientIntensity:  ambientLight.intensity,
    hemiSky:           fillLight.color.clone(),
    hemiGround:        fillLight.groundColor.clone(),
    hemiIntensity:     fillLight.intensity,
    bulbIntensity:     bulbLight.intensity,
    deskLampIntensity: deskLamp.intensity,
    beamColor:         window._beam ? window._beam.material.uniforms.uColor.value.clone() : null,
    beamIntensity:     window._beam ? window._beam.material.uniforms.uIntensity.value : null,
  };

  if (dayNightAnimId) cancelAnimationFrame(dayNightAnimId);

  // Shadow maps are pre-baked at load time — never recompute during transitions
  // (recomputing mid-frame causes shader recompiles and 11fps spikes).

  const duration = 1500;
  const t0 = performance.now();

  function step() {
    const elapsed = performance.now() - t0;
    const t = Math.min(elapsed / duration, 1);
    const eased = t * t * (3 - 2 * t);

    scene.background.copy(start.background).lerp(to.background, eased);
    moonFill.color.copy(start.moonColor).lerp(to.moonColor, eased);
    moonFill.intensity = THREE.MathUtils.lerp(start.moonIntensity, to.moonIntensity, eased);
    ambientLight.color.copy(start.ambientColor).lerp(to.ambientColor, eased);
    ambientLight.intensity = THREE.MathUtils.lerp(start.ambientIntensity, to.ambientIntensity, eased);
    fillLight.color.copy(start.hemiSky).lerp(to.hemiSky, eased);
    fillLight.groundColor.copy(start.hemiGround).lerp(to.hemiGround, eased);
    fillLight.intensity = THREE.MathUtils.lerp(start.hemiIntensity, to.hemiIntensity, eased);
    bulbLight.intensity = THREE.MathUtils.lerp(start.bulbIntensity, to.bulbIntensity, eased);
    deskLamp.intensity  = THREE.MathUtils.lerp(start.deskLampIntensity, to.deskLampIntensity, eased);

    if (window._beam && start.beamColor) {
      const u = window._beam.material.uniforms;
      u.uColor.value.copy(start.beamColor).lerp(to.beamColor, eased);
      u.uIntensity.value = THREE.MathUtils.lerp(start.beamIntensity, to.beamIntensity, eased);
    }

    if (t < 1) {
      dayNightAnimId = requestAnimationFrame(step);
    } else {
      dayNightAnimId = null;
    }
  }
  step();
}

// OrbitControls + camera state for default view and escape/focus animations
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const defaultCameraPosition = new THREE.Vector3();
const defaultControlsTarget = new THREE.Vector3();

let isEscapeAnimating = false;
let lastEscapeTime = 0;
let isFocusingObject = false;
let lastFocusTime = 0;

const focusCameraPosition = new THREE.Vector3();
const focusControlsTarget = new THREE.Vector3();

// BMO parallax — spring-based mouse-driven camera drift when focused on BMO.
// Uses a second-order spring so the camera builds velocity before arriving
// (small delay, then drifts in fast) rather than a simple lerp.
//
// STIFFNESS — how hard the spring pulls toward the target. Higher = faster.
// DAMPING   — friction that prevents oscillation. Lower = more floaty/overshoot.
const mouseNDC = new THREE.Vector2();
const bmoParallaxCurrent  = new THREE.Vector3();
const bmoParallaxVelocity = new THREE.Vector3(); // spring velocity
const bmoParallaxTarget   = new THREE.Vector3();
const BMO_PARALLAX_STRENGTH = 0.1;  // max offset in world units
const BMO_PARALLAX_STIFFNESS = 80;  // spring pull strength
const BMO_PARALLAX_DAMPING   = 12;  // 2*sqrt(30)≈11 = critical damping, no bounce

window.addEventListener('mousemove', (e) => {
  mouseNDC.set(
    (e.clientX / window.innerWidth)  * 2 - 1,
   -(e.clientY / window.innerHeight) * 2 + 1
  );
});

// Post-processing — outline, bloom, and output passes via EffectComposer
// HalfFloatType render targets use 8 bytes/pixel instead of 16 (FloatType),
// cutting intermediate buffer memory roughly in half while still supporting HDR bloom.
const composerTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  type: THREE.HalfFloatType,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  stencilBuffer: false,
});
const composer = new EffectComposer(renderer, composerTarget);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// Bloom runs BEFORE outline so the outline edges are never picked up by bloom.
// Old order (renderPass → outline → bloom → output) caused bloom to amplify the
// bright white outline edges, making the whole scene look brighter on hover.
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

// Raycaster + clickable registry for pointer interactions.
//
// clickableObjects holds the *real* meshes/groups in the scene that respond to
// clicks (BMO, whiteboard, bed, etc.)
//

const clickableObjects = [];
const interactionBoundingBoxes = [];
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// registerClickable — adds a target to clickableObjects AND builds an AABB

function registerClickable(target) {
  if (!target || clickableObjects.indexOf(target) !== -1) return;
  clickableObjects.push(target);

  const aabb = new THREE.Box3().setFromObject(target);
  if (aabb.isEmpty()) return; // nothing to proxy (no geometry under this node)

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
  // Keep proxies out of the rendered scene graph as cheaply as possible:
  // invisible material + no shadows + frustumCulled still applies for raycasts.
  proxy.castShadow = false;
  proxy.receiveShadow = false;
  scene.add(proxy);
  interactionBoundingBoxes.push(proxy);
}

// unregisterClickable — removes a target from both arrays and disposes its proxy.
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

// pointerdown — handles clicks on clickable objects: switch, TV screen, BMO, bed, others.
// Raycast hits a proxy from interactionBoundingBoxes; the real clickable is in userData.
// Gated on appReady so clicks during title / picker / loading phases are ignored.
window.addEventListener('pointerdown', (event) => {
  if (!appReady) return;



  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(interactionBoundingBoxes, false);

  if (intersects.length > 0) {
    const selected = intersects[0].object.userData.clickableTarget;

    // Switch detection: compare against the registered clickable directly —
    // no parent-chain walk needed since the proxy already resolves to it.
    if (selected === switchMesh ||
        selected.name === 'Object_0003_1' ||
        selected.name === 'switch' ||
        selected.name === 'Switch') {
      setDayNight(!isDayMode);
      return;
    }

    // Ukulele — play the strum sound but skip zoom/focus entirely
    if (selected === ukulele) {
      ukeSound.currentTime = 0;
      ukeSound.play();
      return;
    }

    // Only play zoom sound if this is a fresh focus (not re-clicking an already focused object)
    if (selected !== selectedObject) {
      zoomIn.volume = 0.05;
      zoomIn.currentTime = 0;
      zoomIn.play();
    }

    if (selected === bmoObject || selected.name === 'leftArm002_8') {
      // If BMO is already focused, a second click on his body plays the video
      if (isFocusedOnBMO && !isFocusingObject) {
        if (!videoReady || !tvVideo) {
          console.log('Video is not ready yet.');
          return;
        }
        if (isVideoPlaying) {
          console.log('Video is already playing.');
          return;
        }
        if (tvVideo.paused) {
          hasOpenedStaticScreen = false;
          isVideoPlaying = true;
          tvVideo.currentTime = 0;
          tvVideo.muted = false;
          tvVideo.volume = 0.8;
          tvVideo.play().catch((err) => {
            console.warn('Video play failed:', err);
            isVideoPlaying = false;
          });
        }
        return;
      }
      // First click — focus on BMO and start loading the video
      isFocusedOnBMO = true;
      selectedObject = selected;
      outlinePass.selectedObjects = [selected];
      console.log('BMO focused:', selected.name);
      if (window._loadBMOVideo) window._loadBMOVideo();
      // Enable screen hover + click now that BMO is focused (creates a proxy too)
      if (tvScreenMesh) registerClickable(tvScreenMesh);
      focusOnObject(selected);
      return;
    }

    // Screen click — only reachable after BMO is focused (screen registered above)
    if (selected === tvScreenMesh) {
      if (!videoReady || !tvVideo) {
        console.log('Video is not ready yet.');
        return;
      }
      if (isVideoPlaying) {
        console.log('Video is already playing.');
        return;
      }
      if (tvVideo.paused) {
        hasOpenedStaticScreen = false;
        isVideoPlaying = true;
        tvVideo.currentTime = 0;
        tvVideo.muted = false;
        tvVideo.volume = 0.8;
        tvVideo.play().catch((err) => {
          console.warn('Video play failed:', err);
          isVideoPlaying = false;
        });
      }
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

    isFocusedOnBMO = false;
    // Tear down the screen's proxy + clickable entry — BMO is no longer focused
    if (tvScreenMesh) unregisterClickable(tvScreenMesh);
    selectedObject = selected;
    outlinePass.selectedObjects = [selected];
    console.log('Clicked Object Name:', selected.name, '| Object Type:', selected.type);
    focusOnObject(selected);
  } else {
    isFocusedOnBMO = false;
    if (tvScreenMesh) unregisterClickable(tvScreenMesh);
    outlinePass.selectedObjects = [];
  }
});

// processPointerHover — throttled hover raycaster, runs once per animation frame.
// Now raycasts against interactionBoundingBoxes (small invisible AABB proxies)
// instead of the real clickableObjects hierarchy. Recursion is explicitly off:
// each proxy is a single 12-tri box, so a hover is at most N box tests where
// N is the number of registered clickables (~6). Previously this could chew
// through thousands of triangles per mouse wiggle.
let pendingPointerEvent = null;
let pointerRaycastQueued = false;

function processPointerHover() {
  pointerRaycastQueued = false;
  const event = pendingPointerEvent;
  pendingPointerEvent = null;
  if (!event) return;

const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(interactionBoundingBoxes, false);

  if (intersects.length > 0) {
    document.body.style.cursor = 'pointer';
    outlinePass.selectedObjects = [intersects[0].object.userData.clickableTarget];
  } else {
    document.body.style.cursor = 'default';
    outlinePass.selectedObjects = [];
  }
}

window.addEventListener('pointermove', (event) => {
  pendingPointerEvent = event;
  if (!pointerRaycastQueued) {
    pointerRaycastQueued = true;
    requestAnimationFrame(processPointerHover);
  }
});

// GLTFLoader — loads the main scene GLB, sets up meshes, lights, and screen.
// Wrapped in startSceneLoad() so the GLB fetch only fires after the user
// explicitly picks the 3D experience from the picker.
const loader = new GLTFLoader();

// please never remove, this allows it to even load in browsers
loader.setDRACOLoader(dracoLoader);

function startSceneLoad() {
  loader.load(
  '/backupisometricScene.glb',
  (gltf) => {
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
        // Only large structural meshes cast shadows — small props only receive them.
        // This keeps shadow maps clean without computing tiny prop shadows every frame.
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

      // Window beam shader — replaces the Emission mesh material with a custom volumetric GLSL shader
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



    
    // Walk up from the BMO mesh to the top-level group that sits directly under
    // the scene root — that's the full BMO object (body, buttons, screen, etc.).
    // All textures in that subtree are protected from downsampling.
    const bmoMeshRef = model.getObjectByName('leftArm002_8');
    let bmoRoot = bmoMeshRef;
    if (bmoRoot) {
      let cursor = bmoRoot.parent;
      while (cursor && cursor !== model && cursor !== scene) {
        bmoRoot = cursor;
        cursor = cursor.parent;
      }
    }

    // Downsample any texture larger than 2048px — BMO's subtree stays at full resolution.
    downsampleTextures(model, 2048, bmoRoot ? [bmoRoot] : []);

    // Pre-bake BOTH shadow maps right after the model loads so day/night transitions
    // never trigger a mid-frame shadow recompute or shader recompile.
    bulbLight.castShadow = true;
    bulbLight.shadow.needsUpdate = true;
    moonFill.castShadow = true;
    moonFill.shadow.needsUpdate = true;

    // Register clickable objects from the loaded model.
    // Each registerClickable() also builds an AABB proxy in interactionBoundingBoxes.
    ukulele = model.getObjectByName('ukulele');
    if (ukulele) registerClickable(ukulele);
    const bmoMesh   = model.getObjectByName('leftArm002_8');
    bmoObject = bmoMesh;
    const whiteboard = model.getObjectByName('Whiteboard');
    whiteboardShadow = whiteboard;
  

    // Pre-warm BOTH whiteboard shadow program variants up front.
    //

    if (whiteboardShadow) {
      // Variant A — day state (shadows on)
      whiteboardShadow.traverse((child) => {
        if (child.isMesh) {
          child.receiveShadow = true;
          child.castShadow    = true;
     
          
        }
      });
      renderer.compile(scene, camera);

      // Variant B — night state (shadows off, also the initial mode)
      whiteboardShadow.traverse((child) => {
        if (child.isMesh) {
          child.receiveShadow = false;
          child.castShadow    = false;
        }
      });
      renderer.compile(scene, camera);
    }

    const bed        = model.getObjectByName('Cube016_1');
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


   


    // Anchor desk lamp light to Cylinder005 mesh position
    const deskLampMesh = model.getObjectByName('Cylinder005');
    if (deskLampMesh) {
      deskLampMesh.getWorldPosition(deskLamp.position);
      deskLamp.position.add(DESK_LAMP_OFFSET);
      deskLampBulbMesh.position.copy(deskLamp.position);
      deskLamp.intensity = isDayMode
        ? DAY_PALETTE.deskLampIntensity
        : NIGHT_PALETTE.deskLampIntensity;
      window.showLampPos();
      console.log('Adjust live with: nudgeLamp(dx,dy,dz)  setLampPos(x,y,z)  toggleLampHelper()');
    } else {
      console.warn('No mesh named "Cylinder005" found — desk lamp light disabled.');
      deskLamp.intensity = 0;
      deskLampBulbMesh.visible = false;
    }

    // BMO screen — finds the screen mesh and sets up a canvas video texture
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
      video.preload = 'none'; // lazy — don't fetch until BMO is first focused
      video.crossOrigin = 'anonymous';

      let screenMode = 'video';

      video.addEventListener('ended', () => {
        console.log('Video ended. Changing screen color, then zooming...');
        isVideoPlaying = false;
        setBMOScreenSolidColor('#c9f4df');
        setTimeout(() => { zoomToScreenThenShowStatic(); }, 300);
      });

      video.addEventListener('pause', () => {
        if (video.ended) return;
        isVideoPlaying = false;
      });

      tvScreenMesh = screen;
      tvVideo = video;
      // screen is intentionally NOT added to clickableObjects at load — hover
      // and click on the screen mesh are gated behind BMO focus. Interaction
      // before focus is handled entirely through BMO's body (leftArm002_8).

      const g = screen.geometry;
      g.computeBoundingBox();
      const centerLocal = g.boundingBox.getCenter(new THREE.Vector3());
      g.translate(-centerLocal.x, -centerLocal.y, -centerLocal.z);
      screen.scale.set(1, 1, 1);
      screen.position.add(centerLocal);

      normalizeMeshUVs(screen);

      // --- VideoTexture pipeline 
 
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

      // setBMOScreenSolidColor — repaint the 4×4 solid texture and swap it in.
      // Kept as the same external API the rest of the file already calls.
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
      });

      video.addEventListener('error', () => {
        console.error('Video failed to load:', video.error);
      });

      // Once the video has actually decoded a frame after the initial seek,
      // swap the screen over to the VideoTexture. The texture will then show
      // the still frame as the idle image until the user clicks play.
      video.addEventListener('seeked', () => {
        if (video.paused && !isVideoPlaying) {
          screenMode = 'video';
          if (screenMaterial.map !== videoTex) {
            screenMaterial.map = videoTex;
            screenMaterial.needsUpdate = true;
          }
        }
      }, { once: true });

      // Don't load now — loadVideo() is called the first time BMO is focused.
      // This keeps the video file (50-300MB) out of memory until it's actually needed.
      let videoLoadStarted = false;
      function loadVideo() {
        if (videoLoadStarted) return;
        videoLoadStarted = true;
        video.load();
        video.currentTime = 0.066;
      }
      // Expose so the BMO click handler (outside this closure) can trigger it.
      window._loadBMOVideo = loadVideo;

      // No per-frame TV update needed — VideoTexture handles it natively.
      updateTV = null;
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

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());

    camera.position.copy(center.clone().add(new THREE.Vector3(size, size, size)));
    controls.target.copy(center);
    camera.lookAt(center);
    controls.update();

    defaultCameraPosition.copy(camera.position);
    defaultControlsTarget.copy(controls.target);

    dismissLoadingScreen();
    dracoLoader.dispose();
  },
  (xhr) => {
    const bar = document.getElementById('loadingBarFill');
    const pct = document.getElementById('loadingPercent');
    if (xhr && xhr.lengthComputable && xhr.total > 0) {
      const ratio = Math.min(1, xhr.loaded / xhr.total);
      const percent = Math.round(ratio * 100);
      if (bar) bar.style.width = percent + '%';
      if (pct) pct.textContent = percent + '%';
    } else {
      loadingScreen.classList.add('indeterminate');
      if (pct) pct.textContent = '...';
    }
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

// FPS logger — small overlay in the top-left corner showing live frame rate
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

// Adaptive quality — tracks FPS for 3s after load, auto-degrades on slow machines
let perfMode = false;           // true = bloom removed, lower pixel ratio
let perfSampleFrames = 0;
let perfSampleStart  = performance.now();
let perfModeChecked  = false;

function activatePerfMode() {
  if (perfMode) return;
  perfMode = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
  composer.removePass(bloomPass);
  fpsDisplay.title = 'performance mode active (bloom off)';
  console.log('[perf] Low FPS detected — switched to performance mode (bloom removed, pixel ratio 0.75)');
}

function checkAdaptivePerf() {
  if (perfModeChecked) return;
  perfSampleFrames++;
  const elapsed = performance.now() - perfSampleStart;
  if (elapsed >= 3000) {
    perfModeChecked = true;
    const avgFps = (perfSampleFrames * 1000) / elapsed;
    console.log(`[perf] Avg FPS over first 3s: ${avgFps.toFixed(1)}`);
    if (avgFps < 45) activatePerfMode();
  }
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

// animate — main render loop, updates TV, leg sway, focus animation, and composer
function animate() {
  requestAnimationFrame(animate);
  updateFPS();
  checkAdaptivePerf();

  if (updateTV) updateTV();

  if (paperMaterial) {
    paperMaterial.uniforms.uTime.value = performance.now() * 0.001;
  }

  if (window._rig?.leftLeg && window._rig?.rightLeg) {
    const { leftLeg, rightLeg, baseRotL, baseRotR } = window._rig;
    const t = performance.now() * 0.002;
    const angle = Math.sin(t) * 0.05;
    leftLeg.rotation.set(baseRotL.x, baseRotL.y + angle, baseRotL.z);
    rightLeg.rotation.set(baseRotR.x, baseRotR.y - angle, baseRotR.z);
  }

  animateObjectFocus();

  // BMO parallax — only active once the camera has fully settled on BMO
  // (isFocusingObject false) and we're not in the middle of escaping.
  // Move in camera-local right/up space so the offset is always perpendicular
  // to the view direction — this prevents any change in camera-to-target
  // distance (which would read as a zoom).
  if (isFocusedOnBMO && !isFocusingObject && !isEscapeAnimating) {
    controls.enabled = false; // hand-drive the camera; no OrbitControls interference

    const dt = Math.min(1 / 30, 1 / 60); // fixed step — good enough for a visual spring

    // Build camera-local axes from the settled focus position
    const forward = new THREE.Vector3().subVectors(focusControlsTarget, focusCameraPosition).normalize();
    const right   = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const up      = new THREE.Vector3().crossVectors(right, forward).normalize();

    // Target offset in world space, expressed along camera-local right/up
    bmoParallaxTarget.copy(right).multiplyScalar(mouseNDC.x * BMO_PARALLAX_STRENGTH)
      .addScaledVector(up, mouseNDC.y * BMO_PARALLAX_STRENGTH * 0.6);

    // Spring physics: acceleration = stiffness*(target-current) - damping*velocity
    const ax = BMO_PARALLAX_STIFFNESS * (bmoParallaxTarget.x - bmoParallaxCurrent.x) - BMO_PARALLAX_DAMPING * bmoParallaxVelocity.x;
    const ay = BMO_PARALLAX_STIFFNESS * (bmoParallaxTarget.y - bmoParallaxCurrent.y) - BMO_PARALLAX_DAMPING * bmoParallaxVelocity.y;
    const az = BMO_PARALLAX_STIFFNESS * (bmoParallaxTarget.z - bmoParallaxCurrent.z) - BMO_PARALLAX_DAMPING * bmoParallaxVelocity.z;
    bmoParallaxVelocity.x += ax * dt;
    bmoParallaxVelocity.y += ay * dt;
    bmoParallaxVelocity.z += az * dt;
    bmoParallaxCurrent.x  += bmoParallaxVelocity.x * dt;
    bmoParallaxCurrent.y  += bmoParallaxVelocity.y * dt;
    bmoParallaxCurrent.z  += bmoParallaxVelocity.z * dt;

    camera.position.copy(focusCameraPosition).add(bmoParallaxCurrent);
    camera.lookAt(focusControlsTarget);
  } else {
    if (!isFocusedOnBMO) {
      // Reset so there's no pop or leftover momentum when re-focusing later
      bmoParallaxCurrent.set(0, 0, 0);
      bmoParallaxVelocity.set(0, 0, 0);
    }
    if (!isEscapeAnimating && !isFocusingObject) controls.update();
  }

  const transitioning = isFocusingObject || isEscapeAnimating;

  outlinePass.enabled = !transitioning && outlinePass.selectedObjects.length > 0;

  // Bloom stays on at all times — including during camera transitions —
  // so the screen glow is visible during the zoom-in to BMO.

  // Always go through the composer so OutputPass handles tone mapping consistently.
  composer.render();
}
animate();

// animateEscape — smoothly damps the camera back to the default view on Escape
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

  camera.lookAt(controls.target);
  controls.update();

  const cameraDone = camera.position.distanceTo(defaultCameraPosition) < 0.01;
  const targetDone = controls.target.distanceTo(defaultControlsTarget) < 0.01;

  if (cameraDone && targetDone) {
    camera.position.copy(defaultCameraPosition);
    controls.target.copy(defaultControlsTarget);
    camera.lookAt(controls.target);
    controls.update();
    isEscapeAnimating = false;
    controls.enabled = true;
    // Clear focused object so Escape from the default view never re-triggers sounds
    selectedObject = null;
    outlinePass.selectedObjects = [];
    return;
  }

  requestAnimationFrame(animateEscape);
}

// beforeunload — release GPU resources promptly when navigating away.
// Without this, the renderer/textures/render-targets sit in VRAM until the
// browser GC eventually decides to free them (can take several seconds).
window.addEventListener('beforeunload', () => {
  // Stop the render loop
  renderer.setAnimationLoop(null);

  // Dispose post-processing chain
  composer.passes.forEach(pass => { if (pass.dispose) pass.dispose(); });
  composerTarget.dispose();

  // Dispose inline geometries and materials created in JS
  bulbMesh.geometry.dispose();
  bulbMesh.material.dispose();
  deskLampBulbMesh.geometry.dispose();
  deskLampBulbMesh.material.dispose();

  // Dispose BMO canvas texture if it was created
  if (tvScreenMesh?.material?.map) tvScreenMesh.material.map.dispose();

  // Dispose the beam shader material
  if (window._beam?.material) window._beam.material.dispose();

  // Renderer last — frees the WebGL context and all remaining GPU memory
  renderer.dispose();
});

// resize — updates camera aspect and composer size on window resize
window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  composer.setSize(width, height);
  composerTarget.setSize(width, height);

  // This forces the hidden outline selection texture to match the viewport pixel-for-pixel
  outlinePass.setSize(width, height);
  bloomPass.setSize(Math.floor(width / 2), Math.floor(height / 2));
});

// keydown (Escape) — triggers the camera escape animation back to default view
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !isEscapeAnimating && !hasOpenedStaticScreen && !helpOpen) {
    // Only sound if the camera was actually zoomed in on something
    if (selectedObject !== null || isFocusingObject) {
      zoomOut.currentTime = 0;
      zoomOut.volume = 0.05;
      zoomOut.play();
    }
    isFocusingObject = false;
    isEscapeAnimating = true;
    lastEscapeTime = performance.now();
    controls.enabled = false;
    // Tear down the screen's proxy + clickable entry when escaping back to default view
    isFocusedOnBMO = false;
    if (tvScreenMesh) unregisterClickable(tvScreenMesh);

    
    animateEscape();
  }
});

// focusOnObject — moves the camera to focus on a clicked object using presets or bounding box
function focusOnObject(object) {
  isEscapeAnimating = false;

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
  controls.enabled = false;
}

// animateObjectFocus — per-frame damp toward focusCameraPosition/focusControlsTarget
function animateObjectFocus() {
  if (!isFocusingObject) return;

  const now = performance.now();
  const delta = (now - lastFocusTime) / 1000;
  lastFocusTime = now;
  const smoothness = 5;

  camera.position.x = THREE.MathUtils.damp(camera.position.x, focusCameraPosition.x, smoothness, delta);
  camera.position.y = THREE.MathUtils.damp(camera.position.y, focusCameraPosition.y, smoothness, delta);
  camera.position.z = THREE.MathUtils.damp(camera.position.z, focusCameraPosition.z, smoothness, delta);
  controls.target.x = THREE.MathUtils.damp(controls.target.x, focusControlsTarget.x, smoothness, delta);
  controls.target.y = THREE.MathUtils.damp(controls.target.y, focusControlsTarget.y, smoothness, delta);
  controls.target.z = THREE.MathUtils.damp(controls.target.z, focusControlsTarget.z, smoothness, delta);

  camera.lookAt(controls.target);
  controls.update();

  const cameraDone = camera.position.distanceTo(focusCameraPosition) < 0.01;
  const targetDone = controls.target.distanceTo(focusControlsTarget) < 0.01;

  if (cameraDone && targetDone) {
    camera.position.copy(focusCameraPosition);
    controls.target.copy(focusControlsTarget);
    camera.lookAt(controls.target);
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

// logCurrentViewForObject — logs camera/target offsets for the selected object (press L)
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

// keydown (L) — logs the current camera offset for the selected object into the console
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'l') {
    if (!selectedObject) { console.log('No object selected.'); return; }
    logCurrentViewForObject(selectedObject);
  }
});

// downsampleTextures — walks all mesh materials and resizes any texture image
// larger than maxPx down to maxPx on its longest side. Runs once after GLB loads
// and can save 200-400MB since uncompressed 2048×2048 RGBA = 16MB each.
// protectRoots: array of Object3D whose entire subtree is left at full resolution.
function downsampleTextures(model, maxPx = 1024, protectRoots = []) {
  const seen = new Set();
  const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'];

  // Collect every texture UUID belonging to protected subtrees (e.g. BMO).
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

  model.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(mat => {
      TEXTURE_SLOTS.forEach(slot => {
        const tex = mat[slot];
        if (!tex || seen.has(tex.uuid)) return;
        seen.add(tex.uuid);
        if (protectedUUIDs.has(tex.uuid)) return; // keep BMO at full res

        const img = tex.image;
        if (!img || !img.width) return;
        if (img.width <= maxPx && img.height <= maxPx) return;

        const scale = maxPx / Math.max(img.width, img.height);
        const w = Math.max(1, Math.round(img.width  * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const cvs = document.createElement('canvas');
        cvs.width = w;
        cvs.height = h;
        cvs.getContext('2d').drawImage(img, 0, 0, w, h);

        tex.image = cvs;
        tex.needsUpdate = true;
      });
    });
  });
}

// normalizeMeshUVs — remaps UV coordinates to [0,1] range for canvas texture display
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

// showStaticScreen — fades to mint cover and navigates to the BMO desktop page
function showStaticScreen() {
  if (tvVideo) {
    tvVideo.pause();
    isVideoPlaying = false;
  }
  navCover.style.opacity = '1';



  setTimeout(() => {
    // Navigate to the .html path, not the clean /bmo_desktop URL. The clean
    // URL only resolves on Vercel (via vercel.json cleanUrls) — Vite's dev
    // server and `vite preview` don't know that rule, so /bmo_desktop falls
    // back to index.html and you land on the 3D title screen at that URL.
    // Going through /bmo_desktop.html works everywhere: dev/preview serve the
    // file directly, and Vercel transparently 301s to /bmo_desktop.
    window.location.href = '/bmo_desktop.html';
  }, 260);
}

// zoomToScreenThenShowStatic — zooms the camera into the TV screen then calls showStaticScreen
function zoomToScreenThenShowStatic() {
  if (!tvScreenMesh || hasOpenedStaticScreen) return;
  hasOpenedStaticScreen = true;

  const box = new THREE.Box3().setFromObject(tvScreenMesh);
  const center = box.getCenter(new THREE.Vector3());
  const direction = camera.position.clone().sub(center).normalize();
  const zoomDistance = 0.4;

  focusControlsTarget.copy(center);
  focusCameraPosition.copy(center).add(direction.multiplyScalar(zoomDistance));

  isFocusingObject = true;
  lastFocusTime = performance.now();
  controls.enabled = false;

  onFocusComplete = () => { showStaticScreen(); };
}
