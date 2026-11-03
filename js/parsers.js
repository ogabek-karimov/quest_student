// File parsers: questions (Word / txt) and student lists (Excel / CSV / Word / txt).
(function () {
  "use strict";

  // "1. ...", "1) ...", "№1 ...", "1-savol ...", "Savol 1: ...", "Question 1. ..."
  const NUM_RE = /^\s*(?:№\s*)?\d{1,3}\s*(?:[.)\]:]|-(?!\d))\s*(?=\S)/;
  const WORD_NUM_RE = /^\s*(?:(?:\d{1,3}\s*-?\s*(?:savol|вопрос))|(?:savol|question|вопрос)\s*(?:№\s*)?\d{1,3})\s*[.):\-]?\s*/i;
  const LIST_PREFIX_RE = /^\s*(?:№\s*)?\d{1,4}\s*[.)\-:]?\s+/;
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

  function groupQuestions(blocks) {
    if (blocks.filter(b => /^\s*\+{3,}\s*$/.test(b.text)).length >= 1 && blocks.some(b => /^\s*={3,}\s*$/.test(b.text))) {
      return groupPlusFormat(blocks);
    }
    // Manually typed numbers ("1.", "2)") win over Word's auto-numbered lists,
    // because then auto lists are usually answer options.
    const manual = blocks.some(b => b.list !== "ol" && isManualStart(b.text) && !KEY_HEAD_RE.test(b.text));
    const hasOl = blocks.some(b => b.list === "ol");
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
      if (manual || hasOl) start = manual ? isManualStart(b.text) : b.list === "ol";
      else start = !(/^h[1-6]$/.test(b.tag || "") && blocks.length > 1) && !(cur && (OPTION_RE.test(b.text) || MARK_RE.test(b.text)));

      if (start) {
        push();
        const num = (/\d{1,3}/.exec(b.text) || [])[0];
        if (manual) stripLeadingNumber(b.el);
        cur = { html: blockHtml(b), text: normText(b.el.textContent), num: manual && num ? Number(num) : undefined };
      } else if (cur) {
        if (MARK_RE.test(b.text)) {
          // a correct option marked with "#" / "*": show it without the marker, remember it as the answer
          const walker = b.el.ownerDocument.createTreeWalker(b.el, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) { if (node.nodeValue.trim()) { node.nodeValue = node.nodeValue.replace(MARK_RE, ""); break; } }
          if (!cur.answer) cur.answer = normText(b.el.textContent);
        }
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
        line.parts.push({ x: it.transform[4], str: it.str });
      }
      lines.sort((a, b) => b.y - a.y);
      let prev = null;
      for (const l of lines) {
        const text = normText(l.parts.sort((a, b) => a.x - b.x).map(p => p.str).join(" ").replace(/\s+/g, " "));
        if (!text || /^\d{1,4}$/.test(text) && (l === lines[lines.length - 1] || l === lines[0])) { continue; } // page numbers
        const gap = prev ? prev.y - l.y : Infinity;
        const startsNew = !paras.length || gap > l.h * 1.9 || isManualStart(text) || OPTION_RE.test(text) || n !== prev.page;
        if (startsNew) paras.push(text);
        else paras[paras.length - 1] += " " + text;
        prev = { y: l.y, page: n };
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
          const name = normText(use.map(idx => row[idx] || "").join(" "));
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
