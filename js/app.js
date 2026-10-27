(function () {
  "use strict";

  const STORE_KEY = "questStudent.v1";
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const esc = window.Parsers.escapeHtml;

  const GRADES = {
    excellent: { icon: "🌟", cls: "excellent", score: 5 },
    good: { icon: "👍", cls: "good", score: 4 },
    bad: { icon: "👎", cls: "bad", score: 2 }
  };

  const state = {
    lang: "uz",
    teacher: "",
    perStudent: 1,      // how many questions each student answers
    questions: [],      // [{html, text}]
    questionsFile: "",
    students: [],       // [{id, name}]
    studentsFile: "",
    screen: "setup",
    game: null          // see newGame()
  };

  // ---------- helpers ----------
  function t(key, vars) {
    const dict = window.I18N[state.lang] || window.I18N.uz;
    let s = dict[key] != null ? dict[key] : (window.I18N.uz[key] || key);
    if (vars) for (const k in vars) s = s.replace("{" + k + "}", vars[k]);
    return s;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // A permutation that, when possible, moves every question to a different card.
  function freshOrder(n, prev) {
    let order = shuffle([...Array(n).keys()]);
    if (prev && n > 1) {
      for (let tries = 0; tries < 20 && order.some((q, i) => q === prev[i]); tries++) order = shuffle(order);
    }
    return order;
  }

  function fmtDate(d) {
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function toast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast " + (type || "info");
    el.textContent = msg;
    $("#toasts").appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 350);
    }, 3200);
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return false;
      Object.assign(state, JSON.parse(raw));
      return true;
    } catch (e) { return false; }
  }

  // ---------- i18n ----------
  function applyLang() {
    document.documentElement.lang = state.lang;
    $$("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    $$("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $$("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
    updateSpeakBtn();
    $$(".lang-btn").forEach(b => b.classList.toggle("active", b.dataset.lang === state.lang));
    renderSetup();
    if (state.screen === "game") renderGame();
  }

  // ---------- setup screen ----------
  function cardColor(i) { return "c" + (i % 8); }

  // Up to ~200 questions: cards shrink as their number grows so the board stays on one screen.
  function densityClass(n) { return n > 100 ? "d2" : n > 48 ? "d1" : ""; }
  function dealDelay(i, n) { return Math.min(i * (n > 100 ? 4 : n > 48 ? 10 : 20), 900); }

  function renderSetup() {
    const n = state.questions.length;
    $("#qCount").textContent = n;
    $("#previewEmpty").hidden = n > 0;
    $("#clearQuestions").hidden = n === 0;
    $("#questionsFileName").textContent = state.questionsFile ? "✔ " + state.questionsFile : "";
    $("#questionsDrop").classList.toggle("loaded", n > 0);

    const grid = $("#previewGrid");
    grid.classList.remove("d1", "d2");
    if (densityClass(n)) grid.classList.add(densityClass(n));
    grid.innerHTML = state.questions.map((q, i) =>
      `<div class="num-card ${cardColor(i)}" style="--d:${dealDelay(i, n)}ms" title="${esc(q.text.slice(0, 160))}">
         <span class="num">${i + 1}</span>
       </div>`).join("");

    const s = state.students.length;
    $("#studentsPanel").hidden = s === 0;
    $("#sCount").textContent = s;
    $("#studentsFileName").textContent = state.studentsFile ? "✔ " + state.studentsFile : "";
    $("#studentsDrop").classList.toggle("loaded", s > 0);
    $("#perStudentField").hidden = s === 0;
    $("#perStudentInput").value = state.perStudent;
    $("#psMinus").disabled = state.perStudent <= 1;
    $("#psPlus").disabled = state.perStudent >= 20;
    $("#studentsPreview").innerHTML = state.students.map(st => `<li>${esc(st.name)}</li>`).join("");
    document.querySelector(".setup-layout").classList.toggle("with-students", s > 0);

    $("#startBtn").disabled = n === 0;
    $("#startHint").textContent = n === 0 ? t("startHint") : t("startReady");
  }

  async function handleQuestionsFile(file) {
    if (!file) return;
    try {
      const qs = await window.Parsers.parseQuestions(file);
      if (!qs.length) return toast(t("noQuestions"), "error");
      state.questions = qs;
      state.questionsFile = file.name;
      state.game = null;
      renderSetup();
      save();
      toast(t("questionsLoaded", { n: qs.length }), "success");
    } catch (e) {
      toast(e.message === "unsupported" ? t("unsupported") : t("readError", { msg: e.message }), "error");
    }
  }

  async function handleStudentsFile(file) {
    if (!file) return;
    try {
      const names = await window.Parsers.parseStudents(file);
      if (!names.length) return toast(t("noStudents"), "error");
      state.students = names.map((name, i) => ({ id: "s" + i, name }));
      state.studentsFile = file.name;
      state.game = null;
      renderSetup();
      save();
      toast(t("studentsLoaded", { n: names.length }), "success");
    } catch (e) {
      toast(e.message === "unsupported" ? t("unsupported") : t("readError", { msg: e.message }), "error");
    }
  }

  function setupDropzone(zone, input, handler) {
    input.addEventListener("change", () => { handler(input.files[0]); input.value = ""; });
    ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("drag"); }));
    zone.addEventListener("drop", e => handler(e.dataTransfer.files[0]));
  }

  // ---------- game ----------
  function newGame() {
    return {
      order: freshOrder(state.questions.length),
      used: {},            // card index -> {studentId, grade}
      round: 1,
      selected: null,      // selected student id
      current: null,       // {card, studentId}
      results: [],         // [{studentId, name, card, qIndex, grade, round, time}]
      startedAt: Date.now()
    };
  }

  function startGame() {
    state.teacher = $("#teacherName").value.trim();
    if (!state.teacher) {
      const w = $("#teacherName").closest(".input-wrap");
      w.classList.remove("shake"); void w.offsetWidth; w.classList.add("shake");
      $("#teacherName").focus();
      return toast(t("teacherRequired"), "error");
    }
    if (!state.questions.length) return;
    state.game = newGame();
    showScreen("game");
    renderGame(true);
    save();
  }

  function showScreen(name) {
    state.screen = name;
    $("#setupScreen").classList.toggle("active", name === "setup");
    $("#gameScreen").classList.toggle("active", name === "game");
    window.scrollTo(0, 0);
  }

  function studentById(id) { return state.students.find(s => s.id === id); }
  function resultsOf(id) { return state.game.results.filter(r => r.studentId === id); }
  function limit() { return Math.max(1, state.perStudent || 1); }
  function isFull(id) { return resultsOf(id).length >= limit(); }

  function setPerStudent(v) {
    state.perStudent = Math.min(20, Math.max(1, parseInt(v, 10) || 1));
    renderSetup();
    save();
  }

  function renderGame(deal) {
    const g = state.game;
    if (!g) return;
    $("#gameTeacher").textContent = state.teacher;
    const hasStudents = state.students.length > 0;
    $("#roster").hidden = !hasStudents;
    $("#gameLayout").classList.toggle("with-roster", hasStudents);
    $("#reportBtnTop").hidden = !hasStudents;

    const usedCount = Object.keys(g.used).length;
    $("#statOpened").textContent = usedCount;
    $("#statLeft").textContent = state.questions.length - usedCount;
    $("#statRound").textContent = g.round;

    // board
    const grid = $("#gameGrid");
    const n = state.questions.length;
    grid.classList.toggle("deal", !!deal);
    grid.classList.remove("d1", "d2");
    if (densityClass(n)) grid.classList.add(densityClass(n));
    grid.innerHTML = g.order.map((_, i) => {
      const u = g.used[i];
      if (u) {
        const st = u.studentId && studentById(u.studentId);
        const gr = u.grade ? GRADES[u.grade] : null;
        return `<button class="num-card used ${cardColor(i)} ${gr ? "g-" + gr.cls : ""}" disabled style="--d:${dealDelay(i, n)}ms" title="${st ? esc(st.name) : ""}">
          <span class="num">${i + 1}</span>
          <span class="used-mark">${gr ? gr.icon : "✓"}</span>
          ${st ? `<span class="who">${esc(st.name)}</span>` : ""}
        </button>`;
      }
      return `<button class="num-card ${cardColor(i)}" data-card="${i}" style="--d:${dealDelay(i, n)}ms">
        <span class="num">${i + 1}</span><span class="shine"></span>
      </button>`;
    }).join("");

    // hint
    let hint;
    if (usedCount === state.questions.length) hint = t("hintAllOpened");
    else if (!hasStudents) hint = t("hintNoStudents");
    else if (g.selected) {
      const name = (studentById(g.selected) || {}).name || "";
      hint = t("hintPickCard", { name: limit() > 1 ? `${name} (${resultsOf(g.selected).length + 1}/${limit()})` : name });
    }
    else hint = t("hintPickStudent");
    $("#boardHint").textContent = hint;
    $("#boardHint").classList.toggle("ready", !!g.selected || !hasStudents);
    grid.classList.toggle("locked", hasStudents && !g.selected);

    if (hasStudents) renderRoster();
  }

  function renderRoster() {
    const g = state.game;
    const q = $("#rosterSearch").value.trim().toLowerCase();
    $("#rosterCount").textContent = `${new Set(g.results.map(r => r.studentId)).size}/${state.students.length}`;
    $("#rosterList").innerHTML = state.students
      .filter(s => !q || s.name.toLowerCase().includes(q))
      .map(s => {
        const rs = resultsOf(s.id);
        const chips = rs.map(r => `<span class="chip ${GRADES[r.grade].cls}" title="${esc(t(r.grade))} · №${r.card + 1}">${GRADES[r.grade].icon}</span>`).join("");
        const idx = state.students.indexOf(s) + 1;
        const count = limit() > 1 ? `<span class="r-count">${rs.length}/${limit()}</span>` : "";
        return `<li>
          <button class="roster-item ${g.selected === s.id ? "selected" : ""} ${rs.length ? "done" : ""} ${rs.length >= limit() ? "full" : ""}" data-student="${s.id}">
            <span class="r-idx">${idx}</span>
            <span class="r-name">${esc(s.name)}</span>
            <span class="r-chips">${chips}${count}</span>
          </button>
        </li>`;
      }).join("");
  }

  function selectStudent(id) {
    const g = state.game;
    if (g.selected !== id && isFull(id)) {
      return toast(t("limitReached", { name: studentById(id).name, n: limit() }), "error");
    }
    g.selected = g.selected === id ? null : id;
    renderGame();
    save();
  }

  function randomStudent() {
    const g = state.game;
    const pool = state.students.filter(s => !isFull(s.id));
    if (!pool.length) return toast(t("allDone"), "info");
    const pick = pool[Math.floor(Math.random() * pool.length)];
    g.selected = pick.id;
    renderGame();
    save();
    const el = document.querySelector(`[data-student="${pick.id}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("pop");
    }
  }

  function openCard(i, btn) {
    const g = state.game;
    if (g.used[i]) return;
    const hasStudents = state.students.length > 0;
    if (hasStudents && !g.selected) {
      const r = $("#roster");
      r.classList.remove("shake"); void r.offsetWidth; r.classList.add("shake");
      return toast(t("selectStudentFirst"), "error");
    }
    g.used[i] = { studentId: g.selected || null, grade: null };
    g.current = { card: i, studentId: g.selected || null };
    if (btn) btn.classList.add("flipping");
    save();
    setTimeout(() => { showQuestion(); renderGame(); }, btn ? 380 : 0);
  }

  function showQuestion() {
    const g = state.game;
    const cur = g.current;
    if (!cur) return;
    const q = state.questions[g.order[cur.card]];
    const st = cur.studentId && studentById(cur.studentId);
    $("#qModalNumber").textContent = cur.card + 1;
    $("#qModalNum2").textContent = cur.card + 1;
    $("#qModalNumber").className = "q-number " + cardColor(cur.card);
    $("#qModalStudent").textContent = st ? "👤 " + st.name : "";
    const showProgress = !!st && limit() > 1;
    $("#qProgress").hidden = !showProgress;
    if (showProgress) $("#qProgress").textContent = `${resultsOf(st.id).length + 1}/${limit()}`;
    $("#qModalBody").innerHTML = q ? q.html : "";
    $("#gradeRow").hidden = !st;
    $("#qModalFoot").hidden = !!st;
    openModal("#questionModal");
  }

  function gradeCurrent(grade) {
    const g = state.game;
    const cur = g.current;
    if (!cur || !cur.studentId) return;
    const st = studentById(cur.studentId);
    const qIndex = g.order[cur.card];
    g.results.push({
      studentId: st.id, name: st.name, card: cur.card, qIndex,
      question: state.questions[qIndex] ? state.questions[qIndex].text : "",
      grade, round: g.round, time: Date.now()
    });
    g.used[cur.card] = { studentId: st.id, grade };
    g.current = null;
    // the student keeps the turn until they have answered `perStudent` questions
    if (isFull(st.id)) g.selected = null;
    closeModal("#questionModal");
    renderGame();
    save();
    toast(t("graded", { name: st.name, grade: GRADES[grade].icon + " " + t(grade) }), grade === "bad" ? "error" : "success");
  }

  function doShuffle() {
    const g = state.game;
    const grid = $("#gameGrid");
    const btn = $("#shuffleBtn");
    btn.disabled = true;
    btn.classList.add("spinning");
    $$("#gameGrid .num-card").forEach(c => {
      c.style.setProperty("--dx", (Math.random() * 160 - 80).toFixed(0) + "px");
      c.style.setProperty("--dy", (Math.random() * 120 - 60).toFixed(0) + "px");
      c.style.setProperty("--rot", (Math.random() * 50 - 25).toFixed(0) + "deg");
    });
    grid.classList.remove("deal");
    grid.classList.add("shuffling");
    setTimeout(() => {
      g.order = freshOrder(state.questions.length, g.order);
      g.used = {};
      g.current = null;
      g.round += 1;
      grid.classList.remove("shuffling");
      renderGame(true);
      save();
      btn.disabled = false;
      btn.classList.remove("spinning");
      toast(t("shuffled"), "success");
    }, 850);
  }

  // ---------- finish & report ----------
  function gradeCounts(results) {
    const c = { excellent: 0, good: 0, bad: 0 };
    results.forEach(r => { c[r.grade]++; });
    return c;
  }

  function overallGrade(rs) {
    if (!rs.length) return "";
    const avg = rs.reduce((a, r) => a + GRADES[r.grade].score, 0) / rs.length;
    return avg >= 4.5 ? "excellent" : avg >= 3 ? "good" : "bad";
  }

  function openFinish() {
    const g = state.game;
    const hasStudents = state.students.length > 0;
    $("#finishSub").textContent = t("finishSub", { teacher: state.teacher, date: fmtDate(new Date()) });
    const c = gradeCounts(g.results);
    const answered = new Set(g.results.map(r => r.studentId)).size;
    const tiles = hasStudents ? [
      ["👥", state.students.length, t("totalStudents"), ""],
      ["✅", answered, t("answered"), ""],
      ["🌟", c.excellent, t("excellent"), "excellent"],
      ["👍", c.good, t("good"), "good"],
      ["👎", c.bad, t("bad"), "bad"]
    ] : [
      ["🃏", state.questions.length, t("questionsPreview"), ""],
      ["📖", Object.keys(g.used).length, t("openedCount"), ""],
      ["🔀", g.round, t("rounds"), ""]
    ];
    $("#summaryCards").innerHTML = tiles.map(([i, n, l, cls]) =>
      `<div class="sum-tile ${cls}"><span class="sum-icon">${i}</span><span class="sum-num">${n}</span><span class="sum-label">${esc(l)}</span></div>`).join("");

    $("#resultsWrap").hidden = !hasStudents;
    $("#downloadReport").hidden = !hasStudents;
    if (hasStudents) {
      $("#resultsBody").innerHTML = state.students.map((s, i) => {
        const rs = resultsOf(s.id);
        const grades = rs.length
          ? rs.map(r => `<span class="grade-pill ${GRADES[r.grade].cls}">${GRADES[r.grade].icon} ${esc(t(r.grade))}</span>`).join(" ")
          : `<span class="muted">— ${esc(t("notGraded"))}</span>`;
        return `<tr class="${rs.length ? "" : "dim"}"><td>${i + 1}</td><td>${esc(s.name)}</td><td>${rs.map(r => r.card + 1).join(", ") || "—"}</td><td>${grades}</td></tr>`;
      }).join("");
    }
    openModal("#finishModal");
  }

  function downloadReport() {
    if (!window.XLSX) return;
    const g = state.game;
    const now = new Date();
    const head = [
      [t("reportTitle") + " — Quest Student"],
      [t("rTeacher"), state.teacher],
      [t("rDate"), fmtDate(now)],
      [t("questionsPreview"), state.questions.length, t("rounds"), g.round, t("rPerStudent"), limit()],
      []
    ];
    const summaryHeader = ["№", t("student"), t("questionNo"), t("grade"), t("rAvg"), t("rCountExcellent"), t("rCountGood"), t("rCountBad")];
    const summaryRows = state.students.map((s, i) => {
      const rs = resultsOf(s.id);
      const c = gradeCounts(rs);
      const og = overallGrade(rs);
      return [
        i + 1, s.name,
        rs.map(r => r.card + 1).join(", ") || "—",
        rs.map(r => t(r.grade)).join(", ") || t("notGraded"),
        og ? t(og) : "—",
        c.excellent, c.good, c.bad
      ];
    });
    const total = gradeCounts(g.results);
    const ws1 = XLSX.utils.aoa_to_sheet([...head, summaryHeader, ...summaryRows, [],
      ["", t("totalStudents") + ": " + state.students.length, "", t("answered") + ": " + new Set(g.results.map(r => r.studentId)).size, "", total.excellent, total.good, total.bad]]);
    ws1["!cols"] = [{ wch: 5 }, { wch: 34 }, { wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
    ws1["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];

    const detailHeader = ["№", t("student"), t("rRound"), t("questionNo"), t("rQuestion"), t("grade"), t("rTime")];
    const detailRows = g.results.map((r, i) => [
      i + 1, r.name, r.round, r.card + 1, r.question, t(r.grade), fmtDate(new Date(r.time))
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
    ws2["!cols"] = [{ wch: 5 }, { wch: 30 }, { wch: 8 }, { wch: 10 }, { wch: 70 }, { wch: 14 }, { wch: 18 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, t("rSummary").slice(0, 31));
    XLSX.utils.book_append_sheet(wb, ws2, t("rDetails").slice(0, 31));
    const p = n => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}`;
    const safeTeacher = state.teacher.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").slice(0, 40);
    XLSX.writeFile(wb, `${t("reportTitle")}_${safeTeacher}_${stamp}.xlsx`);
  }

  function newSession() {
    if (state.game && state.game.results.length && !confirm(t("confirmNew"))) return;
    state.game = null;
    closeModal("#finishModal");
    showScreen("setup");
    renderSetup();
    save();
  }

  // ---------- text-to-speech (for students with poor eyesight) ----------
  const synth = window.speechSynthesis;
  let speaking = false;

  function pickVoice(lang) {
    const voices = synth ? synth.getVoices() : [];
    const base = lang.slice(0, 2);
    return voices.find(v => v.lang === lang && /google|natural|neural|samantha|daniel/i.test(v.name)) ||
      voices.find(v => v.lang === lang) ||
      voices.find(v => v.lang && v.lang.toLowerCase().startsWith(base)) || null;
  }

  // Questions are mostly in English; Cyrillic text is read with a Russian voice.
  function detectLang(text) {
    return /[\u0400-\u04FF]/.test(text) ? "ru-RU" : "en-US";
  }

  function updateSpeakBtn() {
    const btn = $("#speakBtn");
    if (!btn) return;
    btn.classList.toggle("active", speaking);
    btn.querySelector(".speak-icon").textContent = speaking ? "⏹" : "🔊";
    btn.querySelector(".speak-label").textContent = t(speaking ? "stopListen" : "listen");
    btn.title = t(speaking ? "stopListen" : "listen");
  }

  function stopSpeaking() {
    if (synth) synth.cancel();
    speaking = false;
    updateSpeakBtn();
  }

  function speakQuestion() {
    if (!synth) return toast(t("noSpeech"), "error");
    if (speaking) return stopSpeaking();
    const text = $("#qModalBody").innerText.replace(/\s+/g, " ").trim();
    if (!text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = detectLang(text);
    const voice = pickVoice(u.lang);
    if (voice) u.voice = voice;
    u.rate = 0.9;
    u.onend = u.onerror = () => { speaking = false; updateSpeakBtn(); };
    speaking = true;
    updateSpeakBtn();
    synth.speak(u);
  }

  // ---------- modals ----------
  function openModal(sel) {
    const m = $(sel);
    m.classList.add("open");
    m.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeModal(sel) {
    const m = $(sel);
    m.classList.remove("open");
    m.setAttribute("aria-hidden", "true");
    if (!$$(".modal.open").length) document.body.classList.remove("modal-open");
    if (sel === "#questionModal") stopSpeaking();
    if (sel === "#questionModal" && state.game) {
      // closed without grading: the card stays opened, student stays selected
      state.game.current = null;
      save();
    }
  }

  // ---------- events ----------
  function bind() {
    $$(".lang-btn").forEach(b => b.addEventListener("click", () => { state.lang = b.dataset.lang; applyLang(); save(); }));
    $("#teacherName").addEventListener("input", e => { state.teacher = e.target.value; save(); });
    setupDropzone($("#questionsDrop"), $("#questionsFile"), handleQuestionsFile);
    setupDropzone($("#studentsDrop"), $("#studentsFile"), handleStudentsFile);
    $("#clearQuestions").addEventListener("click", () => { state.questions = []; state.questionsFile = ""; state.game = null; renderSetup(); save(); });
    $("#clearStudents").addEventListener("click", () => { state.students = []; state.studentsFile = ""; state.game = null; renderSetup(); save(); });
    $("#startBtn").addEventListener("click", startGame);
    $("#psMinus").addEventListener("click", () => setPerStudent(state.perStudent - 1));
    $("#psPlus").addEventListener("click", () => setPerStudent(state.perStudent + 1));
    $("#perStudentInput").addEventListener("change", e => setPerStudent(e.target.value));

    $("#gameGrid").addEventListener("click", e => {
      const btn = e.target.closest("[data-card]");
      if (btn) openCard(Number(btn.dataset.card), btn);
    });
    $("#rosterList").addEventListener("click", e => {
      const b = e.target.closest("[data-student]");
      if (b) selectStudent(b.dataset.student);
    });
    $("#rosterSearch").addEventListener("input", renderRoster);
    $("#randomStudent").addEventListener("click", randomStudent);
    $("#shuffleBtn").addEventListener("click", doShuffle);
    $("#jumpForm").addEventListener("submit", e => {
      e.preventDefault();
      const input = $("#jumpInput");
      const i = parseInt(input.value, 10) - 1;
      input.value = "";
      if (!(i >= 0 && i < state.questions.length)) return toast(t("badNumber", { n: state.questions.length }), "error");
      if (state.game.used[i]) return toast(t("cardTaken", { n: i + 1 }), "error");
      const btn = document.querySelector(`[data-card="${i}"]`);
      if (btn) btn.scrollIntoView({ block: "center", behavior: "smooth" });
      openCard(i, btn);
    });
    $("#finishBtn").addEventListener("click", openFinish);
    $("#reportBtnTop").addEventListener("click", downloadReport);
    $("#downloadReport").addEventListener("click", downloadReport);
    $("#newSession").addEventListener("click", newSession);
    $("#speakBtn").addEventListener("click", speakQuestion);
    if (synth && synth.onvoiceschanged !== undefined) synth.onvoiceschanged = () => synth.getVoices();
    $$(".grade-btn").forEach(b => b.addEventListener("click", () => gradeCurrent(b.dataset.grade)));

    $$(".modal").forEach(m => m.addEventListener("click", e => {
      if (e.target.closest("[data-close]")) closeModal("#" + m.id);
    }));
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") $$(".modal.open").forEach(m => closeModal("#" + m.id));
    });
  }

  function init() {
    const restored = load();
    bind();
    $("#teacherName").value = state.teacher || "";
    if (state.screen === "game" && state.game && state.questions.length) {
      showScreen("game");
      applyLang();
      renderGame(true);
      if (restored) toast(t("restored"), "info");
    } else {
      state.screen = "setup";
      showScreen("setup");
      applyLang();
    }
  }

  init();
})();
