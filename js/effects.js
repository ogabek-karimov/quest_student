// Grading feedback: a short synthesized tune and a Telegram-style emoji burst from the pressed button.
(function () {
  "use strict";

  // ---------- sound (Web Audio, no files) ----------
  let ctx = null;
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(ac, freq, start, dur, type, gain, slideTo) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  const TUNES = {
    // bright rising fanfare with a sparkle on top
    excellent(ac, t) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ac, f, t + i * 0.09, 0.32, "triangle", 0.22));
      tone(ac, 1046.5, t + 0.36, 0.7, "triangle", 0.2);
      tone(ac, 1318.5, t + 0.36, 0.7, "sine", 0.1);
      [2093, 2637, 3136].forEach((f, i) => tone(ac, f, t + 0.45 + i * 0.07, 0.25, "sine", 0.05));
    },
    // friendly two-note "ding-dong" up
    good(ac, t) {
      tone(ac, 659.25, t, 0.22, "sine", 0.22);
      tone(ac, 880, t + 0.14, 0.4, "sine", 0.22);
      tone(ac, 1318.5, t + 0.14, 0.3, "sine", 0.05);
    },
    // soft descending "wah-wah"
    bad(ac, t) {
      tone(ac, 392, t, 0.28, "triangle", 0.18, 370);
      tone(ac, 349.23, t + 0.26, 0.28, "triangle", 0.18, 330);
      tone(ac, 311.13, t + 0.52, 0.6, "triangle", 0.18, 260);
    }
  };

  function play(grade) {
    const ac = audio();
    if (!ac || !TUNES[grade]) return;
    TUNES[grade](ac, ac.currentTime + 0.02);
  }

  // ---------- emoji burst ----------
  const SETS = {
    excellent: { big: "🌟", bits: ["🌟", "⭐", "✨", "🎉", "🏆", "💫"], confetti: true, count: 22, up: true },
    good: { big: "👍", bits: ["👍", "👏", "✨", "🙂"], confetti: false, count: 14, up: true },
    bad: { big: "👎", bits: ["👎", "😕", "💧"], confetti: false, count: 9, up: false }
  };
  const CONFETTI = ["#c19a3f", "#1f3c72", "#1f8a4c", "#e14f6b", "#3a8dff", "#f3d27a"];

  function layer() {
    let el = document.getElementById("fxLayer");
    if (!el) {
      el = document.createElement("div");
      el.id = "fxLayer";
      el.className = "fx-layer";
      document.body.appendChild(el);
    }
    return el;
  }

  function particle(root, x, y, html, cls, size, angle, dist, rise, dur, spin) {
    const p = document.createElement("span");
    p.className = "fx " + cls;
    p.innerHTML = html;
    p.style.left = x + "px";
    p.style.top = y + "px";
    if (size) p.style.fontSize = size + "px";
    root.appendChild(p);
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
    const anim = p.animate([
      { transform: "translate(-50%,-50%) scale(0.3) rotate(0deg)", opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.55 - rise}px)) scale(1.15) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy - rise * 0.4 + 140}px)) scale(0.8) rotate(${spin}deg)`, opacity: 0 }
    ], { duration: dur, easing: "cubic-bezier(.2,.7,.3,1)" });
    anim.onfinish = () => root.removeChild(p);
  }

  function burst(x, y, grade) {
    const set = SETS[grade];
    if (!set || !document.body.animate) return;
    const root = layer();
    const rnd = (a, b) => a + Math.random() * (b - a);

    // the big reaction pops at the pressed point, like a Telegram reaction
    const big = document.createElement("span");
    big.className = "fx fx-big";
    big.textContent = set.big;
    big.style.left = x + "px";
    big.style.top = y + "px";
    root.appendChild(big);
    big.animate([
      { transform: "translate(-50%,-50%) scale(0.2)", opacity: 0 },
      { transform: "translate(-50%,-90%) scale(1.9)", opacity: 1, offset: 0.3 },
      { transform: "translate(-50%,-110%) scale(1.6)", opacity: 1, offset: 0.65 },
      { transform: `translate(-50%,${set.up ? "-260%" : "40%"}) scale(0.6)`, opacity: 0 }
    ], { duration: 1100, easing: "cubic-bezier(.2,.8,.3,1)" }).onfinish = () => root.removeChild(big);

    // flying emojis
    for (let i = 0; i < set.count; i++) {
      const angle = set.up ? rnd(-Math.PI * 0.95, -Math.PI * 0.05) : rnd(-Math.PI * 0.8, -Math.PI * 0.2);
      const em = set.bits[Math.floor(Math.random() * set.bits.length)];
      particle(root, x, y, em, "fx-emoji", rnd(20, 38), angle, rnd(90, set.up ? 260 : 140), set.up ? rnd(60, 160) : rnd(10, 40),
        rnd(900, 1500), rnd(-200, 200));
    }
    // confetti for "excellent"
    if (set.confetti) {
      for (let i = 0; i < 34; i++) {
        const c = CONFETTI[i % CONFETTI.length];
        particle(root, x, y, `<i style="background:${c}"></i>`, "fx-confetti", 0, rnd(-Math.PI, 0), rnd(120, 340), rnd(80, 200),
          rnd(1100, 1800), rnd(-540, 540));
      }
    }
  }

  window.Effects = { play, burst };
})();
