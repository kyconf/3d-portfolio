
// Stars
const stars = document.getElementById('stars');
const colors = ['#2a2f5a','#3a3f6a','#1a2040','#1a8a6a'];
for (let i = 0; i < 80; i++) {
  const s = document.createElement('div');
  s.className = 'star';
  s.style.left = (Math.random()*100)+'%';
  s.style.top = (Math.random()*90)+'%';
  s.style.background = colors[Math.floor(Math.random()*colors.length)];
  s.style.animationDelay = (Math.random()*3)+'s';
  stars.appendChild(s);
}

// Clock
function updateClock(){
  const d=new Date();
  document.getElementById('clock').textContent =
    String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
}
updateClock(); setInterval(updateClock,10000);

// Terminal typing
const lines = [
  ['> boot sequence initialized','t-green'],
  ['  loading kernel........... OK','t-green-dim'],
  ['  mounting /dev/pixel0..... OK','t-green-dim'],
  ['  display: 1190x842 @60Hz','t-teal-dim'],
  ['  memory: 640K (enough)','t-teal-dim'],
  ['',''],
  ['> scan landscape.dat','t-white'],
  ['  reading sectors: ████████ 100%','t-amber'],
  ['  terrain nodes: 2,847','t-teal'],
  ['  elevation range: 0-255','t-teal'],
  ['  biomes detected: 7','t-green'],
  ['',''],
  ['> render --mode=cartograph','t-white'],
  ['  projection: orthographic','t-gray'],
  ['  scale: 1px = 1km','t-gray'],
  ['  rendering complete.','t-green'],
  ['',''],
  ['> status','t-white'],
  ['  uptime: 847d 14h 23m','t-amber-dim'],
  ['  processes: 42','t-teal-dim'],
  ['  free mem: 384K','t-teal-dim'],
  ['',''],
];
const term = document.getElementById('terminal');
let li = 0;
function typeLine(){
  if(li >= lines.length){
    const cur = document.createElement('div');
    cur.innerHTML = '<span class="t-green">> <span class="cursor-blink">_</span></span>';
    term.appendChild(cur);
    return;
  }
  const div = document.createElement('div');
  div.className = lines[li][1];
  div.textContent = lines[li][0];
  div.style.opacity = '0';
  term.appendChild(div);
  requestAnimationFrame(()=>{ div.style.opacity='1'; });
  li++;
  setTimeout(typeLine, 60 + Math.random()*40);
}
setTimeout(typeLine, 400);


const cv = document.getElementById('mapCanvas');
const ctx = cv.getContext('2d');
const cw=cv.width, ch=cv.height;
const mapColors = ['#0d2847','#1a3a5a','#4a3a1a','#2d6b4f','#3d8b63','#6b5a2d','#e8e8e8'];
// simple seeded random
let seed=42;
function rand(){seed=(seed*16807+0)%2147483647;return seed/2147483647;}
for(let y=0;y<ch;y+=2){
  for(let x=0;x<cw;x+=2){
    const cx2=cw/2, cy2=ch/2;
    const dist=Math.sqrt((x-cx2)**2+(y-cy2)**2);
    const maxD=Math.min(cx2,cy2)*0.85;
    const base=Math.max(0,1-dist/maxD);
    const val=base+rand()*0.3;
    let ci=0;
    if(val<0.3)ci=0;else if(val<0.45)ci=1;else if(val<0.5)ci=2;
    else if(val<0.7)ci=3;else if(val<0.85)ci=4;else if(val<0.95)ci=5;else ci=6;
    ctx.fillStyle=mapColors[ci];
    ctx.fillRect(x,y,2,2);
  }
}
