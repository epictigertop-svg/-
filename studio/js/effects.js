// effects.js — 장면 전환 · 화면 효과 · 장르별 추천
(function () {
  'use strict';

  const ease = {
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    out: (p) => 1 - Math.pow(1 - p, 3),
    in: (p) => p * p * p,
    back: (p) => { const c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
  };

  // 결정적 난수 (프레임마다 같은 값이 나오도록)
  function hash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawT(c, R, img, s = 1, alpha = 1, rot = 0, dx = 0, dy = 0) {
    c.save();
    c.globalAlpha = alpha;
    c.translate(R.W / 2 + dx, R.H / 2 + dy);
    if (rot) c.rotate(rot);
    c.scale(s, s);
    c.drawImage(img, -R.W / 2, -R.H / 2);
    c.restore();
  }

  function white(c, R, a, color = '#fff') {
    if (a <= 0.003) return;
    c.save();
    c.globalAlpha = Math.min(1, a);
    c.fillStyle = color;
    c.fillRect(0, 0, R.W, R.H);
    c.restore();
  }

  function pixelate(c, R, img, size) {
    const w = Math.max(1, Math.round(R.W / size)), h = Math.max(1, Math.round(R.H / size));
    const p = R.pix;
    p.canvas.width = w; p.canvas.height = h;
    p.imageSmoothingEnabled = true;
    p.drawImage(img, 0, 0, w, h);
    c.save();
    c.imageSmoothingEnabled = false;
    c.drawImage(p.canvas, 0, 0, w, h, 0, 0, R.W, R.H);
    c.restore();
  }

  // ───────────────────────── 장면 전환 ─────────────────────────
  // dur: 길이(초), align: 'center'면 컷 지점 앞뒤로 걸치고 'start'면 컷 지점부터 시작
  const TRANSITIONS = [
    { id: 'punchIn', name: '펀치 인', icon: '👊', dur: 0.3, align: 'start',
      fn(c, R, A, B, p) { drawT(c, R, B, 1 + 0.35 * (1 - ease.back(p))); white(c, R, 0.35 * Math.pow(1 - p, 3)); } },
    { id: 'flash', name: '화이트 플래시', icon: '⚡', dur: 0.32, align: 'start',
      fn(c, R, A, B, p) { c.drawImage(B, 0, 0); white(c, R, Math.pow(1 - p, 2)); } },
    { id: 'whipPan', name: '휩 팬', icon: '💨', dur: 0.34, align: 'center',
      fn(c, R, A, B, p) {
        const e = ease.inOut(p), off = e * R.W, blur = Math.sin(Math.PI * p) * R.W * 0.07;
        for (let i = -2; i <= 2; i++) {
          const a = i === 0 ? 1 : 0.22;
          drawT(c, R, A, 1, a, 0, -off + i * blur);
          drawT(c, R, B, 1, a, 0, R.W - off + i * blur);
        }
      } },
    { id: 'zoomBlur', name: '줌 블러', icon: '🌀', dur: 0.4, align: 'center',
      fn(c, R, A, B, p) {
        const first = p < 0.5;
        const q = first ? ease.in(p * 2) : 1 - ease.out((p - 0.5) * 2);
        const img = first ? A : B;
        drawT(c, R, img, 1 + q * 0.25);
        for (let i = 1; i <= 4; i++) drawT(c, R, img, 1 + q * (0.25 + i * 0.13), 0.22 * q);
        white(c, R, 0.4 * Math.pow(Math.sin(Math.PI * p), 4));
      } },
    { id: 'shakeCut', name: '흔들림 컷', icon: '📳', dur: 0.36, align: 'start',
      fn(c, R, A, B, p) {
        const amp = 46 * Math.pow(1 - p, 2), k = Math.floor(p * 20);
        drawT(c, R, B, 1.08, 1, (hash(k + 9) - 0.5) * 0.06 * (1 - p), (hash(k) - 0.5) * amp, (hash(k + 3) - 0.5) * amp);
        white(c, R, 0.45 * Math.pow(1 - p, 4));
      } },
    { id: 'glitch', name: '글리치', icon: '📺', dur: 0.32, align: 'center',
      fn(c, R, A, B, p) {
        const k = Math.floor(p * 14);
        c.drawImage(p < 0.5 ? A : B, 0, 0);
        const n = 10, amp = Math.sin(Math.PI * p);
        for (let i = 0; i < n; i++) {
          const y = hash(k * 31 + i) * R.H, h = 10 + hash(k * 17 + i) * R.H * 0.08;
          const src = hash(k * 7 + i) < p ? B : A;
          const dx = (hash(k * 13 + i) - 0.5) * 120 * amp;
          c.drawImage(src, 0, y, R.W, h, dx, y, R.W, h);
        }
        if (amp > 0.5) {
          c.save(); c.globalCompositeOperation = 'difference'; c.globalAlpha = 0.25 * amp;
          c.fillStyle = hash(k) > 0.5 ? '#0ff' : '#f0f';
          c.fillRect(0, hash(k + 5) * R.H, R.W, R.H * 0.1); c.restore();
        }
      } },
    { id: 'spin', name: '회전', icon: '🔄', dur: 0.45, align: 'center',
      fn(c, R, A, B, p) {
        const first = p < 0.5;
        const q = first ? ease.in(p * 2) : 1 - ease.out((p - 0.5) * 2);
        const img = first ? A : B, dir = first ? 1 : -1;
        drawT(c, R, img, 1.3 + q * 0.6, 1, dir * q * Math.PI * 0.5);
        for (let i = 1; i <= 3; i++) drawT(c, R, img, 1.3 + q * 0.6, 0.2 * q, dir * (q * Math.PI * 0.5 - i * 0.06 * q));
      } },
    { id: 'slideUp', name: '수직 휩', icon: '⬆️', dur: 0.34, align: 'center',
      fn(c, R, A, B, p) {
        const e = ease.inOut(p), off = e * R.H, blur = Math.sin(Math.PI * p) * R.H * 0.05;
        for (let i = -2; i <= 2; i++) {
          const a = i === 0 ? 1 : 0.22;
          drawT(c, R, A, 1, a, 0, 0, -off + i * blur);
          drawT(c, R, B, 1, a, 0, 0, R.H - off + i * blur);
        }
      } },
    { id: 'zoomIn', name: '줌 인 전환', icon: '🔍', dur: 0.45, align: 'center',
      fn(c, R, A, B, p) { const e = ease.inOut(p); drawT(c, R, B, 1.25 - 0.25 * e); drawT(c, R, A, 1 + 0.8 * e, 1 - e); } },
    { id: 'split', name: '스트립 분할', icon: '🎚️', dur: 0.45, align: 'start',
      fn(c, R, A, B, p) {
        c.drawImage(A, 0, 0);
        const n = 6, w = R.W / n;
        for (let i = 0; i < n; i++) {
          const q = ease.out(Math.min(1, Math.max(0, (p - i * 0.06) / 0.64)));
          const dy = (i % 2 ? 1 : -1) * (1 - q) * R.H;
          c.drawImage(B, i * w, 0, w + 1, R.H, i * w, dy, w + 1, R.H);
        }
      } },
    { id: 'circle', name: '원형 와이프', icon: '⭕', dur: 0.5, align: 'start',
      fn(c, R, A, B, p) {
        c.drawImage(A, 0, 0);
        c.save(); c.beginPath();
        c.arc(R.W / 2, R.H / 2, ease.inOut(p) * Math.hypot(R.W, R.H) / 2, 0, Math.PI * 2);
        c.clip(); c.drawImage(B, 0, 0); c.restore();
      } },
    { id: 'pixel', name: '모자이크', icon: '🟪', dur: 0.5, align: 'center',
      fn(c, R, A, B, p) { const first = p < 0.5, q = first ? p * 2 : 2 - p * 2; pixelate(c, R, first ? A : B, 1 + 44 * ease.in(q)); } },
    { id: 'fade', name: '크로스 페이드', icon: '🌫️', dur: 0.6, align: 'center',
      fn(c, R, A, B, p) { c.drawImage(A, 0, 0); drawT(c, R, B, 1, ease.inOut(p)); } },
    { id: 'dreamy', name: '드림 페이드', icon: '☁️', dur: 0.8, align: 'center',
      fn(c, R, A, B, p) {
        const e = ease.inOut(p);
        drawT(c, R, A, 1 + 0.05 * e); drawT(c, R, B, 1.05 - 0.05 * e, e);
        c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = 0.45 * Math.sin(Math.PI * p);
        c.drawImage(R.blurOf(e < 0.5 ? A : B), 0, 0, R.W, R.H); c.restore();
      } },
    { id: 'filmBurn', name: '필름 번', icon: '🔥', dur: 0.75, align: 'center',
      fn(c, R, A, B, p) {
        c.drawImage(A, 0, 0); drawT(c, R, B, 1, ease.inOut(p));
        const a = Math.sin(Math.PI * p);
        c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = a;
        const g = c.createRadialGradient(R.W * (0.2 + 0.6 * p), R.H * 0.35, 10, R.W * 0.5, R.H * 0.5, R.H * 0.7);
        g.addColorStop(0, 'rgba(255,230,160,1)'); g.addColorStop(0.35, 'rgba(255,110,30,0.85)'); g.addColorStop(1, 'rgba(120,0,0,0)');
        c.fillStyle = g; c.fillRect(0, 0, R.W, R.H); c.restore();
      } },
    { id: 'dipBlack', name: '블랙 페이드', icon: '⬛', dur: 0.7, align: 'center',
      fn(c, R, A, B, p) { if (p < 0.5) { c.drawImage(A, 0, 0); white(c, R, p * 2, '#000'); } else { c.drawImage(B, 0, 0); white(c, R, (1 - p) * 2, '#000'); } } },
    { id: 'cut', name: '하드 컷', icon: '✂️', dur: 0, align: 'start', fn(c, R, A, B) { c.drawImage(B, 0, 0); } },
  ];

  // ───────────────────────── 화면 효과 ─────────────────────────
  // f: { t, amt(0~1 효과 강도), pulse(비트 펄스), beatIdx, since8, hlPulse, period }
  // camera(f, cam): 카메라(줌/흔들림) 조정, post(c, R, f): 완성 화면 위에 덧그리기
  // kind 'content' 는 렌더러가 장면을 그릴 때, 'timing' 은 타임라인을 만들 때 쓰입니다.
  const EFFECTS = [
    { id: 'beatZoom', accent: true, name: '비트 줌 펀치', icon: '💥', modes: ['photo', 'highlight'], desc: '비트마다 화면이 툭 튀어나와요',
      camera(f, cam) { cam.scale += 0.1 * f.pulse; } },
    { id: 'slowmo', name: '슬로우 모션', icon: '🐢', modes: ['highlight'], kind: 'timing', desc: '하이라이트를 0.5배속으로' },
    { id: 'impactFlash', name: '임팩트 플래시', icon: '⚡', modes: ['highlight'], desc: '하이라이트 시작 순간 번쩍',
      post(c, R, f) { white(c, R, 0.9 * Math.pow(f.hlPulse, 3)); } },
    { id: 'shake', accent: true, name: '흔들림', icon: '📳', modes: ['photo', 'highlight'], desc: '비트에 맞춰 화면이 흔들려요',
      camera(f, cam) {
        const k = Math.floor(f.t * 30), amp = 22 * f.pulse;
        cam.x += (hash(k) - 0.5) * 2 * amp; cam.y += (hash(k + 1.7) - 0.5) * 2 * amp;
        if (f.pulse > 0.35) cam.rot += (hash(k + 4.1) - 0.5) * 0.03 * f.pulse; cam.scale += 0.05 * f.pulse;
      } },
    { id: 'replay', name: '리플레이', icon: '🔁', modes: ['highlight'], kind: 'timing', desc: '원속도 → 슬로우로 한 번 더' },
    { id: 'rgb', accent: true, name: 'RGB 분리', icon: '🌈', modes: ['photo', 'highlight'], desc: '색이 갈라지는 크로마 효과',
      post(c, R, f) { R.chroma(c, (3 + 18 * f.pulse) * f.amt); } },
    { id: 'speedLines', name: '집중선', icon: '🎯', modes: ['highlight'], desc: '만화 같은 집중선',
      post(c, R, f) {
        if (f.amt < 0.02) return;
        const k = Math.floor(f.t * 20), cx = R.W / 2, cy = R.H / 2, r0 = R.W * 0.32, r1 = R.H;
        c.save(); c.globalAlpha = 0.55 * f.amt; c.fillStyle = '#fff'; c.beginPath();
        for (let i = 0; i < 70; i++) {
          const a = hash(k * 91 + i) * Math.PI * 2, w = 0.004 + hash(k * 37 + i) * 0.01, r = r0 + hash(k * 11 + i) * R.W * 0.25;
          c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          c.lineTo(cx + Math.cos(a - w) * r1, cy + Math.sin(a - w) * r1);
          c.lineTo(cx + Math.cos(a + w) * r1, cy + Math.sin(a + w) * r1);
        }
        c.fill(); c.restore();
      } },
    { id: 'kenBurns', name: '슬로우 줌', icon: '🎞️', modes: ['photo'], kind: 'content', desc: '사진이 천천히 확대/축소' },
    { id: 'velocity', name: '벨로시티', icon: '🏎️', modes: ['photo'], kind: 'timing', desc: '영상 클립 속도가 빠르게↔느리게' },
    { id: 'glow', name: '블룸 글로우', icon: '✨', modes: ['photo', 'highlight'], desc: '밝은 부분만 은은하게 빛나요 (선명함 유지)',
      post(c, R, f) {
        if (f.amt < 0.02) return;
        c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = (R.hasFilter ? 0.55 : 0.22) * f.amt;
        c.drawImage(R.bloomOf(R.canvas), 0, 0, R.W, R.H); c.restore();
      } },
    { id: 'sparkle', accent: true, name: '반짝이', icon: '🌟', modes: ['photo', 'highlight'], desc: '비트마다 반짝이 파티클',
      post(c, R, f) {
        if (f.amt < 0.02) return;
        const life = 1 - f.pulse;
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 16; i++) {
          const s = f.beatIdx * 53 + i;
          const x = hash(s) * R.W, y = hash(s + 0.5) * R.H;
          const sz = (R.W * 0.012 + hash(s + 0.9) * R.W * 0.03) * (0.4 + Math.sin(Math.PI * Math.min(1, life * 1.4 + hash(s + 2) * 0.3)));
          const a = Math.sin(Math.PI * Math.min(1, life + hash(s + 3) * 0.2)) * f.amt;
          if (a <= 0) continue;
          c.globalAlpha = a;
          const g = c.createRadialGradient(x, y, 0, x, y, sz * 1.6);
          g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,200,255,0)');
          c.fillStyle = g; c.fillRect(x - sz * 2, y - sz * 2, sz * 4, sz * 4);
          c.fillStyle = '#fff'; c.beginPath();
          c.moveTo(x, y - sz); c.quadraticCurveTo(x, y, x + sz, y); c.quadraticCurveTo(x, y, x, y + sz);
          c.quadraticCurveTo(x, y, x - sz, y); c.quadraticCurveTo(x, y, x, y - sz); c.fill();
        }
        c.restore();
      } },
    { id: 'flashBeat', accent: true, name: '비트 플래시', icon: '💡', modes: ['photo', 'highlight'], desc: '비트마다 하얗게 번쩍',
      post(c, R, f) { white(c, R, 0.45 * Math.pow(f.pulse, 3) * f.amt); } },
    { id: 'burst', accent: true, name: '줌 버스트', icon: '🎆', modes: ['photo', 'highlight'], desc: '비트에 잔상이 퍼져요',
      post(c, R, f) {
        const a = f.pulse * f.amt;
        if (a < 0.08) return;
        R.copy();
        [1.05, 1.12].forEach((s) => drawT(c, R, R.tmp.canvas, s, 0.25 * a));
      } },
    { id: 'colorPop', name: '컬러 팝', icon: '🎨', modes: ['photo', 'highlight'], desc: '채도·대비를 확 올려요',
      post(c, R, f) {
        if (R.hasFilter || f.amt < 0.02) return; // 필터를 지원하면 장면을 그릴 때 적용됨
        R.copy();
        c.globalCompositeOperation = 'overlay'; c.globalAlpha = 0.35 * f.amt; c.drawImage(R.tmp.canvas, 0, 0);
      } },
    { id: 'mono', name: '흑백 포인트', icon: '🖤', modes: ['photo', 'highlight'], kind: 'content', desc: '중간중간 흑백 컷 (하이라이트는 흑백→컬러)' },
    { id: 'strobe', accent: true, name: '스트로브', icon: '🚨', modes: ['photo', 'highlight'], desc: '반 박자마다 깜빡임',
      post(c, R, f) { white(c, R, 0.5 * Math.exp(-f.since8 * 16) * f.amt); } },
    { id: 'glitchFx', accent: true, name: '글리치 노이즈', icon: '👾', modes: ['photo', 'highlight'], desc: '비트에 화면이 찢어져요',
      post(c, R, f) {
        if (f.pulse * f.amt < 0.3 || hash(f.beatIdx * 3.3) < 0.35) return;
        R.copy();
        const k = Math.floor(f.t * 24);
        for (let i = 0; i < 7; i++) {
          const y = hash(k * 19 + i) * R.H, h = 8 + hash(k * 23 + i) * R.H * 0.07;
          c.drawImage(R.tmp.canvas, 0, y, R.W, h, (hash(k * 29 + i) - 0.5) * 90 * f.pulse, y, R.W, h);
        }
      } },
    { id: 'neon', name: '네온 틴트', icon: '🟣', modes: ['photo', 'highlight'], desc: '비트마다 네온 색감',
      post(c, R, f) {
        const cols = ['#ff2bd6', '#2be0ff', '#9d4bff', '#ff5c2b'];
        c.save(); c.globalCompositeOperation = 'soft-light'; c.globalAlpha = (0.45 + 0.35 * f.pulse) * f.amt;
        c.fillStyle = cols[((f.beatIdx % 4) + 4) % 4]; c.fillRect(0, 0, R.W, R.H); c.restore();
      } },
    { id: 'lightLeak', name: '빛 번짐', icon: '🌅', modes: ['photo', 'highlight'], desc: '따뜻한 필름 빛샘',
      post(c, R, f) {
        c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = (0.35 + 0.15 * Math.sin(f.t * 1.3)) * f.amt;
        const x1 = R.W * (0.5 + 0.5 * Math.sin(f.t * 0.6)), y1 = R.H * (0.2 + 0.15 * Math.cos(f.t * 0.4));
        let g = c.createRadialGradient(x1, y1, 0, x1, y1, R.H * 0.5);
        g.addColorStop(0, 'rgba(255,150,60,0.9)'); g.addColorStop(1, 'rgba(255,80,0,0)');
        c.fillStyle = g; c.fillRect(0, 0, R.W, R.H);
        const x2 = R.W * (0.5 - 0.5 * Math.sin(f.t * 0.45)), y2 = R.H * (0.85 - 0.1 * Math.sin(f.t * 0.7));
        g = c.createRadialGradient(x2, y2, 0, x2, y2, R.H * 0.45);
        g.addColorStop(0, 'rgba(255,90,170,0.8)'); g.addColorStop(1, 'rgba(255,0,120,0)');
        c.fillStyle = g; c.fillRect(0, 0, R.W, R.H); c.restore();
      } },
    { id: 'vhs', name: 'VHS 레트로', icon: '📼', modes: ['photo', 'highlight'], desc: '주사선 + 트래킹 노이즈',
      post(c, R, f) {
        if (f.amt < 0.02) return;
        R.chroma(c, 3 * f.amt);
        R.copy();
        const y = ((f.t * 260) % (R.H + 120)) - 60;
        c.drawImage(R.tmp.canvas, 0, y, R.W, 40, 10 * f.amt, y, R.W, 40);
        c.save(); c.globalAlpha = 0.5 * f.amt; c.fillStyle = R.scanPattern; c.fillRect(0, 0, R.W, R.H); c.restore();
      } },
    { id: 'grain', name: '필름 그레인', icon: '🎬', modes: ['photo', 'highlight'], desc: '자글자글한 필름 질감',
      post(c, R, f) {
        if (f.amt < 0.02) return;
        const k = Math.floor(f.t * 24);
        c.save(); c.globalAlpha = 0.6 * f.amt;
        c.translate(-hash(k) * 256, -hash(k + 1) * 256);
        c.fillStyle = R.grainPattern; c.fillRect(0, 0, R.W + 256, R.H + 256); c.restore();
      } },
    { id: 'vignette', name: '비네트', icon: '🔲', modes: ['photo', 'highlight'], desc: '가장자리를 어둡게',
      post(c, R, f) { c.save(); c.globalAlpha = f.amt; c.drawImage(R.vignette, 0, 0, R.W, R.H); c.restore(); } },
    { id: 'letterbox', name: '시네마 바', icon: '🎥', modes: ['photo', 'highlight'], desc: '위아래 검은 바',
      post(c, R, f) { const h = R.H * 0.1 * f.amt; c.fillStyle = '#000'; c.fillRect(0, 0, R.W, h); c.fillRect(0, R.H - h, R.W, h); } },
  ];

  // 화면 효과를 그리는 순서
  const POST_ORDER = ['colorPop', 'glow', 'burst', 'rgb', 'vhs', 'glitchFx', 'neon', 'lightLeak', 'sparkle', 'speedLines', 'grain', 'vignette', 'letterbox', 'flashBeat', 'strobe', 'impactFlash'];

  // ───────────────────────── 장르별 추천 ─────────────────────────
  const RECOMMEND = {
    music: {
      photo: ['kpop', 'funk', 'ballad', 'phonk'],
      highlight: ['phonk', 'edm', 'punk', 'hiphop'],
    },
    photo: {
      kpop: { tr: ['punchIn', 'flash', 'whipPan', 'zoomBlur'], fx: ['beatZoom', 'colorPop', 'sparkle', 'glow'], sfx: ['shutter', 'whoosh', 'subdrop', 'reverse'], cut: 'one' },
      funk: { tr: ['whipPan', 'shakeCut', 'zoomBlur', 'flash'], fx: ['beatZoom', 'rgb', 'neon', 'grain'], sfx: ['whoosh', 'subdrop', 'shutter', 'reverse'], cut: 'one' },
      ballad: { tr: ['dreamy', 'fade', 'filmBurn', 'dipBlack'], fx: ['kenBurns', 'glow', 'lightLeak', 'vignette'], sfx: ['reverse', 'whoosh', 'shutter', 'impact'], cut: 'two' },
      phonk: { tr: ['shakeCut', 'glitch', 'flash', 'zoomBlur'], fx: ['shake', 'rgb', 'mono', 'vhs'], sfx: ['subdrop', 'impact', 'riser', 'whoosh'], cut: 'dynamic' },
      edm: { tr: ['flash', 'zoomBlur', 'spin', 'glitch'], fx: ['beatZoom', 'burst', 'strobe', 'rgb'], sfx: ['riser', 'subdrop', 'whoosh', 'impact'], cut: 'dynamic' },
      hiphop: { tr: ['cut', 'shakeCut', 'slideUp', 'glitch'], fx: ['beatZoom', 'vhs', 'grain', 'mono'], sfx: ['subdrop', 'whoosh', 'shutter', 'reverse'], cut: 'one' },
      lofi: { tr: ['fade', 'filmBurn', 'pixel', 'dipBlack'], fx: ['kenBurns', 'grain', 'vhs', 'lightLeak'], sfx: ['reverse', 'whoosh', 'shutter', 'subdrop'], cut: 'two' },
      punk: { tr: ['shakeCut', 'glitch', 'whipPan', 'flash'], fx: ['shake', 'grain', 'rgb', 'mono'], sfx: ['impact', 'subdrop', 'whoosh', 'riser'], cut: 'one' },
      user: { tr: ['punchIn', 'flash', 'whipPan', 'zoomBlur'], fx: ['beatZoom', 'colorPop', 'sparkle', 'glow'], sfx: ['whoosh', 'subdrop', 'shutter', 'reverse'], cut: 'one' },
    },
    highlight: {
      phonk: { tr: ['flash', 'glitch', 'shakeCut', 'zoomBlur'], fx: ['slowmo', 'impactFlash', 'shake', 'rgb'], sfx: ['subdrop', 'riser', 'impact', 'whoosh'] },
      edm: { tr: ['flash', 'zoomBlur', 'spin', 'glitch'], fx: ['slowmo', 'impactFlash', 'burst', 'strobe'], sfx: ['riser', 'impact', 'subdrop', 'whoosh'] },
      punk: { tr: ['shakeCut', 'flash', 'whipPan', 'glitch'], fx: ['impactFlash', 'shake', 'speedLines', 'grain'], sfx: ['impact', 'riser', 'whoosh', 'subdrop'] },
      hiphop: { tr: ['shakeCut', 'cut', 'glitch', 'slideUp'], fx: ['slowmo', 'impactFlash', 'beatZoom', 'vhs'], sfx: ['subdrop', 'riser', 'whoosh', 'impact'] },
      funk: { tr: ['whipPan', 'flash', 'zoomBlur', 'shakeCut'], fx: ['slowmo', 'impactFlash', 'beatZoom', 'neon'], sfx: ['subdrop', 'whoosh', 'riser', 'impact'] },
      kpop: { tr: ['flash', 'punchIn', 'whipPan', 'zoomBlur'], fx: ['slowmo', 'impactFlash', 'beatZoom', 'sparkle'], sfx: ['riser', 'impact', 'whoosh', 'subdrop'] },
      ballad: { tr: ['dreamy', 'fade', 'flash', 'filmBurn'], fx: ['slowmo', 'replay', 'glow', 'vignette'], sfx: ['reverse', 'impact', 'whoosh', 'subdrop'] },
      lofi: { tr: ['fade', 'pixel', 'filmBurn', 'flash'], fx: ['slowmo', 'replay', 'vhs', 'grain'], sfx: ['reverse', 'subdrop', 'whoosh', 'impact'] },
      user: { tr: ['flash', 'zoomBlur', 'glitch', 'shakeCut'], fx: ['slowmo', 'impactFlash', 'shake', 'rgb'], sfx: ['subdrop', 'riser', 'impact', 'whoosh'] },
    },
  };

  window.FX = { TRANSITIONS, EFFECTS, POST_ORDER, RECOMMEND, ease, hash, white };
})();
