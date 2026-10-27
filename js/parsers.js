// File parsers: questions (Word / txt) and student lists (Excel / CSV / Word / txt).
(function () {
  "use strict";

  // "1. ...", "1) ...", "№1 ...", "1-savol ...", "Savol 1: ...", "Question 1. ..."
  const NUM_RE = /^\s*(?:№\s*)?\d{1,3}\s*(?:[.)\]:]|-(?!\d))\s*(?=\S)/;
  const WORD_NUM_RE = /^\s*(?:(?:\d{1,3}\s*-?\s*(?:savol|вопрос))|(?:savol|question|вопрос)\s*(?:№\s*)?\d{1,3})\s*[.):\-]?\s*/i;
  const LIST_PREFIX_RE = /^\s*(?:№\s*)?\d{1,4}\s*[.)\-:]?\s+/;

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

  function groupQuestions(blocks) {
    // Manually typed numbers ("1.", "2)") win over Word's auto-numbered lists,
    // because then auto lists are usually answer options.
    const manual = blocks.some(b => b.list !== "ol" && isManualStart(b.text));
    const hasOl = blocks.some(b => b.list === "ol");
    const questions = [];
    let cur = null;

    const push = () => { if (cur) questions.push(cur); };

    if (manual || hasOl) {
      for (const b of blocks) {
        const start = manual ? isManualStart(b.text) : b.list === "ol";
        if (start) {
          push();
          if (manual) stripLeadingNumber(b.el);
          const html = b.list ? "<p>" + b.el.innerHTML + "</p>" : b.el.outerHTML;
          cur = { html, text: normText(b.el.textContent) };
        } else if (cur) {
          const html = b.list ? "<p>" + b.el.innerHTML + "</p>" : b.el.outerHTML;
          cur.html += html;
          cur.text += " " + b.text;
        }
        // text before the first numbered question (title, instructions) is skipped
      }
      push();
    } else {
      for (const b of blocks) {
        if (/^h[1-6]$/.test(b.tag || "") && blocks.length > 1) continue; // titles
        questions.push({ html: b.list ? "<p>" + b.el.innerHTML + "</p>" : b.el.outerHTML, text: b.text });
      }
    }
    return questions
      .map(q => ({ html: q.html.trim(), text: normText(q.text) }))
      .filter(q => q.text || /<img/i.test(q.html));
  }

  function textToQuestions(text) {
    const lines = String(text).split(/\r?\n/);
    const html = lines.map(l => l.trim()).filter(Boolean).map(l => "<p>" + escapeHtml(l) + "</p>").join("");
    return groupQuestions(htmlToBlocks(html));
  }

  async function parseQuestions(file) {
    const e = ext(file);
    if (e === "docx") return groupQuestions(htmlToBlocks(await docxToHtml(file)));
    if (e === "txt") return textToQuestions(await readText(file));
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
