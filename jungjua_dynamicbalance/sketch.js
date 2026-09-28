const { Engine, Bodies, Body, Composite, Events, Constraint } = Matter;

// 1. 조정 가능 값
const W = 2000, H = 2000;    //캔버스 크기          
const FLOOR_Y = 1786;    //바닥 높이          
const GRAVITY = 2.2;    //중력 세기             
const START_DELAY = 2.0;    //시작       
const DROP_INTERVAL = 0.28;    //공 떨어지는 시간 간격
const SEED = 7;    //순서               

const BALL_DENSITY   = 0.0075;    //공 밀도 
const BALL_BOUNCE    = 0.97;    //탄성   
const DOLL_DENSITY   = 0.0015;    //오뚝이 밀도
const WEIGHT_DENSITY = 0.06;    //오뚝이 추   

// 2. 색, 도형
const COL = {
  bg:    '#fefefe',    //배경색
  peach: '#eecbb3',    //공
  ink:   '#1c0300',    //공에 갈색
  red:   '#ae1800',    //오뚝이 왼쪽
  brown: '#2b0700',    //오뚝이 오른쪽
};

// 오뚝이 위치, 크기
const DOLL = {
  x: 996.5,
  bot: { y: 1564.5, r: 221.5 },
  top: { y: 1277,   r: 136   },
  neckFillet: 18,
};

// 공 15개 위치, 반지름
const BALL_DEFS = [
  { x: 473,  y: 337, r: 85, color: '#E8AA0D' },    //노란 원
  { x: 610,  y: 133, r: 63 },    //그냥 원
  { x: 598,  y: 249, r: 42 },
  { x: 459,  y: 185, r: 33, dark: { nx: -0.589, ny: -0.808, d: 15.4 } },    //갈색 있는 원
  { x: 755,  y: 233, r: 109, dark: { nx: 0.898,  ny: -0.439, d: 37.1 } },
  { x: 913,  y: 125, r: 67, color: '#E8AA0D' },
  { x: 974,  y: 284, r: 88 },
  { x: 1112,  y: 157, r: 62 },
  { x: 1153,  y: 386, r: 48 },
  { x: 1275,  y: 219, r: 97, dark: { nx: 0.084,  ny: 0.996,  d: 13 } },
  { x: 1306, y: 406, r: 60, dark: { nx: -0.916, ny: 0.403,  d: 24.7 } },
  { x: 1433, y: 93,  r: 36 },
  { x: 1469, y: 228, r: 72 },
  { x: 1536, y: 372, r: 80 },
  { x: 606,  y: 430, r: 34, dark: { nx: 0.977,  ny: -0.214, d: -9.2 } },
];

// 3. 상태
const STEP = 1000 / 120;  
let engine, doll, dollBot, dollTop;
let balls = [];
let acc = 0, simTime = 0;
let releaseQueue = [];
let lastRelease = 0;
let calmTimer = 0, settleStart = -1;

// 일관된 결과 만들기
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// 4. 물리 세계
function buildWorld() {
  engine = Engine.create();
  engine.gravity.y = GRAVITY;
  engine.positionIterations = 10;
  engine.velocityIterations = 10;
  const world = engine.world;

  // 벽, 바닥
  const wallOpt = { isStatic: true, restitution: 0.9, friction: 0.6 };    //안 보이는 면 설정
  Composite.add(world, [
    Bodies.rectangle(W / 2, FLOOR_Y + 300, W * 3, 600, { ...wallOpt, friction: 1 }),    //바닥
    Bodies.rectangle(-300, H / 2 - 1500, 600, H * 4, wallOpt),    //왼쪽 벽
    Bodies.rectangle(W + 300, H / 2 - 1500, 600, H * 4, wallOpt),    //오른쪽 벽
    Bodies.rectangle(W / 2, -300, W * 3, 600, wallOpt),    //천장
  ]);

  // 5. 오뚝이
  // (큰 원+작은 원+보이지 않는 아래쪽 추)
  const partOpt = { density: DOLL_DENSITY, friction: 0.9, frictionStatic: 1, restitution: 0.6 };
  dollBot = Bodies.circle(DOLL.x, DOLL.bot.y, DOLL.bot.r, { ...partOpt, label: 'dollPart' }, 90);    //(x, y, 반지름, 옵션, 조각수)
  dollTop = Bodies.circle(DOLL.x, DOLL.top.y, DOLL.top.r, { ...partOpt, label: 'dollPart' }, 70);
  const weight = Bodies.circle(DOLL.x, DOLL.bot.y + 150, 65, {
    density: WEIGHT_DENSITY, label: 'weight', collisionFilter: { mask: 0 },
  }, 30);    //오뚝이 고정하는 추
  doll = Body.create({
    parts: [dollBot, dollTop, weight],
    friction: 0.9, frictionStatic: 1, restitution: 0.6,
    frictionAir: 0.004,
  });    //오뚝이 합체
  Composite.add(world, doll);

  // 오뚝이 고정
  const dollAnchor = { x: doll.position.x, y: doll.position.y }; 
  const dollPin = Constraint.create({
    pointA: dollAnchor,
    bodyB: doll,
    pointB: { x: 0, y: 0 },
    stiffness: 1,
    length: 0,
  });
  Composite.add(world, dollPin);

  // 6. 공 15개
  balls = BALL_DEFS.map(def => {
    const b = Bodies.circle(def.x, def.y, def.r, {
      density: BALL_DENSITY, restitution: BALL_BOUNCE,
      friction: 0.25, frictionStatic: 0.3, frictionAir: 0,
      label: 'ball',
    }, 48);
    b.dark = def.dark || null;    //검은 무늬
    b.color = def.color || null;    //기본 살구색
    b.released = false;    //공이 떨어졌는지 상태
    Body.setStatic(b, true);
    b.collisionFilter.mask = 0;          // 떠 있는 동안은 아무하고도 부딪히지 않음
    Composite.add(world, b);
    return b;
  });

  // 떨어지는 순서
  const order = balls.slice().sort((a, b) =>
    (b.position.y + rng() * 90) - (a.position.y + rng() * 90));    //아래 공부터 떨어짐+약간 랜덤
  releaseQueue = order.map((b, i) => ({
    ball: b,
    t: START_DELAY + i * DROP_INTERVAL + rng() * 0.12,
  }));
  lastRelease = releaseQueue[releaseQueue.length - 1].t;
}

// 7. 공 떨어뜨리기
function releaseBall(b) {
  Body.setStatic(b, false);
  b.collisionFilter.mask = 0xFFFFFFFF;
  b.released = true;

  // 오뚝이한테 날리기
  const aimX = DOLL.x + (rng() - 0.5) * 2 * 270;
  const dy = Math.max(250, (DOLL.top.y - DOLL.top.r) - b.position.y);  
  const t = Math.sqrt(2 * dy / (GRAVITY * 1000));          
  const vx = Math.max(-1300, Math.min(1300, (aimX - b.position.x) / t));  
  const vy = 260 + rng() * 140;                          
  const spin = (rng() - 0.5) * 14;             
  Body.setVelocity(b, { x: vx * STEP / 1000, y: vy * STEP / 1000 });
  Body.setAngularVelocity(b, spin * STEP / 1000);
}

// 8. 움직임
function stepSim() {
  simTime += STEP / 1000;

  while (releaseQueue.length && releaseQueue[0].t <= simTime) {
    releaseBall(releaseQueue.shift().ball);
  }    //남은 공 떨어뜨리기

  Engine.update(engine, STEP);    //물리 계산(중력, 회전, 충돌 같은 것) 

  // 공 정지
  let allCalm = releaseQueue.length === 0;    //공이 잠잠해졌는지 확인
  for (const b of balls) {
    if (!b.released) continue;
    const sp = Math.hypot(b.velocity.x, b.velocity.y);
    if (b.position.y + b.circleRadius > FLOOR_Y - 4) {
      Body.setVelocity(b, { x: b.velocity.x * 0.992, y: b.velocity.y });
      Body.setAngularVelocity(b, b.angularVelocity * 0.985);
    }
    if (sp > 0.35) allCalm = false;
  }

  // 마지막 장면
  calmTimer = allCalm ? calmTimer + STEP / 1000 : 0;
  if (settleStart < 0 && (calmTimer > 1.0 || simTime > lastRelease + 16)) settleStart = simTime;

  const e = wrapAngle(doll.angle - 0);
  if (Math.abs(e) > 1.4) {
    Body.setAngularVelocity(doll, doll.angularVelocity - Math.sign(e) * 0.0008);
  }
  if (settleStart >= 0) {
    const k = Math.min(1, (simTime - settleStart) / 5);
    const wv = doll.angularVelocity;
    Body.setAngularVelocity(doll, wv + (-e * 1.6e-4 - wv * 0.02) * k);
  }
}    //공 다 멈추면 오뚝이 세우기

// 9. 그리기
function drawBallShape(ctx, r, dark, fillColor) {
  ctx.fillStyle = fillColor || COL.peach;    //원 채색
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  if (dark) {
    const a = Math.atan2(dark.ny, dark.nx);
    const phi = Math.acos(Math.max(-1, Math.min(1, dark.d / r)));
    ctx.fillStyle = COL.ink;
    ctx.beginPath(); ctx.arc(0, 0, r, a - phi, a + phi); ctx.closePath(); ctx.fill();
  }    //원 덧칠
}

// 오뚝이 설정
//R: 몸통 반지름, r: 머리 반지름, D: 머리 몸통 사이 거리, rf: 목 부분 원 반지름
function fillDollSilhouette(ctx) {
  const R = DOLL.bot.r, r = DOLL.top.r, D = DOLL.bot.y - DOLL.top.y, rf = DOLL.neckFillet;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, -D, r, 0, Math.PI * 2); ctx.fill();

  // 목 부분 
  // dB: 목 이음새 중심 반지름+몸통 반지름, a: 몸통 중심으로부터 머리 중심 쪽으로 얼마나 내려간(또는 올라간) 지점인지, h: 좌우로 얼마나 벗어나야 실제 목 이음새 원의 중심이 되는지
  const dB = R + rf, dT = r + rf;
  const a = (dB * dB - dT * dT + D * D) / (2 * D);
  const h = Math.sqrt(dB * dB - a * a);
  for (const sgn of [-1, 1]) {
    const cf = { x: sgn * h, y: -a };
    const B = { x: 0, y: 0 }, T = { x: 0, y: -D };
    const tB = { x: cf.x / dB * R, y: cf.y / dB * R };
    const vT = { x: (cf.x - T.x) / dT, y: (cf.y - T.y) / dT };
    const tT = { x: T.x + vT.x * r, y: T.y + vT.y * r };
    const aT = Math.atan2(T.y - cf.y, T.x - cf.x);
    const aB = Math.atan2(B.y - cf.y, B.x - cf.x);
    const diff = wrapAngle(aB - aT);
    ctx.beginPath();
    ctx.moveTo(T.x, T.y);
    ctx.lineTo(tT.x, tT.y);
    ctx.arc(cf.x, cf.y, rf, aT, aT + diff, diff < 0);
    ctx.lineTo(B.x, B.y);
    ctx.closePath();
    ctx.fill();
  }
}

function drawDollShape(ctx) {
  ctx.fillStyle = COL.brown;    //오뚝이 갈색 채색
  fillDollSilhouette(ctx);    
  ctx.save();
  ctx.beginPath(); ctx.rect(-1000, -1000, 1000, 3000); ctx.clip();   //오뚝이 빨강 채색
  ctx.fillStyle = COL.red;
  fillDollSilhouette(ctx);
  ctx.restore();
}

// 10. setup

//캔버스
function setup() {
  createCanvas(windowWidth, windowHeight);
  frameRate(60);
  buildWorld();
  if (location.hash === '#test') noLoop();
}

// 창 크기 바뀌면 캔버스 맞추기
function windowResized() { resizeCanvas(windowWidth, windowHeight); }

// 11. draw
function draw() {
  acc += Math.min(deltaTime || 0, 60);    //화면 속도와 물리 계산 속도
  let n = 0;
  while (acc >= STEP && n < 12) { stepSim(); acc -= STEP; n++; }
  //화면 맞추기
  background(COL.bg);
  const s = Math.min(width / W, height / H);    
  const ctx = drawingContext;
  //중앙 배치
  push();
  translate((width - W * s) / 2, (height - H * s) / 2);
  scale(s);

  // 오뚝이 그리기
  ctx.save();
  ctx.translate(dollBot.position.x, dollBot.position.y);
  ctx.rotate(doll.angle);
  drawDollShape(ctx);
  ctx.restore();

  // 공 그리기
  for (const b of balls) {
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    drawBallShape(ctx, b.circleRadius, b.dark, b.color);
    ctx.restore();
  }
  pop();
} 
