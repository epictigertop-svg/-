// engine.js — 타임라인 생성 · 캔버스 렌더러 · 영상 동기화 · 재생 · 내보내기
(function () {
  'use strict';
  const { TRANSITIONS, EFFECTS, POST_ORDER, hash } = window.FX;
  const TR = Object.fromEntries(TRANSITIONS.map((t) => [t.id, t]));
  const EF = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));

  function canvas2d(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c.getContext('2d');
  }

  // 벨로시티 곡선: 느림 → 빠름 → 느림 (평균 속도 1)
  const VEL_A = 0.8;
  const velPos = (p) => p - (VEL_A * Math.sin(2 * Math.PI * p)) / (2 * Math.PI);
  const velRate = (p) => 1 - VEL_A * Math.cos(2 * Math.PI * p);

  // ───────────────────────── 타임라인 ─────────────────────────
  const AUTO_MIN = 12; // 자동 길이일 때 최소 길이(초) — 사진이 적으면 반복
  const CUT_PATTERNS = {
    half: [0.5], one: [1], two: [2], four: [4],
    dynamic: [2, 1, 1, 2, 0.5, 0.5, 1, 2, 1, 1, 4],
  };

  function pickTransitions(ids, n, seed) {
    const list = ids.length ? ids : ['cut'];
    const out = [];
    let last = null;
    for (let i = 0; i < n; i++) {
      let id = list[Math.floor(hash(seed + i * 7.31) * list.length)];
      if (list.length > 1 && id === last) id = list[(list.indexOf(id) + 1) % list.length];
      out.push(id); last = id;
    }
    return out;
  }

  function trFor(id, segDur, prevDur) {
    const d = TR[id] || TR.cut;
    return { id: d.id, align: d.align, dur: Math.min(d.dur, segDur * 0.6, prevDur * 0.6) };
  }

  // 인물 편집: 사진/짧은 클립을 비트에 맞춰 컷
  function buildPhoto(st) {
    const items = st.items;
    const bpm = st.bpm, period = 60 / bpm;
    const pat = CUT_PATTERNS[st.cutSpeed] || CUT_PATTERNS.one;
    const maxDur = Math.min(st.musicMax || Infinity, 180);
    if (!items.length) return null;
    // 자동 길이: 사진은 최소 12초, 영상은 원본 길이의 70% 정도로 (박자 단위로 띄엄띄엄 건너뛰며 컷)
    let target = Number(st.length);
    if (st.length === 'auto') {
      const imgs = items.filter((x) => x.kind === 'image').length;
      const vidDur = items.reduce((a, x) => a + (x.kind === 'video' ? Math.max(0, x.duration - (x.start || 0)) : 0), 0);
      const bar = period * 4;
      target = Math.max(imgs ? AUTO_MIN : 6, Math.min(60, vidDur * 0.7));
      target = Math.ceil(target / bar - 0.15) * bar;
    }
    const segs = [];
    let t = 0, i = 0;
    while (t < target - 0.01) {
      const item = items[i % items.length];
      let dur = pat[i % pat.length] * period;
      if (t + dur > maxDur) break;
      if (t + dur > target) dur = target - t;
      segs.push({ kind: item.kind, item, start: t, dur, rate: 1, idx: i, mono: st.fx.has('mono') && i % 4 === 3 });
      t += dur; i++;
    }
    // 영상 클립: 같은 영상이 여러 번 나오면 원본을 고르게 훑으며 매 컷마다 다른 장면으로 점프
    items.filter((x) => x.kind === 'video').forEach((item) => {
      const occ = segs.filter((s) => s.item === item);
      if (!occ.length) return;
      const start = item.start || 0, end = item.duration - 0.05;
      const usable = end - start, needed = occ.reduce((a, s) => a + s.dur, 0);
      const gap = needed < usable ? (usable - needed) / occ.length : 0;
      let pos = start;
      occ.forEach((seg) => {
        if (pos + seg.dur > end) pos = needed < usable ? Math.max(start, end - seg.dur) : start;
        seg.srcIn = pos;
        seg.srcDur = Math.min(seg.dur, Math.max(0.1, end - pos));
        seg.vel = st.fx.has('velocity');
        seg.rate = seg.srcDur / seg.dur;
        pos += seg.srcDur + gap;
      });
    });
    if (!segs.length) return null;
    const trIds = pickTransitions([...st.transitions], segs.length, 3.7);
    for (let k = 1; k < segs.length; k++) segs[k].tr = trFor(trIds[k], segs[k].dur, segs[k - 1].dur);

    // 효과음 위치
    const sfx = [];
    const ids = [...st.sfx];
    segs.forEach((s, k) => {
      const beat = Math.round(s.start / period);
      let on = false;
      if (st.sfxDensity === 'every') on = k > 0;
      else if (st.sfxDensity === 'bar') on = k > 0 && beat % 4 === 0;
      else if (st.sfxDensity === 'twobar') on = k > 0 && beat % 8 === 0;
      else if (st.sfxDensity === 'start') on = k === 0;
      if (on || (k === 0 && st.sfxDensity !== 'none')) ids.forEach((id) => sfx.push({ t: s.start, id }));
    });
    return { mode: 'photo', segs, duration: t, bpm, period, beatOffset: 0, groups: [], sfx: dedupeSfx(sfx) };
  }

  function dedupeSfx(list) {
    const pre = Object.fromEntries(window.Music.SFX.map((s) => [s.id, s.pre]));
    return list.filter((e) => e.t >= (pre[e.id] || 0) - 0.001 || e.t === 0);
  }

  // 하이라이트 편집: 사용자가 정한 구간에 화려한 효과
  function buildHighlight(st) {
    const sources = st.sources.filter((s) => s.duration);
    if (!sources.length) return null;
    const slow = st.fx.has('slowmo'), replay = st.fx.has('replay');
    const slowRate = 0.5;
    const raw = []; // {item, srcIn, srcDur, rate, hl, group, joinPrev}
    let group = 0;
    const merged = (src) => {
      const list = src.highlights.map((h) => [Math.max(0, h.a), Math.min(src.duration, h.b)]).filter(([a, b]) => b - a > 0.1).sort((x, y) => x[0] - y[0]);
      const out = [];
      list.forEach((r) => { const l = out[out.length - 1]; if (l && r[0] <= l[1] + 0.05) l[1] = Math.max(l[1], r[1]); else out.push(r.slice()); });
      return out;
    };
    const pushHL = (item, a, b) => {
      group++;
      if (replay) {
        raw.push({ item, srcIn: a, srcDur: b - a, rate: 1, hl: true, group, joinPrev: true });
        raw.push({ item, srcIn: a, srcDur: b - a, rate: slow ? slowRate : 0.65, hl: true, group, replay: true });
      } else raw.push({ item, srcIn: a, srcDur: b - a, rate: slow ? slowRate : 1, hl: true, group, joinPrev: true });
    };
    const anyHL = sources.some((s) => merged(s).length);
    const structure = anyHL ? st.structure : 'full';
    sources.forEach((src, si) => {
      const hls = merged(src);
      if (structure === 'compile') {
        hls.forEach(([a, b]) => {
          const pre = Math.max(0, a - st.leadIn);
          if (a - pre > 0.2) raw.push({ item: src, srcIn: pre, srcDur: a - pre, rate: 1, hl: false, newClip: true });
          const before = raw.length;
          pushHL(src, a, b);
          if (a - pre <= 0.2) raw[before].newClip = true;
        });
      } else {
        let cur = 0;
        const first = raw.length;
        hls.forEach(([a, b]) => {
          if (a - cur > 0.15) raw.push({ item: src, srcIn: cur, srcDur: a - cur, rate: 1, hl: false });
          pushHL(src, a, b);
          cur = b;
        });
        if (src.duration - cur > 0.15) raw.push({ item: src, srcIn: cur, srcDur: src.duration - cur - 0.05, rate: 1, hl: false });
        if (raw[first]) raw[first].newClip = si > 0;
      }
    });
    if (!raw.length) return null;

    const segs = [];
    let t = 0;
    raw.forEach((r, i) => {
      const dur = r.srcDur / r.rate;
      segs.push({ kind: 'video', item: r.item, srcIn: r.srcIn, srcDur: r.srcDur, rate: r.rate, start: t, dur, hl: r.hl, group: r.group, replay: r.replay, newClip: r.newClip, idx: i });
      t += dur;
    });
    const trIds = pickTransitions([...st.transitions], segs.length, 5.1);
    for (let k = 1; k < segs.length; k++) {
      const s = segs[k];
      if (s.replay) s.tr = trFor('flash', s.dur, segs[k - 1].dur);
      else if (s.newClip) s.tr = trFor(trIds[k], s.dur, segs[k - 1].dur);
    }
    // 하이라이트 그룹(시작~끝)
    const groups = [];
    segs.forEach((s) => {
      if (!s.hl) return;
      const g = groups.find((x) => x.id === s.group);
      if (g) g.e = s.start + s.dur; else groups.push({ id: s.group, s: s.start, e: s.start + s.dur });
    });
    const sfx = [];
    groups.forEach((g) => st.sfx.forEach((id) => sfx.push({ t: g.s, id })));
    segs.forEach((s) => { if (s.replay && st.sfx.has('whoosh')) sfx.push({ t: s.start, id: 'whoosh' }); });
    const period = 60 / st.bpm;
    return { mode: 'highlight', segs, duration: t, bpm: st.bpm, period, beatOffset: 0, groups, sfx: dedupeSfx(sfx) };
  }

  // 시간 t에 보이는 장면(전환 중이면 두 장면)
  function locate(tl, t) {
    const segs = tl.segs;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].start <= t) lo = mid; else hi = mid - 1;
    }
    const i = lo, cur = segs[i];
    if (cur.tr && cur.tr.dur > 0 && i > 0) {
      const ts = cur.start - (cur.tr.align === 'center' ? cur.tr.dur / 2 : 0);
      if (t < ts + cur.tr.dur) return { i, cur, prev: segs[i - 1], p: Math.max(0, (t - ts) / cur.tr.dur), tr: cur.tr };
    }
    const nx = segs[i + 1];
    if (nx && nx.tr && nx.tr.dur > 0 && nx.tr.align === 'center') {
      const ts = nx.start - nx.tr.dur / 2;
      if (t >= ts) return { i: i + 1, cur: nx, prev: cur, p: (t - ts) / nx.tr.dur, tr: nx.tr };
    }
    return { i, cur, prev: null, p: 1, tr: null };
  }

  function srcPos(seg, t) {
    const local = Math.min(Math.max(0, t - seg.start), seg.dur);
    if (seg.vel) {
      const p = local / seg.dur;
      return { pos: seg.srcIn + seg.srcDur * velPos(p), rate: (seg.srcDur / seg.dur) * velRate(p) };
    }
    return { pos: seg.srcIn + local * seg.rate, rate: seg.rate };
  }

  // ───────────────────────── 영상 요소 관리 ─────────────────────────
  class VideoManager {
    constructor() {
      this.all = new Set();
      this.onSeeked = null;
    }
    makeEl(item) {
      const el = document.createElement('video');
      el.src = item.url;
      el.muted = true;
      el.playsInline = true;
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      el.addEventListener('seeked', () => this.onSeeked && this.onSeeked());
      el.addEventListener('loadeddata', () => this.onSeeked && this.onSeeked());
      this.all.add(el);
      return el;
    }
    assign(tl) {
      const lastIdx = new Map();
      let prev = null;
      tl.segs.forEach((s) => {
        if (s.kind !== 'video') { prev = s; return; }
        const it = s.item;
        it.els = it.els || [];
        const contiguous = prev && prev.kind === 'video' && prev.item === it && !s.tr && Math.abs(prev.srcIn + prev.srcDur - s.srcIn) < 0.06;
        let idx;
        if (contiguous) idx = lastIdx.get(it.id);
        else idx = lastIdx.has(it.id) ? (lastIdx.get(it.id) + 1) % 2 : 0;
        while (it.els.length <= idx) it.els.push(this.makeEl(it));
        s.el = it.els[idx];
        lastIdx.set(it.id, idx);
        prev = s;
      });
    }
    connectAudio(ac, dest, vol) {
      this.all.forEach((el) => {
        if (vol > 0 && !el._gain) {
          try {
            el._src = ac.createMediaElementSource(el);
            el._gain = ac.createGain();
            el._src.connect(el._gain).connect(dest);
          } catch (e) { /* 이미 연결됨 */ }
        }
        if (el._gain) el._gain.gain.value = vol;
        el.muted = !(vol > 0 && el._gain);
      });
    }
    sync(tl, t, playing) {
      const loc = locate(tl, t);
      const want = new Map();
      [loc.prev, loc.cur].forEach((s) => {
        if (s && s.kind === 'video' && s.el) {
          const { pos, rate } = srcPos(s, t);
          want.set(s.el, { pos, rate, play: playing && t >= s.start - 0.01 });
        }
      });
      for (let k = 1; k <= 2; k++) {
        const nx = tl.segs[loc.i + k];
        if (nx && nx.kind === 'video' && nx.el && !want.has(nx.el)) want.set(nx.el, { pos: nx.srcIn, rate: nx.rate, play: false });
      }
      this.all.forEach((el) => {
        const w = want.get(el);
        if (!w) { if (!el.paused) el.pause(); return; }
        const dur = el.duration || Infinity;
        const pos = Math.min(w.pos, dur - 0.04);
        if (w.play) {
          const r = Math.min(4, Math.max(0.25, w.rate));
          if (Math.abs(el.playbackRate - r) > 0.02) el.playbackRate = r;
          if (el.paused) { const pr = el.play(); if (pr) pr.catch(() => {}); }
          if (Math.abs(el.currentTime - pos) > 0.3 && !el.seeking) el.currentTime = pos;
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - pos) > 0.03 && !el.seeking) el.currentTime = pos;
        }
      });
      return loc;
    }
    pauseAll() { this.all.forEach((el) => el.paused || el.pause()); }
  }

  // ───────────────────────── 렌더러 ─────────────────────────
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      const probe = canvas2d(1, 1);
      probe.filter = 'blur(1px)';
      this.hasFilter = probe.filter === 'blur(1px)';
      this.setSize(720, 1280);
    }
    setSize(W, H) {
      this.W = W; this.H = H;
      this.canvas.width = W; this.canvas.height = H;
      this.bufA = canvas2d(W, H); this.bufB = canvas2d(W, H); this.bufC = canvas2d(W, H);
      this.tmp = canvas2d(W, H); this.tmp2 = canvas2d(W, H);
      this.pix = canvas2d(16, 16);
      this.small = canvas2d(Math.round(W / 8), Math.round(H / 8));
      this.bgSmall = canvas2d(36, 64);
      // 비네트
      const v = canvas2d(W, H);
      const g = v.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)');
      v.fillStyle = g; v.fillRect(0, 0, W, H);
      this.vignette = v.canvas;
      // 그레인
      const n = canvas2d(256, 256), id = n.createImageData(256, 256);
      for (let i = 0; i < id.data.length; i += 4) { const x = Math.random() > 0.5 ? 255 : 0; id.data[i] = id.data[i + 1] = id.data[i + 2] = x; id.data[i + 3] = Math.random() * 90; }
      n.putImageData(id, 0, 0);
      this.grainPattern = this.ctx.createPattern(n.canvas, 'repeat');
      // 주사선
      const s = canvas2d(4, 4);
      s.fillStyle = 'rgba(0,0,0,0.5)'; s.fillRect(0, 0, 4, 2);
      this.scanPattern = this.ctx.createPattern(s.canvas, 'repeat');
    }
    copy() { this.tmp.globalCompositeOperation = 'copy'; this.tmp.drawImage(this.canvas, 0, 0); this.tmp.globalCompositeOperation = 'source-over'; }
    blurOf(img) {
      const s = this.small;
      s.save();
      if (this.hasFilter) s.filter = 'blur(2px)';
      s.globalCompositeOperation = 'copy';
      s.drawImage(img, 0, 0, s.canvas.width, s.canvas.height);
      s.restore();
      return s.canvas;
    }
    chroma(c, amt) {
      if (amt < 1) return;
      this.copy();
      const t2 = this.tmp2;
      c.save();
      c.globalCompositeOperation = 'copy';
      [['#f00', -amt], ['#0ff', amt]].forEach(([col, dx], i) => {
        t2.globalCompositeOperation = 'copy'; t2.drawImage(this.tmp.canvas, 0, 0);
        t2.globalCompositeOperation = 'multiply'; t2.fillStyle = col; t2.fillRect(0, 0, this.W, this.H);
        if (i) c.globalCompositeOperation = 'lighter';
        c.drawImage(t2.canvas, dx, 0);
      });
      c.restore();
    }

    drawSource(c, seg, t, st, vm, f) {
      const W = this.W, H = this.H, item = seg.item;
      let src, sw, sh;
      if (seg.kind === 'image') { src = item.canvas; sw = src.width; sh = src.height; }
      else {
        src = seg.el;
        if (!src || src.readyState < 2) return; // 준비 전엔 직전 프레임 유지
        sw = src.videoWidth; sh = src.videoHeight;
      }
      if (!sw || !sh) return;
      const p = Math.min(1, Math.max(0, (t - seg.start) / seg.dur));
      let k = 1;
      if (st.fx.has('kenBurns') && st.mode === 'photo') k = seg.idx % 2 ? 1.12 - 0.12 * p : 1 + 0.12 * p;
      const focus = item.focus || { x: 0.5, y: 0.5 };
      c.save();
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      const pop = st.fx.has('colorPop') && this.hasFilter ? (f ? f.amt : 1) : 0;
      if (st.fit === 'blur' && Math.abs(sw / sh - W / H) > 0.02) {
        const b = this.bgSmall, bw = b.canvas.width, bh = b.canvas.height;
        const bs = Math.max(bw / sw, bh / sh);
        b.drawImage(src, (bw - sw * bs) / 2, (bh - sh * bs) / 2, sw * bs, sh * bs);
        c.imageSmoothingQuality = 'low';
        c.drawImage(b.canvas, 0, 0, W, H);
        c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, 0, W, H);
        const s = Math.min(W / sw, H / sh) * k * (st.mode === 'highlight' ? st.zoomFit : 1);
        const dw = sw * s, dh = sh * s;
        c.imageSmoothingQuality = 'high';
        if (pop > 0.02) c.filter = `saturate(${1 + 0.55 * pop}) contrast(${1 + 0.1 * pop})`;
        c.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
      } else {
        const s = Math.max(W / sw, H / sh) * k;
        const dw = sw * s, dh = sh * s;
        const x = Math.min(0, Math.max(W - dw, W / 2 - focus.x * dw));
        const y = Math.min(0, Math.max(H - dh, H / 2 - focus.y * dh));
        if (pop > 0.02) c.filter = `saturate(${1 + 0.55 * pop}) contrast(${1 + 0.1 * pop})`;
        c.drawImage(src, x, y, dw, dh);
      }
      if (pop) c.filter = 'none';
      if (seg.mono) {
        c.globalCompositeOperation = 'saturation';
        c.fillStyle = '#808080'; c.fillRect(0, 0, W, H);
      }
      c.restore();
    }

    frame(tl, t, st, vm, loc) {
      const W = this.W, H = this.H, c = this.ctx;
      if (!tl) { c.fillStyle = '#0b0b10'; c.fillRect(0, 0, W, H); return; }
      loc = loc || locate(tl, t);

      // 하이라이트 강도
      let amt = 1, hlPulse = 0, inHL = false;
      if (tl.mode === 'highlight') {
        amt = 0;
        for (const g of tl.groups) {
          if (t >= g.s - 0.05 && t < g.e + 0.3) {
            inHL = t < g.e;
            const ain = Math.min(1, (t - g.s + 0.05) / 0.1), aout = Math.min(1, (g.e + 0.3 - t) / 0.3);
            amt = Math.max(0, Math.min(ain, aout));
            hlPulse = t >= g.s ? Math.exp(-(t - g.s) * 5) : 0;
            break;
          }
        }
      }
      // 흑백 포인트 (하이라이트: 하이라이트 밖은 흑백)
      if (tl.mode === 'highlight' && st.fx.has('mono')) tl.segs.forEach((s) => { s.mono = !s.hl; });

      const beat = (t - tl.beatOffset) / tl.period;
      const beatIdx = Math.floor(beat);
      const since = (beat - beatIdx) * tl.period;
      const since8 = ((beat * 2) % 1) * tl.period / 2;
      let pulse = Math.exp(-since * 7);
      if (tl.mode === 'highlight') pulse = Math.max(hlPulse, 0.55 * pulse) * amt;
      const f = { t, amt, pulse, beatIdx, since8, hlPulse, period: tl.period, inHL };

      this.drawSource(this.bufA, loc.cur, t, st, vm, f);
      let out = this.bufA.canvas;
      if (loc.prev && loc.tr) {
        this.drawSource(this.bufB, loc.prev, t, st, vm, f);
        const C = this.bufC;
        C.save(); C.fillStyle = '#000'; C.fillRect(0, 0, W, H);
        (TR[loc.tr.id] || TR.cut).fn(C, this, this.bufB.canvas, this.bufA.canvas, Math.min(1, Math.max(0, loc.p)));
        C.restore();
        out = C.canvas;
      }

      const cam = { scale: 1, x: 0, y: 0, rot: 0 };
      st.fx.forEach((id) => { const e = EF[id]; if (e && e.camera) e.camera(f, cam); });
      c.save();
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      c.translate(W / 2 + cam.x, H / 2 + cam.y);
      if (cam.rot) c.rotate(cam.rot);
      c.scale(cam.scale, cam.scale);
      c.drawImage(out, -W / 2, -H / 2);
      c.restore();

      POST_ORDER.forEach((id) => { if (st.fx.has(id)) { const e = EF[id]; if (e && e.post) { c.save(); e.post(c, this, f); c.restore(); } } });
    }
  }

  // ───────────────────────── 재생기 ─────────────────────────
  class Player {
    constructor(renderer, vm) {
      this.r = renderer; this.vm = vm;
      this.ac = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ac.createGain();
      this.master.connect(this.ac.destination);
      this.recDest = this.ac.createMediaStreamDestination ? this.ac.createMediaStreamDestination() : null;
      if (this.recDest) this.master.connect(this.recDest);
      this.tl = null; this.st = null; this.buffer = null;
      this.t = 0; this.playing = false; this.src = null;
      this.onTick = null; this.onEnd = null;
      vm.onSeeked = () => { if (!this.playing) this.draw(); };
      this._loop = this._loop.bind(this);
    }
    setTimeline(tl, st) {
      this.tl = tl; this.st = st;
      if (tl) this.vm.assign(tl);
      if (tl && this.t > tl.duration) this.t = 0;
      if (!this.playing) { this.syncVideos(false); this.draw(); }
    }
    setAudio(buf) {
      this.buffer = buf;
      if (this.playing) { const t = this.time(); this._stopSrc(); this._startSrc(t); }
    }
    time() { return this.playing ? this.ac.currentTime - this.t0 : this.t; }
    _startSrc(t) {
      if (!this.buffer) { this.t0 = this.ac.currentTime - t; return; }
      const s = this.ac.createBufferSource();
      s.buffer = this.buffer;
      s.connect(this.master);
      s.start(0, Math.min(t, this.buffer.duration));
      this.src = s;
      this.t0 = this.ac.currentTime - t;
    }
    _stopSrc() { if (this.src) { try { this.src.stop(); } catch (e) {} this.src.disconnect(); this.src = null; } }
    async play() {
      if (!this.tl || this.playing) return;
      await this.ac.resume();
      if (this.t >= this.tl.duration - 0.05) this.t = 0;
      this.playing = true;
      this._startSrc(this.t);
      requestAnimationFrame(this._loop);
    }
    pause() {
      if (!this.playing) return;
      this.t = this.time();
      this.playing = false;
      this._stopSrc();
      this.vm.pauseAll();
      this.draw();
    }
    seek(t) {
      const was = this.playing;
      if (was) { this._stopSrc(); this.playing = false; }
      this.t = Math.max(0, Math.min(t, this.tl ? this.tl.duration : 0));
      this.syncVideos(false);
      this.draw();
      if (was) { this.playing = true; this._startSrc(this.t); }
    }
    syncVideos(playing) { if (this.tl) return this.vm.sync(this.tl, this.time(), playing); }
    draw() {
      const t = this.time();
      this.r.frame(this.tl, t, this.st || { fx: new Set() }, this.vm);
      if (this.onTick) this.onTick(t);
    }
    _loop() {
      if (!this.playing) return;
      const t = this.time();
      if (t >= this.tl.duration) {
        this.t = this.tl.duration;
        this.playing = false;
        this._stopSrc();
        this.vm.pauseAll();
        this.r.frame(this.tl, this.tl.duration - 0.001, this.st, this.vm);
        if (this.onTick) this.onTick(this.t);
        if (this.onEnd) this.onEnd();
        return;
      }
      const loc = this.vm.sync(this.tl, t, true);
      this.r.frame(this.tl, t, this.st, this.vm, loc);
      if (this.onTick) this.onTick(t);
      requestAnimationFrame(this._loop);
    }
  }

  // ───────────────────────── 내보내기 ─────────────────────────
  function pickMime() {
    const list = [
      'video/mp4;codecs=avc1.640028,mp4a.40.2',
      'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    if (!window.MediaRecorder) return null;
    return list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  }

  function exportVideo(player, { fps = 30, bitrate = 10e6, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const mime = pickMime();
      if (mime === null || !player.r.canvas.captureStream) return reject(new Error('이 브라우저는 영상 녹화를 지원하지 않아요. 최신 크롬/엣지/사파리를 이용해 주세요.'));
      player.pause();
      const stream = player.r.canvas.captureStream(fps);
      if (player.recDest) player.recDest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
      let rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: bitrate, audioBitsPerSecond: 192000 }); }
      catch (e) { return reject(e); }
      const chunks = [];
      let cancelled = false;
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getVideoTracks().forEach((tr) => tr.stop());
        player.onEnd = null; player.onTick = prevTick;
        if (cancelled) return reject(new Error('cancelled'));
        const type = rec.mimeType || mime || 'video/webm';
        resolve({ blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' });
      };
      const prevTick = player.onTick;
      player.onTick = (t) => { if (prevTick) prevTick(t); if (onProgress) onProgress(Math.min(1, t / player.tl.duration)); };
      player.seek(0);
      // 첫 장면 영상이 준비될 시간을 잠깐 줍니다
      setTimeout(() => {
        rec.start(500);
        player.onEnd = () => setTimeout(() => rec.state !== 'inactive' && rec.stop(), 150);
        player.play();
      }, 450);
      exportVideo.cancel = () => { cancelled = true; player.pause(); if (rec.state !== 'inactive') rec.stop(); };
    });
  }

  window.Engine = { buildPhoto, buildHighlight, locate, VideoManager, Renderer, Player, exportVideo, pickMime };
})();
