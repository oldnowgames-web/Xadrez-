import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let board, turn, selected, validMoves, gameOver, mode, botLevel;
let pieceMeshes = {}, highlightMeshes = [], animating = false;
let audioUnlocked = false, kingHighlight = null;
let timeWhite = 600, timeBlack = 600, timerInterval = null;
let pieceTemplates = {};
let useGLB = false;

// ===================== FULLSCREEN (só mobile) =====================
window.toggleFullscreen = () => {
  const doc = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    if (doc.requestFullscreen) doc.requestFullscreen();
    else if (doc.webkitRequestFullscreen) doc.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
};

// ===================== ÁUDIO =====================
let actx = null;
function unlockAudio() {
  if (audioUnlocked) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const b = actx.createBuffer(1, 1, 22050);
    const s = actx.createBufferSource();
    s.buffer = b; s.connect(actx.destination); s.start(0);
    audioUnlocked = true;
  } catch(e) {}
}
function playWoodHit(hard = false) {
  if (!actx) return;
  try {
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime;
    const bufferSize = actx.sampleRate * 0.15;
    const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random()*2-1) * Math.pow(1-i/bufferSize, 8);
    const noise = actx.createBufferSource(); noise.buffer = buffer;
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = hard ? 900 : 600;
    const gain = actx.createGain();
    gain.gain.setValueAtTime(hard ? 0.45 : 0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (hard ? 0.18 : 0.12));
    noise.connect(filter); filter.connect(gain); gain.connect(actx.destination);
    noise.start(t);
    const osc = actx.createOscillator(); const g2 = actx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(hard ? 110 : 140, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.1);
    g2.gain.setValueAtTime(hard ? 0.25 : 0.18, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(g2); g2.connect(actx.destination);
    osc.start(t); osc.stop(t + 0.15);
  } catch(e) {}
}
function playCheckSound() {
  if (!actx) return;
  try {
    if (actx.state === 'suspended') actx.resume();
    const t = actx.currentTime;
    [523, 392].forEach((f, i) => {
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.18, t + i*0.12);
      g.gain.exponentialRampToValueAtTime(0.001, t + i*0.12 + 0.25);
      o.connect(g); g.connect(actx.destination);
      o.start(t + i*0.12); o.stop(t + i*0.12 + 0.25);
    });
  } catch(e) {}
}

// ===================== TIMERS =====================
function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function updateTimerDisplay() {
  document.getElementById('time-white').textContent = formatTime(timeWhite);
  document.getElementById('time-black').textContent = formatTime(timeBlack);
  const tw = document.getElementById('timer-white');
  const tb = document.getElementById('timer-black');
  tw.classList.toggle('ativo', turn === 'w' && !gameOver);
  tb.classList.toggle('ativo', turn === 'b' && !gameOver);
  tw.classList.toggle('xeque', turn === 'w' && inCheck('w'));
  tb.classList.toggle('xeque', turn === 'b' && inCheck('b'));
}
function startTimers() {
  stopTimers();
  timerInterval = setInterval(() => {
    if (gameOver || animating) return;
    if (turn === 'w') {
      timeWhite = Math.max(0, timeWhite - 1);
      if (timeWhite <= 0) { stopTimers(); fimDeJogo('Pretas venceram!', 'Tempo esgotado das Brancas.'); }
    } else {
      timeBlack = Math.max(0, timeBlack - 1);
      if (timeBlack <= 0) { stopTimers(); fimDeJogo('Brancas venceram!', 'Tempo esgotado das Pretas.'); }
    }
    updateTimerDisplay();
  }, 1000);
}
function stopTimers() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ===================== THREE =====================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1008);
scene.fog = new THREE.Fog(0x1a1008, 18, 36);

const camera = new THREE.PerspectiveCamera(42, innerWidth/innerHeight, 0.1, 100);
camera.position.set(0, 11.5, 13.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 8;
controls.maxDistance = 22;
controls.maxPolarAngle = Math.PI / 2.15;
controls.target.set(0, 0, 0);
controls.enablePan = false; // melhor no celular

scene.add(new THREE.AmbientLight(0xfff0e0, 0.55));
const dir = new THREE.DirectionalLight(0xffe8c8, 1.2);
dir.position.set(6, 14, 8);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024); // menor no mobile pra performance
dir.shadow.camera.near = 1; dir.shadow.camera.far = 40;
dir.shadow.camera.left = dir.shadow.camera.bottom = -12;
dir.shadow.camera.right = dir.shadow.camera.top = 12;
scene.add(dir);
scene.add(new THREE.DirectionalLight(0xc8b090, 0.35).translateX(-8).translateY(6).translateZ(-5));

const SQUARE = 1.15;
const boardGroup = new THREE.Group();
scene.add(boardGroup);

const base = new THREE.Mesh(
  new THREE.BoxGeometry(8*SQUARE+1.4, 0.45, 8*SQUARE+1.4),
  new THREE.MeshStandardMaterial({ color: 0x8b5e34, roughness: 0.75 })
);
base.position.y = -0.28; base.receiveShadow = true; base.castShadow = true;
boardGroup.add(base);

const border = new THREE.Mesh(
  new THREE.BoxGeometry(8*SQUARE+1.15, 0.18, 8*SQUARE+1.15),
  new THREE.MeshStandardMaterial({ color: 0xa67c42, roughness: 0.65 })
);
border.position.y = 0.02; border.receiveShadow = true;
boardGroup.add(border);

const lightMat = new THREE.MeshStandardMaterial({ color: 0xe8c878, roughness: 0.7 });
const darkMat  = new THREE.MeshStandardMaterial({ color: 0x8f5a30, roughness: 0.75 });
const squares = [];
for (let r=0;r<8;r++) {
  squares[r] = [];
  for (let c=0;c<8;c++) {
    const sq = new THREE.Mesh(
      new THREE.BoxGeometry(SQUARE-0.03, 0.12, SQUARE-0.03),
      (r+c)%2===0 ? lightMat : darkMat
    );
    sq.position.set((c-3.5)*SQUARE, 0.1, (r-3.5)*SQUARE);
    sq.receiveShadow = true;
    sq.userData = { row:r, col:c, isSquare:true };
    boardGroup.add(sq);
    squares[r][c] = sq;
  }
}

// ===================== CARREGAR GLBs =====================
const pieceFiles = {
  'wP': 'models/GEO_WhitePawn_08.glb',
  'wR': 'models/GEO_WhiteRook_02.glb',
  'wN': 'models/GEO_WhiteKnight_02.glb',
  'wB': 'models/GEO_WhiteBishop_02.glb',
  'wQ': 'models/GEO_WhiteQueen.glb',
  'wK': 'models/GEO_WhiteKing.glb',
  'bP': 'models/GEO_BlackPawn_01.glb',
  'bR': 'models/GEO_BlackRook_01.glb',
  'bN': 'models/GEO_BlackKnight_01.glb',
  'bB': 'models/GEO_BlackBishop_01.glb',
  'bQ': 'models/GEO_BlackQueen.glb',
  'bK': 'models/GEO_BlackKing.glb'
};

function loadAllPieces() {
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    const keys = Object.keys(pieceFiles);
    let loaded = 0;

    keys.forEach(code => {
      loader.load(
        pieceFiles[code],
        (gltf) => {
          const model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model);
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);
          model.position.sub(center);
          model.position.y -= box.min.y;

          const isPawn = code.endsWith('P');
          const targetH = isPawn ? 0.92 : 1.15;
          const scale = targetH / (size.y || 0.1);
          model.scale.setScalar(scale);

          const isWhite = code.startsWith('w');
          const color = isWhite ? 0xf5f0e6 : 0x1a120a;

          model.traverse(c => {
            if (c.isMesh) {
              c.castShadow = true;
              c.receiveShadow = true;
              if (Array.isArray(c.material)) {
                c.material = c.material.map(m => {
                  const mat = m.clone();
                  mat.color.setHex(color);
                  mat.roughness = isWhite ? 0.35 : 0.5;
                  mat.metalness = isWhite ? 0.08 : 0.03;
                  return mat;
                });
              } else if (c.material) {
                c.material = c.material.clone();
                c.material.color.setHex(color);
                c.material.roughness = isWhite ? 0.35 : 0.5;
                c.material.metalness = isWhite ? 0.08 : 0.03;
              }
            }
          });

          pieceTemplates[code] = model;
          loaded++;
          if (loaded === keys.length) {
            useGLB = true;
            resolve();
          }
        },
        undefined,
        (err) => {
          console.warn('Erro', code, err);
          loaded++;
          if (loaded === keys.length) {
            useGLB = Object.keys(pieceTemplates).length > 0;
            resolve();
          }
        }
      );
    });
  });
}

function createProceduralPiece(type, color) {
  const g = new THREE.Group();
  const isW = color === 'w';
  const mat = new THREE.MeshStandardMaterial({
    color: isW ? 0xf8f4ec : 0x1a120a,
    roughness: isW ? 0.3 : 0.48,
    metalness: isW ? 0.08 : 0.03
  });
  const add = (geo, y) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  };
  add(new THREE.CylinderGeometry(0.35, 0.39, 0.11, 14), 0.055);
  add(new THREE.CylinderGeometry(0.29, 0.33, 0.07, 14), 0.13);
  if (type === 'P') {
    add(new THREE.CylinderGeometry(0.15, 0.23, 0.36, 12), 0.36);
    add(new THREE.SphereGeometry(0.185, 12, 10), 0.64);
  } else if (type === 'R') {
    add(new THREE.CylinderGeometry(0.23, 0.26, 0.55, 12), 0.46);
    add(new THREE.BoxGeometry(0.50, 0.13, 0.50), 0.80);
  } else if (type === 'N') {
    add(new THREE.CylinderGeometry(0.19, 0.25, 0.26, 12), 0.30);
  } else if (type === 'B') {
    add(new THREE.CylinderGeometry(0.17, 0.25, 0.50, 12), 0.42);
    add(new THREE.SphereGeometry(0.20, 12, 10), 0.76);
  } else if (type === 'Q') {
    add(new THREE.CylinderGeometry(0.21, 0.27, 0.52, 12), 0.44);
    add(new THREE.SphereGeometry(0.23, 12, 10), 0.80);
  } else if (type === 'K') {
    add(new THREE.CylinderGeometry(0.23, 0.29, 0.58, 12), 0.46);
    add(new THREE.SphereGeometry(0.22, 12, 10), 0.86);
  }
  g.userData = { type, color };
  return g;
}

function createPiece(type, color) {
  const code = color + type;
  if (useGLB && pieceTemplates[code]) {
    const mesh = pieceTemplates[code].clone();
    mesh.userData = { type, color };
    return mesh;
  }
  return createProceduralPiece(type, color);
}

function boardToWorld(r, c) {
  return { x: (c-3.5)*SQUARE, z: (r-3.5)*SQUARE };
}

function clearPieces() {
  Object.values(pieceMeshes).forEach(m => boardGroup.remove(m));
  pieceMeshes = {};
  if (kingHighlight) { boardGroup.remove(kingHighlight); kingHighlight = null; }
}

function placeAllPieces() {
  clearPieces();
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    const p = board[r][c];
    if (!p) continue;
    const mesh = createPiece(p[1], p[0]);
    const pos = boardToWorld(r, c);
    mesh.position.set(pos.x, 0.16, pos.z);
    mesh.userData.row = r;
    mesh.userData.col = c;
    mesh.userData.code = p;
    boardGroup.add(mesh);
    pieceMeshes[`${r},${c}`] = mesh;
  }
}

// ===================== ANIMAÇÕES =====================
function animateMoveOnly(mesh, toX, toZ) {
  return new Promise(res => {
    animating = true;
    const sx = mesh.position.x, sz = mesh.position.z, sy = mesh.position.y;
    const start = performance.now(), dur = 340;
    function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      mesh.position.x = sx + (toX - sx) * e;
      mesh.position.z = sz + (toZ - sz) * e;
      mesh.position.y = sy + Math.sin(t * Math.PI) * 0.38;
      if (t < 1) requestAnimationFrame(step);
      else {
        mesh.position.y = sy;
        animating = false;
        res();
      }
    }
    requestAnimationFrame(step);
  });
}

function animateFall(mesh) {
  return new Promise(res => {
    const startY = mesh.position.y;
    const startRotX = mesh.rotation.x;
    const startRotZ = mesh.rotation.z;
    const fallDir = Math.random() > 0.5 ? 1 : -1;
    const start = performance.now();
    const dur = 520;

    function step(now) {
      const t = Math.min(1, (now - start) / dur);
      const e = t * t;
      mesh.rotation.z = startRotZ + fallDir * e * 1.35;
      mesh.rotation.x = startRotX + e * 0.4;
      mesh.position.y = startY - e * e * 1.8;
      mesh.position.x += fallDir * 0.018;
      if (t > 0.55) {
        const fade = (t - 0.55) / 0.45;
        mesh.scale.setScalar(1 - fade * 0.85);
      }
      if (t < 1) requestAnimationFrame(step);
      else {
        boardGroup.remove(mesh);
        res();
      }
    }
    requestAnimationFrame(step);
  });
}

function clearHighlights() {
  highlightMeshes.forEach(m => boardGroup.remove(m));
  highlightMeshes = [];
}

function showHighlights() {
  clearHighlights();
  if (!selected) return;
  const sel = squares[selected.row][selected.col];
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.34, 0.47, 24),
    new THREE.MeshBasicMaterial({ color: 0xf0c060, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI/2;
  ring.position.set(sel.position.x, 0.18, sel.position.z);
  boardGroup.add(ring); highlightMeshes.push(ring);

  validMoves.forEach(m => {
    const cap = !!board[m.row][m.col];
    const geo = cap ? new THREE.RingGeometry(0.37, 0.49, 24) : new THREE.CircleGeometry(0.17, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: cap ? 0xe05040 : 0x40c060, transparent: true, opacity: 0.85, side: THREE.DoubleSide
    });
    const h = new THREE.Mesh(geo, mat);
    h.rotation.x = -Math.PI/2;
    const p = boardToWorld(m.row, m.col);
    h.position.set(p.x, 0.18, p.z);
    boardGroup.add(h); highlightMeshes.push(h);
  });
}

function updateKingHighlight() {
  if (kingHighlight) { boardGroup.remove(kingHighlight); kingHighlight = null; }
  if (!inCheck(turn)) return;
  const k = findKing(turn); if (!k) return;
  const pos = boardToWorld(k.r, k.c);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.58, 32),
    new THREE.MeshBasicMaterial({ color: 0xe74c3c, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI/2;
  ring.position.set(pos.x, 0.19, pos.z);
  boardGroup.add(ring); kingHighlight = ring;
}

// ===================== LÓGICA =====================
function resetBoard() {
  board = [
    ['bR','bN','bB','bQ','bK','bB','bN','bR'],
    ['bP','bP','bP','bP','bP','bP','bP','bP'],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    ['wP','wP','wP','wP','wP','wP','wP','wP'],
    ['wR','wN','wB','wQ','wK','wB','wN','wR']
  ];
  turn = 'w'; selected = null; validMoves = [];
  gameOver = false; animating = false;
  timeWhite = 600; timeBlack = 600;
  document.getElementById('checkBanner').classList.remove('show');
  placeAllPieces(); clearHighlights();
  updateTimerDisplay();
  startTimers();
  updateKingHighlight();
}

function findKing(color) {
  for (let r=0;r<8;r++) for (let c=0;c<8;c++)
    if (board[r][c] === color+'K') return {r,c};
  return null;
}

function isAttacked(row, col, byColor) {
  const pDir = byColor === 'w' ? -1 : 1;
  for (const dc of [-1,1]) {
    const r = row-pDir, c = col+dc;
    if (r>=0&&r<8&&c>=0&&c<8 && board[r][c]===byColor+'P') return true;
  }
  for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const r=row+dr,c=col+dc;
    if (r>=0&&r<8&&c>=0&&c<8 && board[r][c]===byColor+'N') return true;
  }
  for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
    if (!dr&&!dc) continue;
    const r=row+dr,c=col+dc;
    if (r>=0&&r<8&&c>=0&&c<8 && board[r][c]===byColor+'K') return true;
  }
  const rays = [
    {dirs:[[-1,0],[1,0],[0,-1],[0,1]], pieces:['R','Q']},
    {dirs:[[-1,-1],[-1,1],[1,-1],[1,1]], pieces:['B','Q']}
  ];
  for (const ray of rays) {
    for (const [dr,dc] of ray.dirs) {
      let r=row+dr,c=col+dc;
      while (r>=0&&r<8&&c>=0&&c<8) {
        const p = board[r][c];
        if (p) { if (p[0]===byColor && ray.pieces.includes(p[1])) return true; break; }
        r+=dr; c+=dc;
      }
    }
  }
  return false;
}

function inCheck(color) {
  const k = findKing(color); if (!k) return true;
  return isAttacked(k.r, k.c, color==='w'?'b':'w');
}

function rawMoves(row, col) {
  const piece = board[row][col]; if (!piece) return [];
  const color = piece[0], type = piece[1], moves = [];
  const valid = (r,c) => r>=0&&r<8&&c>=0&&c<8;
  const empty = (r,c) => valid(r,c)&&!board[r][c];
  const enemy = (r,c) => valid(r,c)&&board[r][c]&&board[r][c][0]!==color;

  if (type==='P') {
    const dir = color==='w'?-1:1, start = color==='w'?6:1;
    if (empty(row+dir,col)) {
      moves.push({row:row+dir,col});
      if (row===start&&empty(row+2*dir,col)) moves.push({row:row+2*dir,col});
    }
    for (const dc of [-1,1]) if (enemy(row+dir,col+dc)) moves.push({row:row+dir,col:col+dc});
  } else if (type==='N') {
    for (const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      const r=row+dr,c=col+dc;
      if (valid(r,c)&&(empty(r,c)||enemy(r,c))) moves.push({row:r,col:c});
    }
  } else if (type==='K') {
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
      if (!dr&&!dc) continue;
      const r=row+dr,c=col+dc;
      if (valid(r,c)&&(empty(r,c)||enemy(r,c))) moves.push({row:r,col:c});
    }
  } else {
    const dirs = type==='B'?[[-1,-1],[-1,1],[1,-1],[1,1]]:
                 type==='R'?[[-1,0],[1,0],[0,-1],[0,1]]:
                 [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr,dc] of dirs) {
      let r=row+dr,c=col+dc;
      while (valid(r,c)) {
        if (empty(r,c)) moves.push({row:r,col:c});
        else { if (enemy(r,c)) moves.push({row:r,col:c}); break; }
        r+=dr; c+=dc;
      }
    }
  }
  return moves;
}

function getValidMoves(row, col) {
  const piece = board[row][col]; if (!piece) return [];
  const color = piece[0];
  return rawMoves(row, col).filter(m => {
    const captured = board[m.row][m.col];
    board[m.row][m.col] = piece; board[row][col] = null;
    const ok = !inCheck(color);
    board[row][col] = piece; board[m.row][m.col] = captured;
    return ok;
  });
}

function hasAnyLegalMove(color) {
  for (let r=0;r<8;r++) for (let c=0;c<8;c++)
    if (board[r][c]&&board[r][c][0]===color&&getValidMoves(r,c).length) return true;
  return false;
}

async function makeMove(fromR, fromC, toR, toC) {
  const piece = board[fromR][fromC];
  const captured = board[toR][toC];
  const keyFrom = `${fromR},${fromC}`;
  const mesh = pieceMeshes[keyFrom];
  const pos = boardToWorld(toR, toC);

  if (mesh) {
    delete pieceMeshes[keyFrom];
    await animateMoveOnly(mesh, pos.x, pos.z);
  }

  if (captured) {
    playWoodHit(true);
    const key = `${toR},${toC}`;
    if (pieceMeshes[key]) {
      const capMesh = pieceMeshes[key];
      delete pieceMeshes[key];
      await animateFall(capMesh);
    }
  } else {
    playWoodHit(false);
  }

  board[toR][toC] = piece;
  board[fromR][fromC] = null;
  if (piece[1]==='P'&&(toR===0||toR===7)) board[toR][toC] = piece[0]+'Q';

  if (mesh) {
    mesh.userData.row = toR; mesh.userData.col = toC;
    mesh.userData.code = board[toR][toC];
    pieceMeshes[`${toR},${toC}`] = mesh;

    if (piece[1]==='P'&&(toR===0||toR===7)) {
      boardGroup.remove(mesh);
      const nm = createPiece('Q', piece[0]);
      nm.position.set(pos.x, 0.16, pos.z);
      nm.userData.row=toR; nm.userData.col=toC; nm.userData.code=board[toR][toC];
      boardGroup.add(nm);
      pieceMeshes[`${toR},${toC}`] = nm;
    }
  }

  turn = turn==='w' ? 'b' : 'w';
  updateTimerDisplay();

  if (!hasAnyLegalMove(turn)) {
    stopTimers();
    if (inCheck(turn)) {
      fimDeJogo(turn==='w'?'Pretas venceram!':'Brancas venceram!', 'Xeque-mate!');
    } else {
      fimDeJogo('Empate!', 'Afogamento (stalemate).');
    }
    return;
  }

  if (inCheck(turn)) {
    document.getElementById('checkBanner').classList.add('show');
    playCheckSound();
    setTimeout(() => document.getElementById('checkBanner').classList.remove('show'), 1600);
  }
  updateKingHighlight();
}

function evaluate() {
  const val = {P:10,N:30,B:32,R:50,Q:90,K:900};
  let s = 0;
  for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
    const p = board[r][c]; if (!p) continue;
    const v = val[p[1]]||0;
    s += p[0]==='b' ? v : -v;
    const center = 3.5;
    s += (p[0]==='b'?1:-1) * (4-(Math.abs(r-center)+Math.abs(c-center)))*0.4;
  }
  return s;
}

function botPlay() {
  if (gameOver||turn!=='b'||animating) return;
  const all = [];
  for (let r=0;r<8;r++) for (let c=0;c<8;c++)
    if (board[r][c]&&board[r][c][0]==='b')
      getValidMoves(r,c).forEach(m => all.push({from:{row:r,col:c},to:m}));
  if (!all.length) return;

  let chosen;
  if (botLevel==='easy') chosen = all[Math.floor(Math.random()*all.length)];
  else if (botLevel==='medium') {
    const caps = all.filter(m => board[m.to.row][m.to.col]);
    chosen = caps.length ? caps[Math.floor(Math.random()*caps.length)] : all[Math.floor(Math.random()*all.length)];
  } else {
    let best=-Infinity, bestMoves=[];
    for (const m of all) {
      const cap=board[m.to.row][m.to.col], from=board[m.from.row][m.from.col];
      board[m.to.row][m.to.col]=from; board[m.from.row][m.from.col]=null;
      const score=evaluate()+Math.random()*2;
      board[m.from.row][m.from.col]=from; board[m.to.row][m.to.col]=cap;
      if (score>best){best=score;bestMoves=[m];}
      else if(score>best-1.5) bestMoves.push(m);
    }
    chosen = bestMoves[Math.floor(Math.random()*bestMoves.length)];
  }
  makeMove(chosen.from.row, chosen.from.col, chosen.to.row, chosen.to.col).then(()=>{
    selected=null; validMoves=[]; clearHighlights();
  });
}

// ===================== CLIQUE / TOQUE =====================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function onClick(e) {
  unlockAudio();
  if (gameOver||animating) return;
  if (mode==='bot'&&turn==='b') return;

  const clientX = e.clientX ?? (e.changedTouches && e.changedTouches[0].clientX);
  const clientY = e.clientY ?? (e.changedTouches && e.changedTouches[0].clientY);
  if (clientX === undefined) return;

  mouse.x = (clientX/innerWidth)*2-1;
  mouse.y = -(clientY/innerHeight)*2+1;
  raycaster.setFromCamera(mouse, camera);

  let row, col;
  const hits = raycaster.intersectObjects(Object.values(pieceMeshes), true);
  if (hits.length) {
    let o = hits[0].object;
    while (o.parent && !o.userData.code) o = o.parent;
    if (o.userData.code) { row = o.userData.row; col = o.userData.col; }
  }
  if (row === undefined) {
    const sqs = [];
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) sqs.push(squares[r][c]);
    const sh = raycaster.intersectObjects(sqs);
    if (sh.length) { row = sh[0].object.userData.row; col = sh[0].object.userData.col; }
  }
  if (row === undefined) return;

  const piece = board[row][col];
  if (selected) {
    if (selected.row===row && selected.col===col) {
      selected=null; validMoves=[]; clearHighlights(); return;
    }
    const mv = validMoves.find(m => m.row===row && m.col===col);
    if (mv) {
      makeMove(selected.row, selected.col, row, col).then(() => {
        selected=null; validMoves=[]; clearHighlights();
        if (mode==='bot' && !gameOver && turn==='b') setTimeout(botPlay, 450);
      });
      return;
    }
  }
  if (piece && piece[0]===turn) {
    selected = {row, col};
    validMoves = getValidMoves(row, col);
    showHighlights();
  } else {
    selected=null; validMoves=[]; clearHighlights();
  }
}

// Suporte a mouse e toque
let startX, startY;
renderer.domElement.addEventListener('pointerdown', e => {
  startX = e.clientX; startY = e.clientY;
});
renderer.domElement.addEventListener('pointerup', e => {
  if (Math.abs(e.clientX - startX) < 8 && Math.abs(e.clientY - startY) < 8) {
    onClick(e);
  }
});

// ===================== UI =====================
window.abrirModos = () => {
  unlockAudio();
  document.getElementById('menu').classList.add('escondido');
  document.getElementById('modos').classList.remove('escondido');
};
window.abrirDificuldade = () => {
  document.getElementById('modos').classList.add('escondido');
  document.getElementById('dificuldade').classList.remove('escondido');
};
window.voltarModos = () => {
  document.getElementById('dificuldade').classList.add('escondido');
  document.getElementById('modos').classList.remove('escondido');
};
window.voltarMenu = () => {
  stopTimers();
  document.getElementById('hud').classList.remove('ativo');
  document.getElementById('dica').classList.remove('ativo');
  document.getElementById('modos').classList.add('escondido');
  document.getElementById('dificuldade').classList.add('escondido');
  document.getElementById('fim').classList.add('escondido');
  document.getElementById('checkBanner').classList.remove('show');
  document.getElementById('menu').classList.remove('escondido');
  gameOver = true;
};
window.startGame = (m, level='medium') => {
  mode = m; botLevel = level;
  document.getElementById('modos').classList.add('escondido');
  document.getElementById('dificuldade').classList.add('escondido');
  document.getElementById('hud').classList.add('ativo');
  document.getElementById('dica').classList.add('ativo');
  reiniciar();
};
window.reiniciar = () => {
  document.getElementById('fim').classList.add('escondido');
  resetBoard();
};
function fimDeJogo(titulo, msg) {
  gameOver = true; stopTimers();
  document.getElementById('titulo-fim').textContent = titulo;
  document.getElementById('msg-fim').textContent = msg;
  document.getElementById('fim').classList.remove('escondido');
}

function onResize() {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 150));

(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
})();

loadAllPieces().then(() => {
  document.getElementById('loading').classList.add('escondido');
});