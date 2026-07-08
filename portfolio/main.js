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
scene.background = new THREE.Color(0x5f6163);
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
helpTooltip.textContent = 'click an object to focus on it · press esc to reset view';
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
  background:        new THREE.Color(0x5f6163),
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

controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.minPolarAngle = 0.15;

const defaultCameraPosition = new THREE.Vector3();
const defaultControlsTarget = new THREE.Vector3();

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
const BMO_PARALLAX_STRENGTH = 0.1;  // max offset in world units
const BMO_PARALLAX_STIFFNESS = 80;  // spring pull strength
const BMO_PARALLAX_DAMPING   = 12;

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

window.addEventListener('pointerdown', (event) => {
  if (!appReady) return;



  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(interactionBoundingBoxes, false);

  if (intersects.length > 0) {
    const selected = intersects[0].object.userData.clickableTarget;

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
      isFocusedOnBMO = true;
      selectedObject = selected;
      outlinePass.selectedObjects = [selected];
      console.log('BMO focused:', selected.name);
      if (window._loadBMOVideo) window._loadBMOVideo();
      if (tvScreenMesh) registerClickable(tvScreenMesh);
      focusOnObject(selected);
      return;
    }

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
    const bmoMesh   = model.getObjectByName('leftArm002_8');
    bmoObject = bmoMesh;
    const whiteboard = model.getObjectByName('Whiteboard');
    whiteboardShadow = whiteboard;
  

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
        setBMOScreenSolidColor('#c9f4df');
        setTimeout(() => { zoomToScreenThenShowStatic(); }, 300);
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
        video.load();
        video.currentTime = 0.066;
      }
      window._loadBMOVideo = loadVideo;
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

    camera.position.copy(center.clone().add(new THREE.Vector3(size*1.1, size*0.4, size*1.1)));
    controls.target.copy(center);
    controls.maxDistance = size * 1.8;
    camera.lookAt(center);
    controls.update();

    defaultCameraPosition.copy(camera.position);
    defaultControlsTarget.copy(controls.target);

    dismissLoadingScreen();
    dracoLoader.dispose();
    warmAudio();
  },
  (xhr) => {
    const bar = document.getElementById('loadingBarFill');
    const pct = document.getElementById('loadingPercent');
    const ESTIMATED_GLB_BYTES = 68_309_076;
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

let perfMode = false;
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

function animate() {
  requestAnimationFrame(animate);
  updateFPS();
  checkAdaptivePerf();

  if (updateTV) updateTV();

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

  animateObjectFocus();

  if (isFocusedOnBMO && !isFocusingObject && !isEscapeAnimating) {
    controls.enabled = false;
    const dt = Math.min(1 / 30, 1 / 60);
    _bmoForward.subVectors(focusControlsTarget, focusCameraPosition).normalize();
    _bmoRight.crossVectors(_bmoForward, camera.up).normalize();
    _bmoUp.crossVectors(_bmoRight, _bmoForward).normalize();

    bmoParallaxTarget.copy(_bmoRight).multiplyScalar(mouseNDC.x * BMO_PARALLAX_STRENGTH)
      .addScaledVector(_bmoUp, mouseNDC.y * BMO_PARALLAX_STRENGTH * 0.6);

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
      bmoParallaxCurrent.set(0, 0, 0);
      bmoParallaxVelocity.set(0, 0, 0);
    }
    if (!isEscapeAnimating && !isFocusingObject) controls.update();
  }

  const transitioning = isFocusingObject || isEscapeAnimating;

  outlinePass.enabled = !transitioning && outlinePass.selectedObjects.length > 0;

  composer.render();
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
    selectedObject = null;
    outlinePass.selectedObjects = [];
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
    bloomPass.setSize(Math.floor(width / 2), Math.floor(height / 2));
  });
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !isEscapeAnimating && !hasOpenedStaticScreen && !helpOpen) {
    if (selectedObject !== null || isFocusingObject) {
      zoomOut.currentTime = 0;
      zoomOut.volume = 0.05;
      zoomOut.play();
    }
    isFocusingObject = false;
    isEscapeAnimating = true;
    lastEscapeTime = performance.now();
    controls.enabled = false;
    isFocusedOnBMO = false;
    if (tvScreenMesh) unregisterClickable(tvScreenMesh);

    
    animateEscape();
  }
});

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
  focusAnimStartTime = performance.now();
  controls.enabled = false;
}

function animateObjectFocus() {
  if (!isFocusingObject) return;

  const now = performance.now();
  const delta = Math.min((now - lastFocusTime) / 1000, 0.1); // clamp delta to avoid huge jumps
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
  const timedOut = (now - focusAnimStartTime) > 3000; // force-complete after 3s

  if ((cameraDone && targetDone) || timedOut) {
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

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'l') {
    if (!selectedObject) { console.log('No object selected.'); return; }
    logCurrentViewForObject(selectedObject);
  }
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

function showStaticScreen() {
  if (tvVideo) {
    tvVideo.pause();
    isVideoPlaying = false;
  }
  navCover.style.opacity = '1';



  setTimeout(() => {
    window.location.href = '/bmo_desktop';
  }, 260);
}

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
  focusAnimStartTime = performance.now();
  controls.enabled = false;

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