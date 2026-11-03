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
    sound: true,        // play a tune when a student is graded
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
    updateSoundBtn();
    if ($("#answerBtn")) setAnswerBtn(!$("#qAnswer").hidden);
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
    $("#questionsFileName").textContent = state.questionsFile;
    $("#questionsFileMeta").textContent = n ? t("questionsLoaded", { n }) : "";
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
    $("#studentsFileName").textContent = state.studentsFile;
    $("#studentsFileMeta").textContent = s ? t("studentsLoaded", { n: s }) : "";
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
      order: [...Array(state.questions.length).keys()], // file order; only "Shuffle" mixes it
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

  // Text size applies only to the open question; every new question starts at the standard size.
  let textScale = 1;

  function applyTextScale() {
    $("#questionModal").style.setProperty("--qscale", textScale);
    $("#zoomOut").disabled = textScale <= 0.7;
    $("#zoomIn").disabled = textScale >= 1.6;
    $("#zoomReset").disabled = textScale === 1;
    $("#zoomReset").classList.toggle("changed", textScale !== 1);
  }

  function zoom(delta) {
    textScale = delta === 0 ? 1 : Math.round(Math.min(1.6, Math.max(0.7, textScale + delta)) * 10) / 10;
    applyTextScale();
    setTimeout(updateScrollHint, 250);
  }

  const EYE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';

  const SOUND_ON_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
  const SOUND_OFF_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

  function updateSoundBtn() {
    const btn = $("#soundBtn");
    if (!btn) return;
    const on = state.sound !== false;
    btn.innerHTML = on ? SOUND_ON_SVG : SOUND_OFF_SVG;
    btn.classList.toggle("off", !on);
    btn.setAttribute("aria-pressed", String(on));
    btn.title = t(on ? "soundOn" : "soundOff");
  }

  function setAnswerBtn(open) {
    const btn = $("#answerBtn");
    btn.classList.toggle("open", open);
    btn.querySelector(".ab-label").textContent = t(open ? "hideAnswer" : "showAnswer");
    btn.querySelector(".ab-icon").innerHTML = open ? EYE_OFF_SVG : EYE_SVG;
  }

  function toggleAnswer() {
    const box = $("#qAnswer");
    box.hidden = !box.hidden;
    setAnswerBtn(!box.hidden);
    if (!box.hidden) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
    requestAnimationFrame(updateScrollHint);
  }

  // fade + arrow at the bottom while more of a long question/answer is hidden below
  function updateScrollHint() {
    const el = $("#qScroll");
    el.classList.toggle("more", el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }

  function showQuestion() {
    const g = state.game;
    const cur = g.current;
    textScale = 1;
    applyTextScale();
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
    $("#qScroll").scrollTop = 0;
    requestAnimationFrame(updateScrollHint);
    // the "show answer" button exists only for questions whose file gave an answer
    const answer = q && q.answer;
    $("#answerRow").hidden = !answer;
    $("#qAnswer").hidden = true;
    $("#qAnswerText").textContent = answer || "";
    setAnswerBtn(false);
    $("#gradeRow").hidden = !st;
    $("#qModalFoot").hidden = !!st;
    openModal("#questionModal");
  }

  // Play the reaction inside the open question window, then record the grade and close it.
  let grading = false;
  function startGrade(btn, x, y) {
    const g = state.game;
    if (grading || !g || !g.current || !g.current.studentId) return;
    grading = true;
    const grade = btn.dataset.grade;
    $("#questionModal").classList.add("grading");
    btn.classList.add("chosen");
    window.Effects.burst(x, y, grade);
    if (state.sound !== false) window.Effects.play(grade);
    setTimeout(() => {
      grading = false;
      $("#questionModal").classList.remove("grading");
      btn.classList.remove("chosen");
      window.Effects.clear();
      gradeCurrent(grade);
    }, window.Effects.DURATION);
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

  // The bundled SheetJS build cannot write cell styles, so the styled build (xlsx-js-style) is loaded
  // only for the export, under its own name, leaving window.XLSX (used to read files) untouched.
  let styledXLSX = null;
  function loadStyledXLSX() {
    if (styledXLSX) return Promise.resolve(styledXLSX);
    return new Promise((resolve, reject) => {
      const reader = window.XLSX;
      const el = document.createElement("script");
      el.src = "vendor/xlsx-style.bundle.js";
      el.onload = () => { styledXLSX = window.XLSX; window.XLSX = reader; resolve(styledXLSX); };
      el.onerror = () => { window.XLSX = reader; reject(new Error("xlsx-style")); };
      document.head.appendChild(el);
    });
  }

  const XL = (() => {
    const line = { style: "thin", color: { rgb: "9AA7BD" } };
    const border = { top: line, bottom: line, left: line, right: line };
    const navy = "1F3C72";
    return {
      title: { font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: navy } }, alignment: { horizontal: "center", vertical: "center" }, border },
      label: { font: { bold: true, color: { rgb: navy } }, fill: { fgColor: { rgb: "E9EEF8" } }, alignment: { vertical: "center" }, border },
      value: { alignment: { horizontal: "left", vertical: "center" }, border },
      head: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: navy } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border },
      cell: { alignment: { vertical: "center", wrapText: true }, border },
      center: { alignment: { horizontal: "center", vertical: "center", wrapText: true }, border },
      zebra: "F6F8FB",
      total: { font: { bold: true, color: { rgb: navy } }, fill: { fgColor: { rgb: "E9EEF8" } }, alignment: { vertical: "center" },
        border: { top: { style: "medium", color: { rgb: navy } }, bottom: line, left: line, right: line } },
      grade: {
        excellent: { fill: "E5F4EA", font: "1F8A4C" },
        good: { fill: "FBF1DC", font: "9A6B10" },
        bad: { fill: "FBE9E7", font: "C0392B" }
      },
      muted: "94A3B8"
    };
  })();

  // put a value with a style into a sheet cell
  function put(ws, X, r, c, v, style) {
    const ref = X.utils.encode_cell({ r, c });
    ws[ref] = { v: v == null ? "" : v, t: typeof v === "number" ? "n" : "s", s: style };
  }

  function withFill(style, rgb) {
    return Object.assign({}, style, { fill: { fgColor: { rgb } } });
  }

  function gradeStyle(base, grade) {
    const g = XL.grade[grade];
    if (!g) return base;
    return Object.assign({}, base, { fill: { fgColor: { rgb: g.fill } }, font: { bold: true, color: { rgb: g.font } } });
  }

  // A4 landscape, fit to one page wide; optional frozen header row. Written straight into the sheet XML.
  function addPrintSetup(X, data, sheets) {
    const zip = X.CFB.read(new Uint8Array(data), { type: "array" });
    sheets.forEach((opt, i) => {
      const entry = X.CFB.find(zip, "/xl/worksheets/sheet" + (i + 1) + ".xml");
      if (!entry) return;
      let xml = new TextDecoder().decode(entry.content);
      xml = xml.replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
      xml = xml.replace(/(<pageMargins[^>]*\/>)/, '$1<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
      if (opt.freezeRows) {
        const top = "A" + (opt.freezeRows + 1);
        xml = xml.replace(/<sheetView workbookViewId="0"\/>/,
          `<sheetView workbookViewId="0"><pane ySplit="${opt.freezeRows}" topLeftCell="${top}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${top}" sqref="${top}"/></sheetView>`);
      }
      entry.content = new TextEncoder().encode(xml);
    });
    return X.CFB.write(zip, { fileType: "zip", type: "array", compression: true });
  }

  function saveFile(data, name) {
    const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); }, 1000);
  }

  async function downloadReport() {
    let X;
    try { X = await loadStyledXLSX(); } catch (e) { return toast(t("readError", { msg: e.message }), "error"); }
    const g = state.game;
    const now = new Date();
    const COLS = 8;

    // ---------- sheet 1: summary ----------
    const ws1 = {};
    const merges = [];
    let r = 0;
    for (let c = 0; c < COLS; c++) put(ws1, X, r, c, c ? "" : t("reportTitle") + " — Quest Student", XL.title);
    merges.push({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });
    r++;
    const info = [
      [t("rTeacher"), state.teacher],
      [t("rDate"), fmtDate(now)],
      [t("questionsPreview"), state.questions.length],
      [t("rounds"), g.round],
      [t("rPerStudent"), limit()],
      [t("totalStudents"), state.students.length],
      [t("answered"), new Set(g.results.map(x => x.studentId)).size]
    ];
    for (const [label, value] of info) {
      put(ws1, X, r, 0, label, XL.label); put(ws1, X, r, 1, "", XL.label);
      for (let c = 2; c < COLS; c++) put(ws1, X, r, c, c === 2 ? value : "", XL.value);
      merges.push({ s: { r, c: 0 }, e: { r, c: 1 } }, { s: { r, c: 2 }, e: { r, c: COLS - 1 } });
      r++;
    }
    r++; // empty row
    const headRow = r;
    const summaryRows = [];
    ["№", t("student"), t("questionNo"), t("grade"), t("rAvg"), t("rCountExcellent"), t("rCountGood"), t("rCountBad")]
      .forEach((h, c) => put(ws1, X, r, c, h, XL.head));
    r++;
    state.students.forEach((st, i) => {
      const rs = resultsOf(st.id);
      const cnt = gradeCounts(rs);
      const og = overallGrade(rs);
      const zebra = i % 2 ? XL.zebra : null;
      const cell = zebra ? withFill(XL.cell, zebra) : XL.cell;
      const center = zebra ? withFill(XL.center, zebra) : XL.center;
      const notGraded = Object.assign({}, center, { font: { italic: true, color: { rgb: XL.muted } } });
      put(ws1, X, r, 0, i + 1, center);
      put(ws1, X, r, 1, st.name, cell);
      put(ws1, X, r, 2, rs.map(x => x.card + 1).join(", ") || "—", center);
      put(ws1, X, r, 3, rs.length ? rs.map(x => t(x.grade)).join(", ") : t("notGraded"), rs.length ? center : notGraded);
      put(ws1, X, r, 4, og ? t(og) : "—", og ? gradeStyle(center, og) : center);
      put(ws1, X, r, 5, cnt.excellent, cnt.excellent ? gradeStyle(center, "excellent") : center);
      put(ws1, X, r, 6, cnt.good, cnt.good ? gradeStyle(center, "good") : center);
      put(ws1, X, r, 7, cnt.bad, cnt.bad ? gradeStyle(center, "bad") : center);
      const gradesText = rs.map(x => t(x.grade)).join(", ");
      const lines = Math.max(1, Math.ceil(gradesText.length / 24), Math.ceil(st.name.length / 32));
      summaryRows[r] = { hpt: Math.max(20, lines * 15 + 5) };
      r++;
    });
    const total = gradeCounts(g.results);
    const totalCenter = Object.assign({}, XL.total, { alignment: { horizontal: "center", vertical: "center" } });
    put(ws1, X, r, 0, t("total"), XL.total);
    for (let c = 1; c < 5; c++) put(ws1, X, r, c, "", XL.total);
    merges.push({ s: { r, c: 0 }, e: { r, c: 4 } });
    put(ws1, X, r, 5, total.excellent, totalCenter);
    put(ws1, X, r, 6, total.good, totalCenter);
    put(ws1, X, r, 7, total.bad, totalCenter);
    ws1["!ref"] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r, c: COLS - 1 } });
    ws1["!merges"] = merges;
    ws1["!cols"] = [{ wch: 6 }, { wch: 34 }, { wch: 14 }, { wch: 26 }, { wch: 16 }, { wch: 11 }, { wch: 14 }, { wch: 11 }];
    ws1["!rows"] = summaryRows;
    ws1["!rows"][0] = { hpt: 30 };
    ws1["!margins"] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    ws1["!rows"][headRow] = { hpt: 32 };

    // ---------- sheet 2: details ----------
    const ws2 = {};
    const detailHead = ["№", t("student"), t("rRound"), t("questionNo"), t("rQuestion"), t("rAnswer"), t("grade"), t("rTime")];
    const widths = [6, 28, 8, 10, 60, 36, 14, 18];
    detailHead.forEach((h, c) => put(ws2, X, 0, c, h, XL.head));
    const rows2 = [{ hpt: 30 }];
    g.results.forEach((res, i) => {
      const rr = i + 1;
      const zebra = i % 2 ? XL.zebra : null;
      const cell = zebra ? withFill(XL.cell, zebra) : XL.cell;
      const center = zebra ? withFill(XL.center, zebra) : XL.center;
      const answer = (state.questions[res.qIndex] && state.questions[res.qIndex].answer) || "—";
      put(ws2, X, rr, 0, rr, center);
      put(ws2, X, rr, 1, res.name, cell);
      put(ws2, X, rr, 2, res.round, center);
      put(ws2, X, rr, 3, res.card + 1, center);
      put(ws2, X, rr, 4, res.question, cell);
      put(ws2, X, rr, 5, answer, cell);
      put(ws2, X, rr, 6, t(res.grade), gradeStyle(center, res.grade));
      put(ws2, X, rr, 7, fmtDate(new Date(res.time)), center);
      // Excel does not grow rows for wrapped text by itself, so size them from the longest cell
      const lines = Math.max(1, Math.ceil(String(res.question).length / (widths[4] - 4)), Math.ceil(String(answer).length / (widths[5] - 4)),
        Math.ceil(String(res.name).length / (widths[1] - 2)));
      rows2[rr] = { hpt: Math.max(20, lines * 15 + 5) };
    });
    const last2 = Math.max(1, g.results.length);
    ws2["!ref"] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: last2, c: detailHead.length - 1 } });
    if (!g.results.length) for (let c = 0; c < detailHead.length; c++) put(ws2, X, 1, c, c === 1 ? t("noResults") : "", XL.cell);
    ws2["!cols"] = widths.map(w => ({ wch: w }));
    ws2["!rows"] = rows2;
    ws2["!margins"] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    ws2["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: last2, c: detailHead.length - 1 } }) };

    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws1, t("rSummary").slice(0, 31));
    X.utils.book_append_sheet(wb, ws2, t("rDetails").slice(0, 31));
    const p = n => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}-${p(now.getMinutes())}`;
    const safeTeacher = state.teacher.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").slice(0, 40);
    const data = addPrintSetup(X, X.write(wb, { type: "array", bookType: "xlsx" }), [{}, { freezeRows: 1 }]);
    saveFile(data, `${t("reportTitle")}_${safeTeacher}_${stamp}.xlsx`);
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
    if (sel === "#questionModal" && grading) return; // wait for the grading reaction to finish
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
    const clearQuestions = () => { state.questions = []; state.questionsFile = ""; state.game = null; renderSetup(); save(); };
    const clearStudents = () => { state.students = []; state.studentsFile = ""; state.game = null; renderSetup(); save(); };
    $("#clearQuestions").addEventListener("click", clearQuestions);
    $("#clearStudents").addEventListener("click", clearStudents);
    // buttons live inside the dropzone <label>, so they must not trigger its file picker themselves
    $$("[data-replace]").forEach(b => b.addEventListener("click", e => {
      e.preventDefault(); e.stopPropagation();
      $("#" + b.dataset.replace).click();
    }));
    $$("[data-remove]").forEach(b => b.addEventListener("click", e => {
      e.preventDefault(); e.stopPropagation();
      (b.dataset.remove === "questions" ? clearQuestions : clearStudents)();
    }));
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
    $("#zoomOut").addEventListener("click", () => zoom(-0.1));
    $("#zoomIn").addEventListener("click", () => zoom(0.1));
    $("#zoomReset").addEventListener("click", () => zoom(0));
    $("#answerBtn").addEventListener("click", toggleAnswer);
    $("#qScroll").addEventListener("scroll", updateScrollHint, { passive: true });
    window.addEventListener("resize", updateScrollHint);
    applyTextScale();
    if (synth && synth.onvoiceschanged !== undefined) synth.onvoiceschanged = () => synth.getVoices();
    $$(".grade-btn").forEach(b => {
      // the reaction starts the moment the button is pressed down
      b.addEventListener("pointerdown", e => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        startGrade(b, e.clientX, e.clientY);
      });
      // keyboard (Enter / Space) has no pointerdown: burst from the button centre
      b.addEventListener("click", e => {
        if (e.detail !== 0) return;
        const r = b.getBoundingClientRect();
        startGrade(b, r.left + r.width / 2, r.top + r.height / 2);
      });
    });
    $("#soundBtn").addEventListener("click", () => { state.sound = state.sound === false; updateSoundBtn(); save(); });

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
