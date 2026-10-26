// music.js — 장르별 음악 자동 생성 · 효과음 합성 · BPM 분석 · 오디오 믹스 렌더링
// 모든 소리는 브라우저(Web Audio)에서 직접 만들어지므로 저작권 걱정이 없습니다.
(function () {
  'use strict';

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeNoise(ctx, secs) {
    const len = Math.floor(ctx.sampleRate * secs);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function makeIR(ctx, secs, decay) {
    const len = Math.floor(ctx.sampleRate * secs);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  function distCurve(k) {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return c;
  }

  // ───────────────────────── 악기 키트 ─────────────────────────
  class Kit {
    constructor(ctx, out, limit) {
      this.ctx = ctx;
      this.out = out;
      this.limit = limit; // 이 시간 이후의 음은 만들지 않음
      this.noise = makeNoise(ctx, 2);
      this.verb = ctx.createConvolver();
      this.verb.buffer = makeIR(ctx, 2.8, 3);
      this.verbSend = ctx.createGain();
      this.verbSend.gain.value = 1;
      this.verbSend.connect(this.verb);
      const vg = ctx.createGain();
      vg.gain.value = 0.35;
      this.verb.connect(vg).connect(out);
    }
    skip(t) { return t > this.limit; }
    noiseSrc(t, dur) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.start(t, Math.random() * 1.5);
      s.stop(t + dur + 0.05);
      return s;
    }
    gainEnv(t, peak, a, hold, r) {
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      if (hold > 0) g.gain.setValueAtTime(peak, t + a + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
      return g;
    }
    send(node, amt) {
      if (!amt) return;
      const s = this.ctx.createGain();
      s.gain.value = amt;
      node.connect(s).connect(this.verbSend);
    }
    kick(t, g = 1, o = {}) {
      if (this.skip(t)) return;
      const c = this.ctx, d = o.d || 0.45;
      const osc = c.createOscillator();
      osc.frequency.setValueAtTime(o.f0 || 160, t);
      osc.frequency.exponentialRampToValueAtTime(o.f1 || 42, t + 0.12);
      const e = this.gainEnv(t, g, 0.002, 0.02, d);
      osc.connect(e).connect(this.out);
      osc.start(t); osc.stop(t + d + 0.1);
      const n = this.noiseSrc(t, 0.03), hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 3000;
      n.connect(hp).connect(this.gainEnv(t, 0.25 * g, 0.001, 0, 0.02)).connect(this.out);
    }
    snare(t, g = 1, o = {}) {
      if (this.skip(t)) return;
      const c = this.ctx, d = o.d || 0.2;
      const n = this.noiseSrc(t, d), hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = o.hp || 1200;
      const e = this.gainEnv(t, 0.55 * g, 0.001, 0, d);
      n.connect(hp).connect(e).connect(this.out);
      this.send(e, o.verb ?? 0.15);
      const osc = c.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(o.tone || 200, t);
      osc.frequency.exponentialRampToValueAtTime((o.tone || 200) * 0.7, t + 0.08);
      osc.connect(this.gainEnv(t, 0.5 * g, 0.001, 0, 0.1)).connect(this.out);
      osc.start(t); osc.stop(t + 0.2);
    }
    clap(t, g = 1, o = {}) {
      if (this.skip(t)) return;
      const c = this.ctx;
      const n = this.noiseSrc(t, 0.3), bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.9;
      const e = c.createGain();
      e.gain.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) {
        e.gain.setValueAtTime(0.7 * g, t + i * 0.011);
        e.gain.exponentialRampToValueAtTime(0.05 * g, t + i * 0.011 + 0.009);
      }
      e.gain.setValueAtTime(0.6 * g, t + 0.034);
      e.gain.exponentialRampToValueAtTime(0.0001, t + 0.034 + 0.18);
      n.connect(bp).connect(e).connect(this.out);
      this.send(e, o.verb ?? 0.2);
    }
    hat(t, g = 1, open = false) {
      if (this.skip(t)) return;
      const c = this.ctx, d = open ? 0.28 : 0.045;
      const n = this.noiseSrc(t, d), hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 7500;
      n.connect(hp).connect(this.gainEnv(t, 0.3 * g, 0.001, 0, d)).connect(this.out);
    }
    crash(t, g = 1) {
      if (this.skip(t)) return;
      const c = this.ctx;
      const n = this.noiseSrc(t, 1.8), hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 4500;
      const e = this.gainEnv(t, 0.22 * g, 0.002, 0, 1.6);
      n.connect(hp).connect(e).connect(this.out);
      this.send(e, 0.3);
    }
    cowbell(t, midi, g = 1) {
      if (this.skip(t)) return;
      const c = this.ctx, f = mtof(midi);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f * 1.6; bp.Q.value = 1.2;
      const e = this.gainEnv(t, 0.22 * g, 0.002, 0.01, 0.28);
      bp.connect(e).connect(this.out);
      this.send(e, 0.15);
      [1, 1.48].forEach((m) => {
        const o = c.createOscillator();
        o.type = 'square'; o.frequency.value = f * m;
        o.connect(bp); o.start(t); o.stop(t + 0.4);
      });
    }
    // 범용 신스 보이스
    voice(t, midi, dur, o = {}) {
      if (this.skip(t)) return;
      const c = this.ctx;
      const a = o.a ?? 0.01, r = o.r ?? 0.2, peak = o.peak ?? 0.1;
      const voices = o.voices || 1, det = o.detune ?? 10;
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = o.q ?? 0.8;
      const cut = o.cutoff ?? 4000;
      if (o.cutEnv) {
        f.frequency.setValueAtTime(cut + o.cutEnv, t);
        f.frequency.exponentialRampToValueAtTime(cut, t + (o.cutTime ?? 0.18));
      } else f.frequency.value = cut;
      const e = this.gainEnv(t, peak / Math.sqrt(voices), a, Math.max(0, dur - a), r);
      f.connect(e).connect(o.dest || this.out);
      this.send(e, o.verb);
      for (let i = 0; i < voices; i++) {
        const osc = c.createOscillator();
        osc.type = o.type || 'sawtooth';
        const fr = mtof(midi);
        if (o.glideFrom) {
          osc.frequency.setValueAtTime(mtof(o.glideFrom), t);
          osc.frequency.exponentialRampToValueAtTime(fr, t + 0.08);
        } else osc.frequency.value = fr;
        osc.detune.value = voices > 1 ? (i / (voices - 1) - 0.5) * 2 * det : 0;
        osc.connect(f);
        osc.start(t); osc.stop(t + dur + r + 0.05);
      }
    }
    piano(t, midi, g = 1, o = {}) {
      if (this.skip(t)) return;
      const c = this.ctx, f = mtof(midi), d = o.d || 1.8;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = o.cutoff || 2600;
      const e = this.gainEnv(t, 0.12 * g, 0.004, 0.02, d);
      lp.connect(e).connect(this.out);
      this.send(e, o.verb ?? 0.35);
      [[1, 'triangle', 1], [2, 'sine', 0.35], [3, 'sine', 0.12]].forEach(([m, type, lvl]) => {
        const osc = c.createOscillator(), og = c.createGain();
        osc.type = type; osc.frequency.value = f * m; og.gain.value = lvl;
        osc.connect(og).connect(lp);
        osc.start(t); osc.stop(t + d + 0.1);
      });
    }
    ep(t, midi, dur, g = 1, o = {}) { // 일렉트릭 피아노
      if (this.skip(t)) return;
      const c = this.ctx, f = mtof(midi);
      const e = this.gainEnv(t, 0.08 * g, 0.008, dur * 0.3, dur * 0.9 + 0.4);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = o.cutoff || 2200;
      lp.connect(e).connect(this.out);
      this.send(e, o.verb ?? 0.25);
      [[1, 1], [2, 0.18], [4.01, 0.04]].forEach(([m, lvl]) => {
        const osc = c.createOscillator(), og = c.createGain();
        osc.type = 'sine'; osc.frequency.value = f * m; og.gain.value = lvl;
        osc.connect(og).connect(lp);
        osc.start(t); osc.stop(t + dur * 1.3 + 0.6);
      });
    }
    bass808(t, midi, dur, g = 1, glideFrom) {
      if (this.skip(t)) return;
      const c = this.ctx;
      const osc = c.createOscillator();
      osc.type = 'sine';
      if (glideFrom) {
        osc.frequency.setValueAtTime(mtof(glideFrom), t);
        osc.frequency.exponentialRampToValueAtTime(mtof(midi), t + 0.1);
      } else osc.frequency.value = mtof(midi);
      const ws = c.createWaveShaper();
      ws.curve = distCurve(8);
      const e = this.gainEnv(t, 0.45 * g, 0.003, dur * 0.6, dur * 0.6 + 0.15);
      osc.connect(ws).connect(e).connect(this.out);
      osc.start(t); osc.stop(t + dur * 1.3 + 0.3);
    }
    riserNoise(t, dur, g = 1) {
      if (this.skip(t)) return;
      const c = this.ctx;
      const n = this.noiseSrc(t, dur), hp = c.createBiquadFilter();
      hp.type = 'bandpass'; hp.Q.value = 2;
      hp.frequency.setValueAtTime(300, t);
      hp.frequency.exponentialRampToValueAtTime(8000, t + dur);
      const e = c.createGain();
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(0.25 * g, t + dur);
      e.gain.linearRampToValueAtTime(0, t + dur + 0.02);
      n.connect(hp).connect(e).connect(this.out);
      this.send(e, 0.3);
    }
    vinyl(t0, dur) {
      const c = this.ctx;
      const n = this.noiseSrc(t0, dur), lp = c.createBiquadFilter();
      lp.type = 'bandpass'; lp.frequency.value = 2500; lp.Q.value = 0.5;
      const g = c.createGain(); g.gain.value = 0.012;
      n.connect(lp).connect(g).connect(this.out);
      const r = rng(7);
      for (let t = t0; t < t0 + dur; t += 0.05 + r() * 0.3) {
        const s = this.noiseSrc(t, 0.004);
        s.connect(this.gainEnv(t, 0.05 + r() * 0.08, 0.0005, 0, 0.004)).connect(this.out);
      }
    }
  }

  // 마디/스텝 타이밍 헬퍼
  function grid(bpm, swing = 0) {
    const s = 60 / bpm / 4;
    return {
      s, bar: s * 16,
      at: (b, step) => b * s * 16 + step * s + (step % 2 === 1 ? swing * s : 0),
    };
  }

  // ───────────────────────── 장르 ─────────────────────────
  const GENRES = [
    {
      id: 'kpop', name: 'K-POP 댄스', emoji: '💃', bpm: 122, desc: '밝고 신나는 아이돌 무드', intro: true,
      render(k, bars, bpm) {
        const G = grid(bpm);
        const chords = [[69, 72, 76], [65, 69, 72], [64, 67, 72], [62, 67, 71]];
        const roots = [45, 41, 48, 43];
        const mel = [
          [[0, 76], [3, 76], [6, 74], [8, 72], [11, 74], [14, 76]],
          [[0, 77], [3, 76], [6, 74], [8, 72], [12, 69]],
          [[0, 72], [3, 74], [6, 76], [8, 79], [11, 76], [14, 74]],
          [[0, 74], [3, 72], [6, 71], [8, 74], [12, 67]],
        ];
        for (let b = 0; b < bars; b++) {
          const ci = b % 4, ch = chords[ci], root = roots[ci];
          const intro = b === 0 && bars > 3;
          for (let st = 0; st < 16; st++) {
            const t = G.at(b, st);
            if (st % 4 === 0 && !intro) k.kick(t, 0.95);
            if (st % 4 === 2) k.hat(t, 0.5, true);
            else k.hat(t, 0.18);
            if (st % 2 === 0) k.voice(t, root - 12 + (st % 4 === 2 ? 12 : 0), G.s * 1.5, { cutoff: 500, cutEnv: 1400, peak: 0.26, a: 0.003, r: 0.05 });
          }
          if (!intro) { k.clap(G.at(b, 4), 0.8); k.clap(G.at(b, 12), 0.8); }
          if (b % 4 === 3) [13, 14, 15].forEach((s) => k.snare(G.at(b, s), 0.45));
          if (b % 8 === 1) k.crash(G.at(b, 0), 0.8);
          [0, 3, 6, 10, 12].forEach((s) => ch.forEach((n) => k.voice(G.at(b, s), n - 12, G.s, { voices: 2, detune: 12, cutoff: 2800, peak: 0.05, r: 0.08 })));
          if (!intro) mel[ci].forEach(([s, n]) => k.voice(G.at(b, s), n, G.s * 1.8, { type: 'square', cutoff: 2600, cutEnv: 2500, peak: 0.055, a: 0.003, r: 0.15, verb: 0.3 }));
        }
      },
    },
    {
      id: 'funk', name: '펑크 (Funk)', emoji: '🕺', bpm: 112, desc: '그루비한 베이스, 쫀득한 리듬',
      render(k, bars, bpm) {
        const G = grid(bpm, 0.12);
        const chords = [[67, 71, 74, 78], [67, 71, 73, 76]];
        const roots = [40, 45];
        const bassPat = [[0, 0, 2], [2, 12, 1], [3, 0, 1], [6, 0, 1], [7, 12, 1], [8, 10, 1], [10, 7, 2], [13, 5, 1], [14, 7, 1]];
        for (let b = 0; b < bars; b++) {
          const ci = b % 2, root = roots[ci];
          [0, 6, 10].forEach((s) => k.kick(G.at(b, s), 0.9));
          if (b % 2 === 1) k.kick(G.at(b, 13), 0.6);
          [4, 12].forEach((s) => k.snare(G.at(b, s), 0.8, { verb: 0.1 }));
          [7, 9, 15].forEach((s) => k.snare(G.at(b, s), 0.13, { verb: 0 }));
          for (let st = 0; st < 16; st++) {
            if (st === 14) k.hat(G.at(b, st), 0.4, true);
            else k.hat(G.at(b, st), st % 4 === 0 ? 0.35 : st % 2 ? 0.14 : 0.24);
          }
          bassPat.forEach(([s, off, len]) => k.voice(G.at(b, s), root + off, len * G.s * 0.75, { cutoff: 650, cutEnv: 2000, cutTime: 0.1, peak: 0.34, a: 0.002, r: 0.04, q: 4 }));
          [2, 5, 7, 10, 13].forEach((s) => chords[ci].forEach((n) => k.voice(G.at(b, s), n, G.s * 0.45, { type: 'square', cutoff: 2400, cutEnv: 1500, peak: 0.035, a: 0.002, r: 0.03 })));
          if (b % 4 === 3) chords[ci].forEach((n) => k.voice(G.at(b, 12), n + 12, G.s * 3, { voices: 3, detune: 14, cutoff: 3000, peak: 0.05, a: 0.02, r: 0.25, verb: 0.3 }));
        }
      },
    },
    {
      id: 'ballad', name: '발라드', emoji: '🌙', bpm: 72, desc: '감성적인 피아노와 스트링',
      render(k, bars, bpm) {
        const G = grid(bpm);
        const chords = [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65]];
        const roots = [48, 47, 45, 41];
        const mel = [[76, 74], [74, 71], [72, 76], [77, 76]];
        for (let b = 0; b < bars; b++) {
          const ci = b % 4, ch = chords[ci], root = roots[ci];
          const ext = [root, ch[0], ch[1], ch[2], ch[0] + 12, ch[1] + 12];
          [0, 1, 2, 3, 4, 3, 2, 1].forEach((idx, i) => k.piano(G.at(b, i * 2), ext[idx], i === 0 ? 1 : 0.7));
          ch.forEach((n) => k.voice(G.at(b, 0), n, G.bar, { voices: 2, detune: 9, a: 0.7, r: 1.2, cutoff: 1300, peak: 0.03, verb: 0.5 }));
          k.voice(G.at(b, 0), root - 12, G.bar * 0.95, { type: 'sine', a: 0.05, r: 0.5, cutoff: 800, peak: 0.22 });
          if (b >= 1 || bars <= 2) mel[ci].forEach((n, i) => k.voice(G.at(b, i * 8), n, G.s * 7, { type: 'triangle', a: 0.06, r: 0.8, cutoff: 3000, peak: 0.07, verb: 0.45 }));
          if (b >= 1) {
            [0, 10].forEach((s) => k.kick(G.at(b, s), 0.55, { d: 0.5 }));
            [4, 12].forEach((s) => k.snare(G.at(b, s), 0.32, { verb: 0.55, d: 0.25 }));
            for (let s = 0; s < 16; s += 2) k.hat(G.at(b, s), 0.1);
          }
        }
      },
    },
    {
      id: 'phonk', name: '폰크 (Phonk)', emoji: '🔔', bpm: 130, desc: '카우벨 + 808, 강렬한 에디트 감성',
      render(k, bars, bpm) {
        const G = grid(bpm);
        const bell = [
          [[0, 81], [3, 81], [6, 84], [8, 81], [10, 79], [12, 76], [14, 79]],
          [[0, 81], [3, 81], [6, 84], [8, 86], [10, 84], [12, 81], [14, 79]],
        ];
        const p808 = [[0, 33, 6], [7, 33, 2], [10, 36, 4], [14, 31, 2]];
        const pads = [[57, 60, 64], [53, 57, 60]];
        let prev = null;
        for (let b = 0; b < bars; b++) {
          bell[b % 2].forEach(([s, n]) => k.cowbell(G.at(b, s), n, 1));
          p808.forEach(([s, n, len]) => {
            k.bass808(G.at(b, s), n, len * G.s, 1, prev);
            k.kick(G.at(b, s), 0.8, { d: 0.25 });
            prev = n;
          });
          [4, 12].forEach((s) => { k.clap(G.at(b, s), 0.75); k.snare(G.at(b, s), 0.5, { verb: 0.05 }); });
          for (let s = 0; s < 16; s += 2) k.hat(G.at(b, s), 0.22);
          if (b % 2 === 1) for (let i = 0; i < 6; i++) k.hat(G.at(b, 12) + i * (G.s * 4 / 6), 0.25);
          pads[b % 2].forEach((n) => k.voice(G.at(b, 0), n, G.bar, { voices: 2, detune: 10, a: 0.2, r: 0.4, cutoff: 900, peak: 0.022 }));
        }
      },
    },
    {
      id: 'edm', name: 'EDM', emoji: '⚡', bpm: 128, desc: '빌드업과 드롭, 터지는 에너지', intro: true,
      render(k, bars, bpm, bus) {
        const G = grid(bpm);
        const chords = [[65, 68, 72], [65, 68, 73], [63, 68, 72], [63, 67, 70]];
        const roots = [41, 37, 44, 39];
        const c = k.ctx;
        const chordBus = c.createGain();
        chordBus.connect(k.out);
        for (let b = 0; b < bars; b++) {
          const ci = b % 4, ch = chords[ci], root = roots[ci];
          const intro = b === 0 && bars > 3;
          if (intro) {
            k.riserNoise(G.at(0, 0), G.bar, 1);
            for (let i = 0; i < 16; i += i < 8 ? 2 : 1) {
              k.snare(G.at(0, i), 0.15 + i * 0.035, { verb: 0.2 });
              if (i >= 12) k.snare(G.at(0, i) + G.s / 2, 0.15 + i * 0.035, { verb: 0.2 });
            }
            ch.forEach((n) => k.voice(G.at(b, 0), n, G.bar, { voices: 3, detune: 20, cutoff: 1500, peak: 0.04, dest: chordBus }));
            continue;
          }
          if (b % 8 === 1 || b === 0) k.crash(G.at(b, 0), 1);
          for (let st = 0; st < 16; st++) {
            const t = G.at(b, st);
            if (st % 4 === 0) {
              k.kick(t, 1);
              chordBus.gain.setValueAtTime(0.2, t);
              chordBus.gain.linearRampToValueAtTime(1, t + G.s * 2.5);
            }
            if (st % 4 === 2) { k.hat(t, 0.45, true); k.voice(t, root, G.s * 1.6, { cutoff: 450, cutEnv: 700, peak: 0.3, a: 0.003, r: 0.05 }); }
            else if (st % 2) k.hat(t, 0.12);
          }
          [4, 12].forEach((s) => k.clap(G.at(b, s), 0.85));
          ch.forEach((n) => k.voice(G.at(b, 0), n, G.bar, { voices: 3, detune: 20, cutoff: 3600, peak: 0.05, a: 0.01, r: 0.1, dest: chordBus }));
          [0, 2, 3, 5, 6, 8, 10, 11, 13, 14].forEach((s, i) => k.voice(G.at(b, s), ch[i % 3] + 12 + (s === 14 ? 12 : 0), G.s * 0.6, { type: 'square', cutoff: 1800, cutEnv: 3500, peak: 0.045, a: 0.002, r: 0.08, verb: 0.3 }));
        }
      },
    },
    {
      id: 'hiphop', name: '힙합', emoji: '🎤', bpm: 90, desc: '붐뱁 그루브, 묵직한 킥',
      render(k, bars, bpm) {
        const G = grid(bpm, 0.28);
        const chords = [[60, 63, 67, 70], [56, 60, 63, 67], [56, 60, 63, 65], [55, 59, 62, 65]];
        const roots = [36, 32, 41, 43];
        for (let b = 0; b < bars; b++) {
          const ci = b % 4, root = roots[ci];
          const kicks = b % 2 ? [0, 7, 10, 15] : [0, 7, 10];
          kicks.forEach((s) => {
            k.kick(G.at(b, s), 1, { d: 0.5 });
            k.voice(G.at(b, s), root, G.s * 2.5, { type: 'sine', cutoff: 500, peak: 0.32, a: 0.005, r: 0.15 });
          });
          [4, 12].forEach((s) => k.snare(G.at(b, s), 0.8, { verb: 0.12, tone: 180 }));
          for (let s = 0; s < 16; s += 2) k.hat(G.at(b, s), s % 4 === 0 ? 0.3 : 0.18);
          if (b % 4 === 3) k.hat(G.at(b, 15), 0.15);
          chords[ci].forEach((n) => {
            k.ep(G.at(b, 0), n, G.s * 6, 1);
            k.ep(G.at(b, 10), n, G.s * 3, 0.6);
          });
        }
      },
    },
    {
      id: 'lofi', name: '로파이', emoji: '☕', bpm: 78, desc: '잔잔하고 따뜻한 빈티지 감성', lp: 4200,
      render(k, bars, bpm) {
        const G = grid(bpm, 0.3);
        const chords = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
        const roots = [41, 40, 38, 36];
        k.vinyl(0, bars * G.bar);
        for (let b = 0; b < bars; b++) {
          const ci = b % 4, root = roots[ci];
          chords[ci].forEach((n) => { k.ep(G.at(b, 0), n + 12, G.s * 10, 0.9, { cutoff: 1800 }); k.ep(G.at(b, 11), n + 12, G.s * 4, 0.45, { cutoff: 1600 }); });
          k.voice(G.at(b, 0), root, G.s * 6, { type: 'sine', cutoff: 600, peak: 0.28, a: 0.01, r: 0.2 });
          k.voice(G.at(b, 10), root + 7, G.s * 4, { type: 'sine', cutoff: 600, peak: 0.24, a: 0.01, r: 0.2 });
          [0, 7, 10].forEach((s) => k.kick(G.at(b, s), 0.65, { d: 0.35 }));
          [4, 12].forEach((s) => k.snare(G.at(b, s), 0.4, { verb: 0.25, hp: 900 }));
          for (let s = 0; s < 16; s += 2) k.hat(G.at(b, s), 0.12);
        }
      },
    },
    {
      id: 'punk', name: '펑크 록 (Punk)', emoji: '🎸', bpm: 170, desc: '빠르고 거친 기타 사운드',
      render(k, bars, bpm) {
        const G = grid(bpm);
        const c = k.ctx;
        const chords = [[52, 59, 64], [48, 55, 60], [43, 50, 55], [50, 57, 62]];
        const roots = [40, 36, 43, 38];
        const gtr = c.createWaveShaper();
        gtr.curve = distCurve(60);
        const glp = c.createBiquadFilter();
        glp.type = 'lowpass'; glp.frequency.value = 3200;
        const gg = c.createGain(); gg.gain.value = 0.35;
        gtr.connect(glp).connect(gg).connect(k.out);
        for (let b = 0; b < bars; b++) {
          const ci = b % 4, ch = chords[ci], root = roots[ci];
          if (b % 2 === 0) k.crash(G.at(b, 0), 0.9);
          [0, 8, 10].forEach((s) => k.kick(G.at(b, s), 0.9, { d: 0.3 }));
          [4, 12].forEach((s) => k.snare(G.at(b, s), 0.85, { verb: 0.12 }));
          for (let s = 0; s < 16; s += 2) {
            const t = G.at(b, s);
            k.hat(t, 0.22);
            ch.forEach((n) => k.voice(t, n, G.s * 1.7, { voices: 2, detune: 14, cutoff: 5000, peak: s % 4 === 0 ? 0.22 : 0.15, a: 0.002, r: 0.05, dest: gtr }));
            k.voice(t, root - 12, G.s * 1.7, { cutoff: 700, peak: 0.24, a: 0.003, r: 0.05 });
          }
        }
      },
    },
  ];

  // ───────────────────────── 효과음 ─────────────────────────
  // pre: 이벤트 시점보다 얼마나 먼저 시작하는지(초)
  // 편집 앱 같은 '삑·뾰롱' 소리는 빼고, 영상 에디트에서 실제로 많이 쓰는 묵직하고 부드러운 소리만 둡니다.
  const SFX = [
    { id: 'whoosh', name: '스윕 (부드러운 휙)', pre: 0.28, desc: '장면이 넘어갈 때 공기 가르는 소리' },
    { id: 'subdrop', name: '서브 드롭 (쿵)', pre: 0, desc: '낮고 묵직하게 깔리는 저음' },
    { id: 'shutter', name: '카메라 셔터', pre: 0, desc: '사진이 바뀔 때 찰칵' },
    { id: 'reverse', name: '리버스 스웰', pre: 1.1, desc: '빨려 들어가듯 차오르는 소리' },
    { id: 'impact', name: '시네마틱 임팩트', pre: 0, desc: '영화 예고편 같은 큰 한 방' },
    { id: 'riser', name: '라이저 (빌드업)', pre: 1.6, desc: '긴장감이 점점 올라가는 소리' },
  ];

  function playSfx(k, id, at, g) {
    const c = k.ctx, out = k.out;
    const def = SFX.find((s) => s.id === id);
    const t = Math.max(0, at - (def ? def.pre : 0));
    const env = (peak, a, hold, r, t0 = t) => k.gainEnv(t0, peak * g, a, hold, r);
    const osc = (type, f0, f1, dur, t0 = t) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t0);
      if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      o.start(t0); o.stop(t0 + dur + 0.1);
      return o;
    };
    const filt = (type, f, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const pan = (from, to, dur, t0 = t) => {
      const p = c.createStereoPanner();
      p.pan.setValueAtTime(from, t0);
      p.pan.linearRampToValueAtTime(to, t0 + dur);
      return p;
    };
    const soft = () => { const w = c.createWaveShaper(); w.curve = distCurve(1.5); return w; };
    switch (id) {
      case 'whoosh': {
        const d = 0.55;
        [[-0.9, 0.9, 1], [0.6, -0.6, 0.5]].forEach(([p0, p1, lvl]) => {
          const n = k.noiseSrc(t, d), bp = filt('bandpass', 500, 0.6), lp = filt('lowpass', 5500);
          bp.frequency.setValueAtTime(450, t);
          bp.frequency.exponentialRampToValueAtTime(2200, t + d * 0.5);
          bp.frequency.exponentialRampToValueAtTime(700, t + d);
          const e = c.createGain();
          e.gain.setValueAtTime(0.0001, t);
          e.gain.exponentialRampToValueAtTime(0.55 * g * lvl, t + d * 0.5);
          e.gain.exponentialRampToValueAtTime(0.0001, t + d);
          n.connect(bp).connect(lp).connect(e).connect(pan(p0, p1, d)).connect(out);
          k.send(e, 0.25);
        });
        break;
      }
      case 'subdrop': {
        const o = osc('sine', 72, 30, 1.3);
        const e = env(0.95, 0.006, 0.08, 1.4);
        o.connect(soft()).connect(filt('lowpass', 180)).connect(e).connect(out);
        k.noiseSrc(t, 0.12).connect(filt('lowpass', 220)).connect(env(0.35, 0.002, 0, 0.1)).connect(out);
        break;
      }
      case 'impact': {
        osc('sine', 58, 34, 1.6).connect(soft()).connect(env(0.9, 0.004, 0.1, 1.8)).connect(out);
        const body = env(0.5, 0.002, 0.02, 0.35);
        k.noiseSrc(t, 0.5).connect(filt('lowpass', 900)).connect(body).connect(out);
        k.send(body, 0.9);
        const air = env(0.12, 0.001, 0, 0.25);
        k.noiseSrc(t, 0.3).connect(filt('bandpass', 2500, 0.5)).connect(air).connect(out);
        k.send(air, 0.8);
        break;
      }
      case 'riser': {
        const d = 1.6;
        const n = k.noiseSrc(t, d), bp = filt('bandpass', 400, 1.2);
        bp.frequency.setValueAtTime(400, t);
        bp.frequency.exponentialRampToValueAtTime(6000, t + d);
        const e = c.createGain();
        e.gain.setValueAtTime(0.0001, t);
        e.gain.exponentialRampToValueAtTime(0.35 * g, t + d);
        e.gain.linearRampToValueAtTime(0, t + d + 0.02);
        n.connect(bp).connect(e).connect(out);
        k.send(e, 0.35);
        const lp = filt('lowpass', 400, 2);
        lp.frequency.setValueAtTime(400, t);
        lp.frequency.exponentialRampToValueAtTime(4500, t + d);
        const e2 = c.createGain();
        e2.gain.setValueAtTime(0.0001, t);
        e2.gain.exponentialRampToValueAtTime(0.08 * g, t + d);
        e2.gain.linearRampToValueAtTime(0, t + d + 0.02);
        lp.connect(e2).connect(out);
        k.send(e2, 0.4);
        [-12, 0, 9].forEach((det) => { const o = osc('sawtooth', 220, 880, d); o.detune.value = det; o.connect(lp); });
        break;
      }
      case 'reverse': {
        // 실제로는 '잔향이 긴 한 방'을 만들고, sfxBuffer 에서 뒤집어 씁니다.
        const hit = env(0.7, 0.002, 0.03, 0.4, 0);
        k.noiseSrc(0, 0.5).connect(filt('lowpass', 3500)).connect(hit).connect(out);
        k.send(hit, 1.4);
        osc('sine', 110, 80, 0.4, 0).connect(env(0.3, 0.002, 0.05, 0.4, 0)).connect(out);
        break;
      }
      case 'shutter': {
        [0, 0.075].forEach((d, i) => {
          const n = k.noiseSrc(t + d, 0.04);
          n.connect(filt('highpass', 2200)).connect(env(i ? 0.35 : 0.6, 0.001, 0.005, 0.03, t + d)).connect(out);
        });
        k.noiseSrc(t, 0.05).connect(filt('lowpass', 400)).connect(env(0.3, 0.001, 0.01, 0.04)).connect(out);
        break;
      }
    }
  }

  // ───────────────────────── BPM 분석 ─────────────────────────
  function detectBeat(buffer) {
    const sr = buffer.sampleRate, hop = 256;
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
    const maxLen = Math.min(ch0.length, sr * 120);
    const frames = Math.floor(maxLen / hop);
    const env = new Float32Array(frames);
    let lp = 0;
    for (let f = 0; f < frames; f++) {
      let e = 0;
      for (let i = f * hop, end = i + hop; i < end; i++) {
        const x = (ch0[i] + ch1[i]) * 0.5;
        lp += 0.15 * (x - lp); // 저음 위주로
        e += lp * lp + 0.3 * x * x;
      }
      env[f] = Math.log(1e-6 + e);
    }
    const onset = new Float32Array(frames);
    for (let f = 1; f < frames; f++) onset[f] = Math.max(0, env[f] - env[f - 1]);
    // 평균 제거
    const win = 32;
    const norm = new Float32Array(frames);
    let acc = 0;
    for (let f = 0; f < frames; f++) {
      acc += onset[f];
      if (f >= win) acc -= onset[f - win];
      norm[f] = Math.max(0, onset[f] - acc / Math.min(f + 1, win));
    }
    const fps = sr / hop;
    const minLag = Math.floor((60 / 185) * fps), maxLag = Math.ceil((60 / 65) * fps);
    const scores = [];
    let best = minLag, bestScore = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      for (let f = 0; f + lag < frames; f++) s += norm[f] * norm[f + lag];
      const bpm = (60 * fps) / lag;
      const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 118) / 0.7, 2));
      s *= w;
      scores[lag] = s;
      if (s > bestScore) { bestScore = s; best = lag; }
    }
    let lag = best;
    const a = scores[best - 1], b = scores[best], c = scores[best + 1];
    if (a !== undefined && c !== undefined) {
      const den = a - 2 * b + c;
      if (den !== 0) lag = best + (0.5 * (a - c)) / den;
    }
    const period = lag / fps;
    let bestOff = 0, bestSum = -1;
    for (let i = 0; i < 48; i++) {
      const off = (i / 48) * period;
      let s = 0;
      for (let t = off; t < maxLen / sr; t += period) s += norm[Math.round(t * fps)] || 0;
      if (s > bestSum) { bestSum = s; bestOff = off; }
    }
    return { bpm: Math.round(60 / period * 10) / 10, offset: bestOff };
  }

  // 노래에서 가장 신나는 4마디(후렴 후보) 시작점 찾기
  function findHook(buffer, bpm, offset) {
    const sr = buffer.sampleRate, period = 60 / bpm;
    const ch = buffer.getChannelData(0);
    const beats = Math.floor((buffer.duration - offset) / period);
    if (beats < 24) return 0;
    const rms = new Float32Array(beats);
    for (let b = 0; b < beats; b++) {
      const i0 = Math.floor((offset + b * period) * sr), i1 = Math.min(ch.length, Math.floor(i0 + period * sr));
      let e = 0, n = 0;
      for (let i = i0; i < i1; i += 4) { e += ch[i] * ch[i]; n++; }
      rms[b] = Math.sqrt(e / Math.max(1, n));
    }
    const win = 16; // 4마디
    let best = 0, bestScore = -1;
    const minBeat = Math.min(beats - win, Math.floor(12 / period)); // 너무 앞쪽(인트로)은 피함
    for (let b = Math.max(0, minBeat); b + win <= beats; b += 4) {
      let s = 0;
      for (let k = 0; k < win; k++) s += rms[b + k];
      // 직전보다 확 커지는 지점(후렴 진입)에 가산점
      let pre = 0;
      for (let k = 1; k <= 8 && b - k >= 0; k++) pre += rms[b - k];
      const score = s / win + 0.3 * Math.max(0, s / win - pre / 8);
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return Math.max(0, offset + best * period);
  }

  // ───────────────────────── 믹스 렌더링 ─────────────────────────
  const SR = 44100;
  const LOOP_BARS = 4;
  const musicCache = new Map();
  const sfxCache = new Map();

  // 장르 음악: (인트로 1마디) + 4마디 루프 2번만 합성한 뒤, 뒤쪽 루프를 이어 붙여 원하는 길이로 늘립니다.
  function genreBase(genre, bpm) {
    const key = genre.id + ':' + bpm;
    if (!musicCache.has(key)) {
      const barLen = (60 / bpm) * 4;
      const intro = genre.intro ? 1 : 0;
      const bars = intro + LOOP_BARS * 2;
      const ctx = new OfflineAudioContext(2, Math.ceil(SR * (bars * barLen + 2.5)), SR);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      const top = genre.lp || 18000;
      if (intro) {
        lp.frequency.setValueAtTime(350, 0);
        lp.frequency.exponentialRampToValueAtTime(top, barLen);
      } else lp.frequency.value = top;
      lp.connect(ctx.destination);
      const bus = ctx.createGain();
      bus.connect(lp);
      genre.render(new Kit(ctx, bus, bars * barLen + 0.1), bars, bpm, bus);
      musicCache.set(key, ctx.startRendering().then((buf) => ({ buf, barLen, intro })));
    }
    return musicCache.get(key);
  }

  async function genreBuffer(genreId, bpm, dur) {
    const genre = GENRES.find((g) => g.id === genreId) || GENRES[0];
    const { buf, barLen, intro } = await genreBase(genre, bpm || genre.bpm);
    const need = Math.ceil(dur * SR);
    const l0 = Math.round((intro + LOOP_BARS) * barLen * SR);
    const l1 = Math.round((intro + LOOP_BARS * 2) * barLen * SR);
    if (need <= l1) return buf;
    const out = new AudioBuffer({ length: need, numberOfChannels: 2, sampleRate: SR });
    for (let c = 0; c < 2; c++) {
      const src = buf.getChannelData(c), dst = out.getChannelData(c);
      dst.set(src.subarray(0, l1));
      const loop = src.subarray(l0, l1);
      for (let pos = l1; pos < need; pos += loop.length) dst.set(loop.subarray(0, Math.min(loop.length, need - pos)), pos);
    }
    return out;
  }

  function sfxBuffer(id) {
    if (!sfxCache.has(id)) {
      const def = SFX.find((s) => s.id === id) || { pre: 0 };
      if (id === 'reverse') {
        // 잔향을 뒤집어서 '빨려 들어오는' 소리를 만듭니다
        const len = Math.ceil(SR * def.pre);
        const ctx = new OfflineAudioContext(2, len, SR);
        playSfx(new Kit(ctx, ctx.destination, 99), id, def.pre, 1);
        sfxCache.set(id, ctx.startRendering().then((buf) => {
          for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            d.reverse();
            const f = Math.floor(SR * 0.08);
            for (let i = 0; i < f; i++) d[i] *= i / f; // 앞부분 부드럽게
          }
          return { buf, pre: def.pre };
        }));
      } else {
        const ctx = new OfflineAudioContext(2, Math.ceil(SR * (def.pre + 2.6)), SR);
        playSfx(new Kit(ctx, ctx.destination, 99), id, def.pre, 1);
        sfxCache.set(id, ctx.startRendering().then((buf) => ({ buf, pre: def.pre })));
      }
    }
    return sfxCache.get(id);
  }

  // opts: { duration, genreId | userBuffer, musicStart, bpm, musicVol, sfxEvents:[{t,id}], sfxVol }
  async function renderMix(opts) {
    const dur = Math.max(1, opts.duration + 0.6);
    const ctx = new OfflineAudioContext(2, Math.ceil(SR * dur), SR);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6; comp.ratio.value = 8; comp.attack.value = 0.003; comp.release.value = 0.15;
    comp.connect(ctx.destination);

    const music = ctx.createGain();
    music.gain.setValueAtTime(0, 0);
    music.gain.linearRampToValueAtTime(opts.musicVol, 0.03);
    const fadeAt = Math.max(0.1, opts.duration - 1.2);
    music.gain.setValueAtTime(opts.musicVol, fadeAt);
    music.gain.linearRampToValueAtTime(0, opts.duration + 0.1);
    music.connect(comp);

    const src = ctx.createBufferSource();
    if (opts.userBuffer) {
      src.buffer = opts.userBuffer;
      src.start(0, Math.max(0, opts.musicStart || 0));
    } else {
      src.buffer = await genreBuffer(opts.genreId, opts.bpm, dur);
      src.start(0);
    }
    src.connect(music);

    const events = (opts.sfxEvents || []).filter((e) => e.t < dur);
    if (events.length && opts.sfxVol > 0) {
      const sfxBus = ctx.createGain();
      sfxBus.gain.value = opts.sfxVol;
      sfxBus.connect(comp);
      const bufs = {};
      for (const id of new Set(events.map((e) => e.id))) bufs[id] = await sfxBuffer(id);
      events.forEach((e) => {
        const { buf, pre } = bufs[e.id];
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.connect(sfxBus);
        const at = e.t - pre;
        if (at >= 0) s.start(at); else s.start(0, -at);
      });
    }
    const out = await ctx.startRendering();
    // 클리핑 방지: 최고 레벨을 -1dB 로 맞춤
    let peak = 0;
    for (let c = 0; c < out.numberOfChannels; c++) {
      const d = out.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const a = d[i] < 0 ? -d[i] : d[i]; if (a > peak) peak = a; }
    }
    const lim = 0.89;
    if (peak > lim) {
      const g = lim / peak;
      for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= g; }
    }
    return out;
  }

  // 효과음 미리듣기
  async function previewSfx(audioCtx, id) {
    const { buf } = await sfxBuffer(id);
    const s = audioCtx.createBufferSource();
    const g = audioCtx.createGain();
    g.gain.value = 0.8;
    s.buffer = buf;
    s.connect(g).connect(audioCtx.destination);
    s.start();
    return s;
  }

  // 장르 미리 합성 (한가할 때)
  function warmup(genreIds) {
    genreIds.reduce((p, id) => p.then(() => { const g = GENRES.find((x) => x.id === id); return g && genreBase(g, g.bpm); }), Promise.resolve()).catch(() => {});
  }

  window.Music = { GENRES, SFX, renderMix, detectBeat, findHook, previewSfx, warmup };
})();
