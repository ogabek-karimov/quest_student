// File parsers: questions (Word / txt) and student lists (Excel / CSV / Word / txt).
(function () {
  "use strict";

  // "1. ...", "1) ...", "№1 ...", "1-savol ...", "Savol 1: ...", "Question 1. ..."
  const NUM_RE = /^\s*(?:№\s*)?\d{1,3}\s*(?:[.)\]:]|-(?!\d))\s*(?=\S)/;
  const WORD_NUM_RE = /^\s*(?:(?:\d{1,3}\s*-?\s*(?:savol|вопрос))|(?:savol|question|вопрос)\s*(?:№\s*)?\d{1,3})\s*[.):\-]?\s*/i;
  const LIST_PREFIX_RE = /^\s*(?:№\s*)?\d{1,4}\s*(?:[.)\-:]\s*|\s+)(?=\p{L})/u;
  const OPTION_RE = /^\s*[A-Fa-fА-Еа-е]\s*[).]\s+/;

  function readArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error("read error"));
      r.readAsArrayBuffer(file);
    });
  }

  function readText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error("read error"));
      r.readAsText(file, "utf-8");
    });
  }

  function ext(file) {
    const m = /\.([a-z0-9]+)$/i.exec(file.name || "");
    return m ? m[1].toLowerCase() : "";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function normText(s) {
    return String(s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  }

  async function docxToHtml(file) {
    if (!window.mammoth) throw new Error("mammoth not loaded");
    const buf = await readArrayBuffer(file);
    const res = await window.mammoth.convertToHtml({ arrayBuffer: buf });
    return res.value || "";
  }

  // Flatten the document body into blocks; list items become separate blocks.
  function htmlToBlocks(html) {
    const doc = new DOMParser().parseFromString("<div id='root'>" + html + "</div>", "text/html");
    const root = doc.getElementById("root");
    const blocks = [];
    for (const el of Array.from(root.children)) {
      const tag = el.tagName.toLowerCase();
      if (tag === "ol" || tag === "ul") {
        for (const li of Array.from(el.children)) {
          if (li.tagName.toLowerCase() !== "li") continue;
          const text = normText(li.textContent);
          if (!text && !li.querySelector("img")) continue;
          blocks.push({ html: li.innerHTML, text, el: li, list: tag });
        }
      } else {
        const text = normText(el.textContent);
        if (!text && !el.querySelector("img")) continue;
        blocks.push({ html: el.outerHTML, text, el, list: null, tag });
      }
    }
    return blocks;
  }

  // Remove the leading "1." / "Savol 1:" marker from the first text node of an element.
  function stripLeadingNumber(el) {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue.trim()) continue;
      const before = node.nodeValue;
      let after = before.replace(WORD_NUM_RE, "");
      if (after === before) after = before.replace(NUM_RE, "");
      node.nodeValue = after;
      return;
    }
  }

  function isManualStart(text) {
    return NUM_RE.test(text) || WORD_NUM_RE.test(text);
  }

  // ---------- answers ----------
  // "Javob: ...", "To'g'ri javob - ...", "Answer: ...", "Ответ: ..."
  const ANSWER_RE = /^\s*(?:to['ʻ`’]?g['ʻ`’]?ri\s+javob|javob|correct\s+answer|answer|правильный\s+ответ|ответ)\s*[:\-–—]\s*/i;
  // "Javoblar:", "Javoblar kaliti", "Answer key", "Answers:", "Ответы:" (an answer key section)
  const KEY_HEAD_RE = /^\s*(?:to['ʻ`’]?g['ʻ`’]?ri\s+javoblar|javoblar(?:\s+kaliti)?|kalit(?:lar)?|answers?\s+key|answers|ключ(?:\s+ответов)?|ответы)\s*[:\-–—]?\s*/i;
  const KEY_PAIR_RE = /(\d{1,3})\s*[-.)\]:=–—]\s*([^,;]+?)(?=\s*[,;]|\s+\d{1,3}\s*[-.)\]:=–—]|\s*$)/g;
  const SEPARATOR_RE = /^\s*(?:\+{3,}|={3,})\s*$/;
  const MARK_RE = /^\s*[#*]\s*(?=\S)/; // "#B) HTML" or "*HTML" marks the correct option
  const LETTER_RE = /^\s*([A-Fa-fА-Еа-е])\s*[).]?\s*$/;

  function parseKeyLine(text, map) {
    let m;
    KEY_PAIR_RE.lastIndex = 0;
    while ((m = KEY_PAIR_RE.exec(text))) map[Number(m[1])] = normText(m[2]);
  }

  // "B" -> "B) HTML" when the question lists its options as "A) ... B) ..."
  function expandLetter(answer, qText) {
    const m = LETTER_RE.exec(answer || "");
    if (!m) return answer;
    const L = m[1];
    const re = new RegExp("(?:^|\\s)" + L + "\\s*[).]\\s*(.+?)(?=\\s+[A-Fa-fА-Еа-е]\\s*[).]\\s|$)", "i");
    const o = re.exec(qText);
    return o ? L.toUpperCase() + ") " + o[1].trim() : answer;
  }

  function finish(questions, keyMap) {
    return questions
      .map((q, i) => {
        let answer = q.answer || keyMap[q.num] || keyMap[i + 1] || "";
        answer = expandLetter(normText(answer), normText(q.text));
        const out = { html: q.html.trim(), text: normText(q.text) };
        if (answer) out.answer = answer;
        return out;
      })
      .filter(q => q.text || /<img/i.test(q.html));
  }

  // HEMIS-style tests: questions separated by "++++", options by "====", "#" marks the correct one.
  function groupPlusFormat(blocks) {
    const groups = [[]];
    for (const b of blocks) {
      if (/^\s*\+{3,}\s*$/.test(b.text)) groups.push([]);
      else if (!/^\s*={3,}\s*$/.test(b.text)) groups[groups.length - 1].push(b);
    }
    const qs = [];
    for (const g of groups) {
      if (!g.length) continue;
      const [first, ...opts] = g;
      stripLeadingNumber(first.el);
      const q = { html: first.list ? "<p>" + first.el.innerHTML + "</p>" : first.el.outerHTML, text: normText(first.el.textContent) };
      const letters = "ABCDEF";
      opts.forEach((o, k) => {
        let t = o.text;
        const marked = MARK_RE.test(t);
        t = t.replace(MARK_RE, "").replace(OPTION_RE, "");
        const label = (letters[k] || String(k + 1)) + ") " + t;
        q.html += "<p>" + escapeHtml(label) + "</p>";
        q.text += " " + label;
        if (marked && !q.answer) q.answer = label;
      });
      qs.push(q);
    }
    return finish(qs, {});
  }

  const endsWithQ = t => /[?？]\s*$/.test(t || "");
  // Questions without "?": question words and task verbs (English / Uzbek / Russian)
  const EN_Q_RE = /^\s*(?:what|who|whom|whose|when|where|why|how|which|is|are|was|were|do|does|did|can|could|should|would|will|has|have|had|name|list|describe|explain|define|compare|contrast|discuss|talk\s+about|tell|give|identify|state|mention|outline|summari[sz]e|analy[sz]e|characteri[sz]e|translate|choose|find|complete|fill\s+in|prove|justify|illustrate|comment\s+on|speak\s+about|write\s+about)\b/i;
  const UZ_Q_RE = /(?:^|\s)(?:nima|nimalar|nimaga|nimadan|nimani|nimaning|nega|nechun|qanday|qanaqa|qaysi|qaysilar|kim|kimlar|kimning|kimga|qachon|qayer|qayerda|qayerga|qayerdan|qancha|nechta|necha|nechanchi)(?=[\s,.!?:;]|$)/i;
  const UZ_TASK_RE = /(?:tushuntiring|tushuntirib\s+bering|izohlang|izohlab\s+bering|sanab\s+(?:bering|o['ʻ`’]?ting)|sanang|ayting|aytib\s+bering|yozing|keltiring|aniqlang|ta['ʻ`’]riflang|tavsiflang|ko['ʻ`’]rsating|toping|solishtiring|taqqoslang|tahlil\s+qiling|asoslang|tarjima\s+qiling|gapirib\s+bering|so['ʻ`’]zlab\s+bering|bayon\s+qiling|misol(?:lar)?\s+keltiring|farqini|vazifalarini)\b/i;
  const UZ_MI_RE = /\S+(?:mi|mu)\s*[.!]?\s*$/i; // "...to'g'rimi" without "?"
  const RU_Q_RE = /^\s*(?:что|кто|как|какой|какая|какое|какие|когда|где|куда|откуда|почему|зачем|сколько|чем|назовите|опишите|объясните|перечислите|дайте|расскажите|сравните|определите|охарактеризуйте|приведите)(?=[\s,]|$)/i;
  const isQuestionLike = t => !!t && (endsWithQ(t) || EN_Q_RE.test(t) || UZ_Q_RE.test(t) || UZ_TASK_RE.test(t) || RU_Q_RE.test(t) || (UZ_MI_RE.test(t) && t.split(/\s+/).length > 2));
  // a plain text line: not an option, not a marked option, not a list item / table / picture
  const isPlainLine = b => !!b.text && !b.list && b.tag !== "table" && !b.el.querySelector("img, table") &&
    !OPTION_RE.test(b.text) && !MARK_RE.test(b.text) && !ANSWER_RE.test(b.text) && !SEPARATOR_RE.test(b.text) &&
    !BULLET_RE.test(b.text); // "- Paris" under a question is an option, not the answer

  // ---------- question markers without a number ----------
  // "Savol: ...", "Q: ...", "Question - ...", "Вопрос: ..." (a word that always means "question")
  const Q_WORD_RE = /^\s*(?:savol|question|q|вопрос)\s*[:.)\-–—]\s*(?=\S)/i;
  // bullet characters typed at the start of the line ("*" is not here: it marks a correct option)
  const BULLET_RE = /^\s*[•●▪■◆►▶➤➢✓✔☑○◦‣∙·\-–—]\s+(?=\S)/;

  // the whole paragraph is bold
  function isBoldBlock(b) {
    if (!b.text || /^h[1-6]$/.test(b.tag || "")) return false;
    const bold = Array.from(b.el.querySelectorAll("strong, b")).map(x => x.textContent).join("");
    return normText(bold) === b.text;
  }

  // remove "Savol:" / "•" from the first text node so only the question itself is shown
  function stripMarker(el) {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue.trim()) continue;
      node.nodeValue = node.nodeValue.replace(Q_WORD_RE, "").replace(BULLET_RE, "");
      return;
    }
  }

  // Decide which marker (if any) flags the questions of an unnumbered file.
  // "Savol:"/"Q:" always does. Bullets, Word bullet lists and bold do only when the marked lines
  // look at least as much like questions as the other lines (otherwise they mark options/answers).
  function detectMarker(blocks) {
    if (blocks.filter(b => Q_WORD_RE.test(b.text)).length >= 1) return b => Q_WORD_RE.test(b.text);
    const ratio = list => (list.length ? list.filter(b => isQuestionLike(b.text.replace(BULLET_RE, ""))).length / list.length : 0);
    const candidates = [
      b => BULLET_RE.test(b.text) || b.list === "ul",
      isBoldBlock
    ];
    for (const test of candidates) {
      const marked = blocks.filter(test);
      const other = blocks.filter(b => !test(b) && b.text && !/^h[1-6]$/.test(b.tag || ""));
      if (marked.length >= 2 && (!other.length || ratio(marked) >= ratio(other))) return test;
    }
    return null;
  }

  function groupQuestions(blocks) {
    if (blocks.filter(b => /^\s*\+{3,}\s*$/.test(b.text)).length >= 1 && blocks.some(b => /^\s*={3,}\s*$/.test(b.text))) {
      return groupPlusFormat(blocks);
    }
    // Manually typed numbers ("1.", "2)") win over Word's auto-numbered lists,
    // because then auto lists are usually answer options.
    const manual = blocks.some(b => b.list !== "ol" && isManualStart(b.text) && !KEY_HEAD_RE.test(b.text));
    const hasOl = blocks.some(b => b.list === "ol");
    // Unnumbered "question? / answer" pairs: a line ending with "?" followed by a plain line.
    let qaMode = false;
    const isMarker = !manual && !hasOl ? detectMarker(blocks) : null;
    if (!manual && !hasOl && !isMarker) {
      const qCount = blocks.filter(b => isQuestionLike(b.text)).length;
      let pairs = 0;
      blocks.forEach((b, i) => { if (isQuestionLike(b.text) && blocks[i + 1] && !isQuestionLike(blocks[i + 1].text) && isPlainLine(blocks[i + 1])) pairs++; });
      qaMode = qCount > 0 && pairs >= Math.max(1, Math.ceil(qCount * 0.6));
    }
    const questions = [];
    const keyMap = {};
    let cur = null, keyMode = false;

    const push = () => { if (cur) questions.push(cur); cur = null; };
    const blockHtml = b => (b.list ? "<p>" + b.el.innerHTML + "</p>" : b.el.outerHTML);
    const addAnswer = text => { if (cur) cur.answer = cur.answer ? cur.answer + " " + text : text; };

    for (const b of blocks) {
      if (keyMode) { parseKeyLine(b.text, keyMap); continue; }
      const key = KEY_HEAD_RE.exec(b.text);
      if (key && !ANSWER_RE.test(b.text)) {
        push();
        keyMode = true;
        parseKeyLine(b.text.slice(key[0].length), keyMap);
        continue;
      }
      if (SEPARATOR_RE.test(b.text)) continue;
      const ans = ANSWER_RE.exec(b.text);
      if (ans) { addAnswer(normText(b.text.slice(ans[0].length))); continue; } // never shown inside the question

      let start;
      if (manual) start = isManualStart(b.text) || (b.list === "ol" && (!cur || !!cur.answer || isQuestionLike(b.text)));
      else if (hasOl) start = b.list === "ol";
      else if (isMarker) start = isMarker(b);
      else if (qaMode) start = isQuestionLike(b.text);
      else start = !(/^h[1-6]$/.test(b.tag || "") && blocks.length > 1) &&
        !(cur && (OPTION_RE.test(b.text) || MARK_RE.test(b.text) || BULLET_RE.test(b.text) || b.list === "ul"));

      // "Question?" followed by a plain line (no "Javob:" prefix, no options): that line is the answer
      if (!start && cur && cur.asksQ && !cur.hasOptions && isPlainLine(b)) {
        addAnswer(normText(b.text));
        continue;
      }
      if (!start && (qaMode || isMarker) && !cur) continue; // title lines before the first question

      if (start) {
        push();
        const num = (/\d{1,3}/.exec(b.text) || [])[0];
        if (manual) stripLeadingNumber(b.el);
        if (isMarker) stripMarker(b.el);
        cur = { html: blockHtml(b), text: normText(b.el.textContent), num: manual && num ? Number(num) : undefined };
        const numbered = (manual && isManualStart(b.text)) || b.list === "ol";
        cur.asksQ = !cur.answer && (((numbered || !!isMarker) && !/[:：]\s*$/.test(cur.text)) || isQuestionLike(cur.text));
      } else if (cur) {
        if (MARK_RE.test(b.text)) {
          // a correct option marked with "#" / "*": show it without the marker, remember it as the answer
          const walker = b.el.ownerDocument.createTreeWalker(b.el, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) { if (node.nodeValue.trim()) { node.nodeValue = node.nodeValue.replace(MARK_RE, ""); break; } }
          if (!cur.answer) cur.answer = normText(b.el.textContent);
        }
        cur.hasOptions = true; // options / extra content follow, so later lines are not a bare answer
        cur.html += blockHtml(b);
        cur.text += " " + normText(b.el.textContent);
      }
      // text before the first numbered question (title, instructions) is skipped
    }
    push();
    return finish(questions, keyMap);
  }

  function textToQuestions(text) {
    const lines = String(text).split(/\r?\n/);
    const html = lines.map(l => l.trim()).filter(Boolean).map(l => "<p>" + escapeHtml(l) + "</p>").join("");
    return groupQuestions(htmlToBlocks(html));
  }

  // ---------- PDF ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("cannot load " + src));
      document.head.appendChild(s);
    });
  }

  // pdf.js is large, so it is loaded only when a PDF is actually opened.
  async function getPdfjs() {
    if (!window.pdfjsLib) await loadScript("vendor/pdf.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
    return window.pdfjsLib;
  }

  // Rebuild paragraphs from positioned text: a new paragraph starts after a
  // larger vertical gap, or when a line starts with a question number / answer option.
  async function pdfToParagraphs(file) {
    const pdfjs = await getPdfjs();
    const pdf = await pdfjs.getDocument({ data: await readArrayBuffer(file) }).promise;
    const paras = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const lines = [];
      for (const it of content.items) {
        if (!it.str) continue;
        const y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
        let line = lines.find(l => Math.abs(l.y - y) < h * 0.5);
        if (!line) { line = { y, h, parts: [] }; lines.push(line); }
        line.parts.push({ x: it.transform[4], str: it.str, end: it.transform[4] + (it.width || 0) });
      }
      lines.sort((a, b) => b.y - a.y);
      // right edge of the text block: a line ending well before it was ended on purpose (end of paragraph)
      const pageWidth = page.view ? page.view[2] - page.view[0] : 595;
      const rightEdge = Math.max(pageWidth * 0.7, ...lines.map(l => Math.max(...l.parts.map(p => p.end))));
      let prev = null;
      for (const l of lines) {
        const text = normText(l.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(" ").replace(/\s+/g, " "));
        if (!text || /^\d{1,4}$/.test(text) && (l === lines[lines.length - 1] || l === lines[0])) { continue; } // page numbers
        const gap = prev ? prev.y - l.y : Infinity;
        const prevShort = prev && prev.page === n && prev.end < rightEdge * 0.8;
        const startsNew = !paras.length || gap > l.h * 1.9 || isManualStart(text) || OPTION_RE.test(text) || n !== prev.page || prevShort ||
          /[?？]\s*$/.test(paras[paras.length - 1]) || ANSWER_RE.test(text); // "Question?" then its answer on the next line
        if (startsNew) paras.push(text);
        else paras[paras.length - 1] += " " + text;
        prev = { y: l.y, page: n, end: Math.max(...l.parts.map(p => p.end)) };
      }
    }
    return paras;
  }

  // ---------- Excel ----------
  const Q_HEADER_RE = /(savol|question|вопрос|topshiriq|task|matn|text)/i;
  const OPT_HEADER_RE = /^\s*(variant|option|вариант)?\s*[A-Fa-fА-Еа-е]\s*\)?\s*$|variant|option|вариант/i;
  const ANSWER_HEADER_RE = /(to['ʻ`’]?g['ʻ`’]?ri|correct|answer|javob\s*kaliti|key|правильн|ответ)/i;

  function rowsToQuestions(rows) {
    rows = rows.map(r => (Array.isArray(r) ? r : [r]).map(c => normText(c)));
    rows = rows.filter(r => r.some(Boolean));
    if (!rows.length) return [];
    let qCol = -1, optCols = [], ansCol = -1, start = 0;
    for (let i = 0; i < Math.min(rows.length, 10) && qCol < 0; i++) {
      const r = rows[i];
      if (r.filter(Boolean).length < 2) continue; // a title line, not a table header
      const idx = r.findIndex(c => c && c.length < 40 && Q_HEADER_RE.test(c) && !ANSWER_HEADER_RE.test(c));
      if (idx >= 0) {
        qCol = idx; start = i + 1;
        // answer options are shown, the correct-answer column is never shown to students
        optCols = r.map((c, j) => j).filter(j => j !== qCol && r[j] && OPT_HEADER_RE.test(r[j]) && !ANSWER_HEADER_RE.test(r[j]));
        ansCol = r.findIndex((c, j) => j !== qCol && c && c.length < 40 && ANSWER_HEADER_RE.test(c));
      }
    }
    if (qCol < 0) {
      // no header: the column with the most text holds the questions
      const width = Math.max(...rows.map(r => r.length));
      let best = -1;
      for (let c = 0; c < width; c++) {
        const len = rows.reduce((a, r) => a + (/\p{L}/u.test(r[c] || "") ? (r[c] || "").length : 0), 0);
        if (len > best) { best = len; qCol = c; }
      }
    }
    const out = [];
    for (const r of rows.slice(start)) {
      const q = (r[qCol] || "").replace(WORD_NUM_RE, "").replace(NUM_RE, "").trim();
      if (!q) continue;
      let html = "<p>" + escapeHtml(q) + "</p>";
      const opts = optCols.filter(j => r[j]).map(j => {
        const label = rows[start - 1][j].trim();
        const short = /^[A-Za-zА-Яа-я]$/.test(label) ? label + ") " : "";
        return "<p>" + escapeHtml(short + r[j]) + "</p>";
      });
      html += opts.join("");
      const item = { html, text: normText([q].concat(optCols.map(j => r[j] || "")).join(" ")) };
      let answer = ansCol >= 0 ? (r[ansCol] || "").trim() : "";
      const lm = LETTER_RE.exec(answer);
      if (lm) {
        // "B" -> the text of option column "B"
        const j = optCols.find(c => rows[start - 1][c].trim().toUpperCase().endsWith(lm[1].toUpperCase()));
        if (j !== undefined && r[j]) answer = lm[1].toUpperCase() + ") " + r[j];
      }
      if (answer) item.answer = answer;
      out.push(item);
    }
    return out;
  }

  async function excelToQuestions(file) {
    if (!window.XLSX) throw new Error("xlsx not loaded");
    const wb = window.XLSX.read(await readArrayBuffer(file), { type: "array" });
    for (const name of wb.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false });
      const qs = rowsToQuestions(rows);
      if (qs.length) return qs;
    }
    return [];
  }

  async function parseQuestions(file) {
    const e = ext(file);
    if (e === "docx") return groupQuestions(htmlToBlocks(await docxToHtml(file)));
    if (e === "txt") return textToQuestions(await readText(file));
    if (e === "pdf") {
      const html = (await pdfToParagraphs(file)).map(p => "<p>" + escapeHtml(p) + "</p>").join("");
      return groupQuestions(htmlToBlocks(html));
    }
    if (["xlsx", "xls", "csv", "ods"].includes(e)) return excelToQuestions(file);
    throw new Error("unsupported");
  }

  // ---------- Students ----------
  const HEADER_RE = /(f\.?\s?i\.?\s?(sh|o)\b|\bfio\b|\bism|familiya|sharif|\bname\b|full\s*name|surname|talaba|student|o['ʻ`’]?quvchi|ф\.?\s?и\.?\s?о|имя|фамилия|студент)/i;
  const NOT_NAME_RE = /(guruh|group|fakultet|faculty|telefon|phone|\bid\b|baho|grade|kurs|course|yo['ʻ`’]?nalish|kafedra|email|manzil|address|tug['ʻ`’]?ilgan|birth)/i;

  const HEADER_ONLY_RE = /^(№|#)?\s*(f\.?\s?i\.?\s?(sh|o)\.?|fio|ism(i)?|familiya(si)?(,?\s*ism(i)?)?(,?\s*sharif(i)?)?|(full\s*)?name|talaba(lar)?|student(s)?|o['ʻ`’]?quvchi(lar)?|ро['ʻ`’]?yxat|ro['ʻ`’]?yxat|list)\s*:?$/i;

  function looksLikeName(v) {
    const s = normText(v);
    if (s.length < 2 || s.length > 80) return false;
    if (!/\p{L}/u.test(s)) return false;
    if (/^[\d\s.,:;/\-+()]+$/.test(s)) return false;
    return true;
  }

  function extractNames(rows) {
    rows = rows.map(r => (Array.isArray(r) ? r : [r]).map(c => normText(c)));
    rows = rows.filter(r => r.some(Boolean));
    if (!rows.length) return [];

    // 1) header row with name columns
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = rows[i];
      const cols = [];
      r.forEach((c, idx) => { if (c && HEADER_RE.test(c) && !NOT_NAME_RE.test(c) && c.length < 40) cols.push(idx); });
      if (cols.length) {
        let use = cols;
        const full = cols.filter(idx => /f\.?\s?i\.?\s?(sh|o)|fio|full|to['ʻ`’]?liq|ф\.?\s?и\.?\s?о/i.test(r[idx]));
        if (full.length) use = [full[0]];
        const names = [];
        for (const row of rows.slice(i + 1)) {
          const name = normText(use.map(idx => row[idx] || "").join(" ")).replace(LIST_PREFIX_RE, "");
          if (looksLikeName(name)) names.push(name);
        }
        if (names.length) return names;
      }
    }

    // 2) no header: pick the column with the most name-like values
    const width = Math.max(...rows.map(r => r.length));
    let best = 0, bestScore = -1;
    for (let c = 0; c < width; c++) {
      let score = 0;
      for (const r of rows) {
        const v = r[c] || "";
        if (looksLikeName(v)) score += 1 + Math.min(v.split(" ").length, 3) * 0.1;
      }
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return rows
      .map(r => normText(r[best] || "").replace(LIST_PREFIX_RE, ""))
      .filter(v => looksLikeName(v) && !HEADER_ONLY_RE.test(v));
  }

  async function parseStudents(file) {
    const e = ext(file);
    let rows = [];
    if (["xlsx", "xls", "csv", "ods"].includes(e)) {
      if (!window.XLSX) throw new Error("xlsx not loaded");
      const buf = await readArrayBuffer(file);
      const wb = window.XLSX.read(buf, { type: "array" });
      for (const name of wb.SheetNames) {
        const sheetRows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: false });
        const names = extractNames(sheetRows);
        if (names.length) return names;
      }
      return [];
    } else if (e === "docx") {
      const html = await docxToHtml(file);
      const doc = new DOMParser().parseFromString(html, "text/html");
      const tables = Array.from(doc.querySelectorAll("table"));
      if (tables.length) {
        for (const t of tables) {
          rows = Array.from(t.querySelectorAll("tr")).map(tr => Array.from(tr.children).map(td => td.textContent));
          const names = extractNames(rows);
          if (names.length) return names;
        }
      }
      rows = Array.from(doc.querySelectorAll("body > p, li")).map(el => [el.textContent]);
    } else if (e === "txt") {
      rows = (await readText(file)).split(/\r?\n/).map(l => l.includes("\t") ? l.split("\t") : [l]);
    } else {
      throw new Error("unsupported");
    }
    return extractNames(rows);
  }

  window.Parsers = { parseQuestions, parseStudents, escapeHtml, _extractNames: extractNames, _groupQuestions: groupQuestions, _htmlToBlocks: htmlToBlocks };
})();
