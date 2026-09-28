/* COMA Study Pack — single-page app driven by data/coma.json (via data/data.js) */
(function () {
  'use strict';

  var D = null;               // the whole study pack
  var chapters = [];          // flat list of {chapter_id, title, title_bn, unit, index}
  var chapterById = {};
  var notesById = {};
  var items = [];             // every syllabus practice item (all question types)
  var extItems = [];          // optional items beyond the COMA syllabus
  var itemById = {};
  var mocks = [];             // [{id, title, group, t, list:[{it, key}]}]
  var mockById = {};
  var app = document.getElementById('app');
  var PER_PAGE = 10;
  var cleanups = [];          // run when leaving a page (timers, key handlers)

  // question types, in display order
  var TYPES = {
    mcq:    { label: 'MCQ',                 icon: '◉',  desc: 'Standard four-option questions' },
    output: { label: 'Code output',         icon: '⌨',  desc: 'Predict what the Python code prints' },
    'case': { label: 'Case-based',          icon: '📋', desc: 'Short real-life situations' },
    ar:     { label: 'Assertion–Reason',    icon: '⚖',  desc: 'Assertion (A) and Reason (R) — a board favourite' },
    mm:     { label: 'Column match (OMR)',  icon: '⇄',  desc: 'Match columns, pick the right code — board style' },
    tf:     { label: 'True / False',        icon: '✓✗', desc: 'Quick-fire সত্য / মিথ্যা' },
    fb:     { label: 'Fill in the blanks',  icon: '✎',  desc: 'Type the missing word' },
    mt:     { label: 'Match the following', icon: '⇆',  desc: 'Pair up the two columns yourself' },
    ext:    { label: 'Beyond syllabus',     icon: '＋', desc: 'Tuple, dictionary, lambda, recursion, exceptions' }
  };
  var KINDS = ['mcq', 'output', 'case', 'ar', 'mm', 'tf', 'fb', 'mt'];

  // ---------- storage ----------
  // localStorage with an in-memory fallback, so the site still works when storage is blocked
  // (private windows, some file:// setups) — progress just won't survive a reload there.
  var mem = {};
  var store = {
    get: function (k, f) {
      try { var v = localStorage.getItem(k); if (v) return JSON.parse(v); } catch (e) {}
      return k in mem ? JSON.parse(mem[k]) : f;
    },
    set: function (k, v) {
      mem[k] = JSON.stringify(v);
      try { localStorage.setItem(k, mem[k]); } catch (e) {}
    },
    del: function (k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) {} }
  };
  var K = {
    progress: 'coma-progress', bookmarks: 'coma-bookmarks', read: 'coma-read', sa: 'coma-sa-self',
    mockHist: 'coma-mock-history', mockRun: 'coma-mock-run-', activity: 'coma-activity',
    quiz: 'coma-quiz', quizHist: 'coma-quiz-history', builder: 'coma-builder-v2', hideCode: 'coma-hide-code',
    srs: 'coma-srs', goal: 'coma-goal', examDate: 'coma-exam-date'
  };
  var progress = store.get(K.progress, {});     // { itemId: lastResponse } (letter, 'T'/'F', text or array)
  var bookmarks = store.get(K.bookmarks, {});   // { itemId: 1 }
  var readCh = store.get(K.read, {});           // { chapterId: 1 }
  var saSelf = store.get(K.sa, {});             // { shortId: 'know' | 'review' }
  var mockHist = store.get(K.mockHist, {});     // { mockId: [{score,total,secs,date}] }
  var activity = store.get(K.activity, {});     // { 'YYYY-MM-DD': answersCount }
  var srs = store.get(K.srs, {});               // spaced repetition: { itemId: { b: box 0-4, t: lastAnsweredMs } }
  var BOX_DAYS = [0, 1, 3, 7, 16];              // wrong -> box 0 (due now); each correct answer moves it up a box
  var DAY = 86400000;

  // migrate best scores saved by the first version of the site
  (function () {
    var old = store.get('coma-mock-best', null);
    if (!old) return;
    Object.keys(old).forEach(function (id) {
      if (!mockHist[id]) mockHist[id] = [{ score: old[id].score, total: old[id].total, date: old[id].date, secs: null }];
    });
    store.set(K.mockHist, mockHist);
    store.del('coma-mock-best');
  })();

  // ---------- utils ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function unitClass(unit) { return /python/i.test(unit || '') ? 'py' : 'ec'; }
  function unitShort(unit) { return /python/i.test(unit || '') ? 'Python' : 'E-Commerce'; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function today() { return dateKey(new Date()); }
  function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(r).padStart(2, '0');
  }
  function toast(msg) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var qs = {};
    var qi = h.indexOf('?');
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach(function (p) {
        var kv = p.split('=');
        if (kv[0]) qs[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
      h = h.slice(0, qi);
    }
    return { parts: h.split('/').filter(Boolean).map(decodeURIComponent), qs: qs };
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  // escape text and wrap each search term in <mark>, without breaking HTML entities
  function markTerms(text, terms) {
    var words = terms.filter(Boolean).map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    if (!words.length) return esc(text);
    var re = new RegExp('(' + words.join('|') + ')', 'gi');
    return String(text).split(re).map(function (part, i) { return i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part); }).join('');
  }
  function ring(pct, label, size) {
    size = size || 110;
    var r = 42, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct || 0));
    var txt = p > 0 && p < 1 ? '<1%' : Math.round(p) + '%';
    return '<div class="ring" style="width:' + size + 'px;height:' + size + 'px">' +
      '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="' + r + '" class="ring-bg"/>' +
      (p > 0 ? '<circle cx="50" cy="50" r="' + r + '" class="ring-fg" stroke-dasharray="' + (c * p / 100) + ' ' + c + '"/>' : '') + '</svg>' +
      '<div class="ring-label"><b>' + esc(txt) + '</b><span>' + esc(label || '') + '</span></div></div>';
  }
  function bar(pct) { return '<div class="progress"><span style="width:' + Math.max(0, Math.min(100, pct || 0)) + '%"></span></div>'; }
  function accTag(s) { return '<span class="tag ' + (s.acc >= 70 ? 'easy' : s.acc >= 40 ? 'medium' : 'hard') + '">' + s.acc + '%</span>'; }
  function onLeave(fn) { cleanups.push(fn); }
  function quizAttr(opts) { return ' data-quiz="' + esc(JSON.stringify(opts)) + '"'; }

  // ---------- items: answers & correctness ----------
  function hasResp(v) { return v != null && v !== ''; }
  function optMap(it) { return it.fmt === 'tf' ? { T: 'সত্য (True)', F: 'মিথ্যা (False)' } : it.options; }
  function correctKey(it, key) { return key || (it.fmt === 'tf' ? (it.answer ? 'T' : 'F') : it.answer); }
  function mtMap(it) {
    var m = {};
    (it.answer_pairs || []).forEach(function (p) { m[p.a] = p.b; });
    return m;
  }
  function norm(s) {
    return String(s).toLowerCase().replace(/[“”"'`‘’]/g, '').replace(/\(\s*\)/g, '')
      .replace(/[\s.।,;:!]+$/, '').replace(/\s+/g, '');
  }
  function fbMatch(it, resp) {
    var r = norm(resp);
    if (!r) return false;
    var alts = [String(it.answer)].concat(String(it.answer).split(/\s*\/\s*|\s+or\s+/i));
    return alts.some(function (a) { var n = norm(a); return n && n === r; });
  }
  function isCorrect(it, resp, key) {
    if (!hasResp(resp)) return false;
    if (it.fmt === 'fb') return fbMatch(it, resp);
    if (it.fmt === 'mt') {
      if (!Array.isArray(resp)) return false;
      var c = mtMap(it);
      return it.column_a.every(function (a, i) { return resp[i] === c[a]; });
    }
    return resp === correctKey(it, key);
  }
  function chTitle(it) {
    return it.chapter_id && chapterById[it.chapter_id] ? chapterById[it.chapter_id].title : 'Beyond syllabus · ' + (it.topic || '');
  }

  // ---------- progress helpers ----------
  function itemsFor(chId) {
    if (chId === 'ext') return extItems;
    return chId && chId !== 'all' ? items.filter(function (q) { return q.chapter_id === chId; }) : items;
  }
  function stats(list) {
    var done = 0, right = 0;
    list.forEach(function (q) {
      if (hasResp(progress[q.id])) { done++; if (isCorrect(q, progress[q.id])) right++; }
    });
    return { done: done, right: right, wrong: done - right, total: list.length, acc: done ? Math.round(right / done * 100) : 0 };
  }
  function recordAnswer(it, resp, key) {
    progress[it.id] = resp;
    store.set(K.progress, progress);
    var d = today();
    activity[d] = (activity[d] || 0) + 1;
    store.set(K.activity, activity);
    setSrs(it.id, isCorrect(it, resp, key));
  }
  function setSrs(id, correct) {
    var s = srs[id];
    srs[id] = { b: correct ? (s ? Math.min(4, s.b + 1) : 1) : 0, t: Date.now() };
    store.set(K.srs, srs);
  }
  // due for review: answered wrong, or answered right long enough ago for its box
  function isDue(it) {
    var s = srs[it.id];
    if (!s) return isWrong(it);      // answered before spaced repetition existed
    return Date.now() - s.t >= BOX_DAYS[s.b] * DAY;
  }
  function dueItems() {
    return items.filter(function (q) { return hasResp(progress[q.id]) && isDue(q); })
      .sort(function (a, b) { var x = srs[a.id] || { b: 0, t: 0 }, y = srs[b.id] || { b: 0, t: 0 }; return x.b - y.b || x.t - y.t; });
  }
  // Smart review: due reviews first, then new questions from the weakest chapters, in the exam's 25:10 unit ratio
  function smartPick(n) {
    var due = dueItems();
    var pick = due.slice(0, Math.max(Math.ceil(n * 0.6), n - items.filter(function (q) { return !hasResp(progress[q.id]); }).length));
    var fresh = items.filter(function (q) { return !hasResp(progress[q.id]); });
    var byCh = {};
    fresh.forEach(function (q) { (byCh[q.chapter_id] = byCh[q.chapter_id] || []).push(q); });
    var order = Object.keys(byCh).map(function (id) {
      var s = stats(itemsFor(id));
      return { id: id, score: (s.done >= 3 ? s.acc : 55) + Math.random() * 15, py: unitClass(chapterById[id].unit) === 'py' };
    }).sort(function (a, b) { return a.score - b.score; });
    Object.keys(byCh).forEach(function (id) { byCh[id] = shuffle(byCh[id]); });
    var pyLeft = Math.round((n - pick.length) * 25 / 35), ecLeft = n - pick.length - pyLeft;
    for (var guard = 0; pick.length < n && guard < 400; guard++) {
      var took = false;
      for (var i = 0; i < order.length && pick.length < n; i++) {
        var o = order[i], list = byCh[o.id];
        if (!list.length || (o.py ? pyLeft : ecLeft) <= 0) continue;
        pick.push(list.pop()); took = true;
        if (o.py) pyLeft--; else ecLeft--;
      }
      if (!took) {
        if (!order.some(function (o) { return byCh[o.id].length; })) break;
        pyLeft = ecLeft = n;   // one unit ran out of new questions: let the other fill the rest
      }
    }
    // still short (everything attempted): add the questions reviewed longest ago
    if (pick.length < n) {
      var inPick = {}; pick.forEach(function (q) { inPick[q.id] = 1; });
      items.filter(function (q) { return !inPick[q.id]; })
        .sort(function (a, b) { return ((srs[a.id] || {}).t || 0) - ((srs[b.id] || {}).t || 0); })
        .slice(0, n - pick.length).forEach(function (q) { pick.push(q); });
    }
    return shuffle(pick).map(function (q) { return q.id; });
  }
  function answeredToday() { return activity[today()] || 0; }
  function dailyGoal() { return store.get(K.goal, 30); }
  function daysToExam() {
    var d = store.get(K.examDate, '');
    if (!d) return null;
    var t = new Date(d + 'T00:00:00'), now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((t - now) / DAY);
  }
  function streakDays() {
    var d = new Date(), n = 0;
    if (!activity[dateKey(d)]) d.setDate(d.getDate() - 1);   // today not started yet: count up to yesterday
    while (activity[dateKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function isWrong(it) { return hasResp(progress[it.id]) && !isCorrect(it, progress[it.id]); }
  function wrongCount() { return items.concat(extItems).filter(isWrong).length; }
  function bookmarkCount() { return items.concat(extItems).filter(function (q) { return bookmarks[q.id]; }).length; }
  function weakChapters(limit) {
    return chapters.map(function (c) { return { ch: c, s: stats(itemsFor(c.chapter_id)) }; })
      .filter(function (x) { return x.s.done >= 3; })
      .sort(function (a, b) { return a.s.acc - b.s.acc; })
      .slice(0, limit || 3);
  }

  // ---------- Python syntax highlighting ----------
  var PY_KW = 'False|None|True|and|as|assert|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield';
  var PY_RE = new RegExp(
    '(#[^\\n]*)' +
    '|(\'\'\'[\\s\\S]*?\'\'\'|"""[\\s\\S]*?"""|\'(?:\\\\.|[^\'\\\\\\n])*\'|"(?:\\\\.|[^"\\\\\\n])*")' +
    '|\\b(\\d+(?:\\.\\d+)?j?)\\b' +
    '|\\b(' + PY_KW + ')\\b' +
    '|\\b([A-Za-z_]\\w*)(?=\\()', 'g');
  function highlight(code) {
    var out = '', last = 0, m;
    PY_RE.lastIndex = 0;
    while ((m = PY_RE.exec(code))) {
      out += esc(code.slice(last, m.index));
      var cls = m[1] ? 'com' : m[2] ? 'str' : m[3] ? 'num' : m[4] ? 'kw' : 'fn';
      out += '<span class="tok-' + cls + '">' + esc(m[0]) + '</span>';
      last = PY_RE.lastIndex;
      if (m[0].length === 0) PY_RE.lastIndex++;
    }
    return out + esc(code.slice(last));
  }
  function codeBlock(code, label) {
    return '<div class="code-block">' +
      (label ? '<div class="code-label">' + esc(label) + '</div>' : '') +
      '<button class="copy" data-copy="' + esc(code) + '">Copy</button>' +
      '<pre><code>' + highlight(code) + '</code></pre></div>';
  }

  // ---------- init ----------
  function init(data) {
    D = data;
    var i = 0;
    (D.syllabus || []).forEach(function (u) {
      (u.chapters || []).forEach(function (c) {
        var ch = { chapter_id: c.chapter_id, title: c.title, unit: u.unit, index: ++i };
        chapters.push(ch);
        chapterById[c.chapter_id] = ch;
      });
    });
    (D.study_notes || []).forEach(function (n) {
      notesById[n.chapter_id] = n;
      if (chapterById[n.chapter_id]) chapterById[n.chapter_id].title_bn = n.title_bn;
    });

    // one flat list of practice items; kind = question type, fmt = how it is answered
    var qb = D.question_bank || {};
    function add(list, fmt, kindOf, target) {
      (list || []).forEach(function (x) {
        x.fmt = fmt;
        x.kind = typeof kindOf === 'function' ? kindOf(x) : kindOf;
        itemById[x.id] = x;
        target.push(x);
      });
    }
    add(qb.mcq, 'opt', function (x) { return x.is_code_output ? 'output' : x.type === 'case_based' ? 'case' : 'mcq'; }, items);
    add(qb.assertion_reason, 'opt', 'ar', items);
    add(qb.match_mcq_board_style, 'opt', 'mm', items);
    add(qb.true_false, 'tf', 'tf', items);
    add(qb.fill_in_the_blanks, 'fb', 'fb', items);
    add(qb.match_the_following, 'mt', 'mt', items);
    add(qb.extended_optional, 'opt', 'ext', extItems);
    extItems.forEach(function (x) { if (!x.unit) x.unit = 'Python Programming'; });

    // mock papers: board-pattern papers (mixed types) first, then the practice papers
    (D.board_pattern_mocks || []).forEach(function (t) {
      addMock(t, 'board', (t.questions || []).slice().sort(function (a, b) { return a.q_no - b.q_no; })
        .map(function (q) { return { it: itemById[q.id], key: q.answer }; }));
    });
    (D.mock_tests || []).forEach(function (t) {
      var key = t.answer_key || {};
      addMock(t, 'practice', (t.question_ids || []).map(function (id) { return { it: itemById[id], key: key[id] }; }));
    });

    var m = D.meta || {};
    document.getElementById('footerText').innerHTML =
      esc(m.board || '') + ' · Class ' + esc(m['class'] || '') + ' · Semester ' + esc(m.semester || '') +
      ' · ' + esc(m.subject || '') + (m.version ? ' · v' + esc(m.version) : '') +
      '<br><span class="small">' + esc(m.disclaimer || '') + '</span>';

    wireGlobalUI();
    window.addEventListener('hashchange', route);
    route();
  }
  function addMock(t, group, list) {
    var mk = { id: t.id, title: t.title, group: group, t: t, list: list.filter(function (x) { return x.it; }) };
    mocks.push(mk);
    mockById[t.id] = mk;
  }

  function boot() {
    if (window.COMA_DATA) return init(window.COMA_DATA);
    fetch('data/coma.json').then(function (r) { return r.json(); }).then(init).catch(function () {
      app.innerHTML = '<div class="card empty"><h2>Could not load the study pack</h2>' +
        '<p>Make sure <code>data/data.js</code> (or <code>data/coma.json</code>) is present next to <code>index.html</code>.</p></div>';
    });
  }

  // ---------- global UI ----------
  function wireGlobalUI() {
    document.getElementById('themeBtn').addEventListener('click', function () {
      var root = document.documentElement;
      var cur = root.getAttribute('data-theme');
      if (!cur) cur = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      var next = cur === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('coma-theme', next); } catch (e) {}
    });
    var nav = document.getElementById('nav');
    document.getElementById('menuBtn').addEventListener('click', function () { nav.classList.toggle('open'); });
    nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') nav.classList.remove('open'); });

    document.getElementById('searchBtn').addEventListener('click', openSearch);
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea' && tag !== 'select') { e.preventDefault(); openSearch(); }
      if (e.key === 'Escape') closeSearch();
    });
    var ov = document.getElementById('searchOverlay');
    ov.addEventListener('click', function (e) { if (e.target === ov) closeSearch(); });
    document.getElementById('searchInput').addEventListener('input', runSearch);
    document.getElementById('searchInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = document.querySelector('#searchResults a');
        if (first) { location.hash = first.getAttribute('href'); closeSearch(); }
      }
    });
    document.getElementById('searchResults').addEventListener('click', function (e) {
      if (e.target.closest('a')) closeSearch();
    });

    // delegated actions used on every page
    document.addEventListener('click', function (e) {
      var c = e.target.closest('[data-copy]');
      if (c) {
        var text = c.getAttribute('data-copy');
        var done = function () { c.textContent = 'Copied!'; setTimeout(function () { c.textContent = 'Copy'; }, 1400); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
        } else { fallbackCopy(text); done(); }
        return;
      }
      var qz = e.target.closest('[data-quiz]');
      if (qz) { e.preventDefault(); startQuiz(JSON.parse(qz.getAttribute('data-quiz'))); return; }
      var bm = e.target.closest('[data-bm]');
      if (bm) {
        var id = bm.getAttribute('data-bm');
        if (bookmarks[id]) delete bookmarks[id]; else bookmarks[id] = 1;
        store.set(K.bookmarks, bookmarks);
        document.querySelectorAll('[data-bm="' + id + '"]').forEach(function (b) { setBmButton(b, !!bookmarks[id]); });
        toast(bookmarks[id] ? 'Bookmarked' : 'Bookmark removed');
        return;
      }
      var rt = e.target.closest('[data-rate]');
      if (rt) rateShort(rt.getAttribute('data-sid'), rt.getAttribute('data-rate'));
    });

    // back-to-top button
    var top = document.createElement('button');
    top.className = 'to-top'; top.setAttribute('aria-label', 'Back to top'); top.innerHTML = '↑';
    top.onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); };
    document.body.appendChild(top);
    window.addEventListener('scroll', function () { top.classList.toggle('show', window.scrollY > 600); }, { passive: true });
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }
  function bmButton(id) {
    var on = !!bookmarks[id];
    return '<button class="bm-btn' + (on ? ' on' : '') + '" data-bm="' + esc(id) + '" title="Bookmark (S in quiz)" aria-pressed="' + on + '">' + (on ? '★' : '☆') + '</button>';
  }
  function setBmButton(b, on) {
    b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; b.setAttribute('aria-pressed', on);
  }

  function setActiveNav(name) {
    document.querySelectorAll('#nav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-route') === name);
    });
  }

  // ---------- router ----------
  var NAV_OF = { q: 'practice', quiz: 'practice', browse: 'practice' };
  function route() {
    cleanups.forEach(function (fn) { try { fn(); } catch (e) {} });
    cleanups = [];
    var r = parseHash(), p = r.parts, page = p[0] || 'home';
    setActiveNav(NAV_OF[page] || page);
    window.scrollTo(0, 0);
    switch (page) {
      case 'notes': p[1] ? renderChapter(p[1]) : renderNotesIndex(); break;
      case 'practice':
        if (p[1]) { location.replace('#/browse/' + p[1]); return; }   // links from the first version
        renderPractice(); break;
      case 'browse': renderBrowse(p[1] || 'all', r.qs); break;
      case 'quiz': renderQuiz(); break;
      case 'q': renderSingleItem(p[1]); break;
      case 'short': renderShort(p[1] || 'all', r.qs); break;
      case 'programs': renderPrograms(r.qs); break;
      case 'mock': p[1] ? renderMock(p[1]) : renderMockIndex(); break;
      case 'revision': renderRevision(p[1] || 'quick', r.qs); break;
      case 'progress': renderProgress(); break;
      default: page = 'home'; renderHome();
    }
    document.title = (page === 'home' ? '' : cap(page) + ' · ') + 'COMA Study Pack';
  }

  // =====================================================================
  // Home
  // =====================================================================
  function renderHome() {
    var m = D.meta || {}, ep = m.exam_pattern || {};
    var w = ep.unit_weightage || {};
    var totalW = Object.keys(w).reduce(function (s, k) { return s + w[k]; }, 0) || 1;
    var st = stats(items);
    var streak = streakDays();
    var saved = store.get(K.quiz, null);
    var nWrong = wrongCount();

    var html = '<section class="hero">' +
      '<div class="hero-code">&gt;&gt;&gt;</div>' +
      '<div class="hero-badges"><span>WBCHSE</span><span>Class ' + esc(m['class']) + '</span><span>Semester ' + esc(m.semester) + '</span><span>' + esc(ep.type || '') + '</span></div>' +
      '<h1>' + esc(m.subject || 'Computer Application') + '</h1>' +
      '<p>Chapter notes, ' + items.length + ' practice questions in ' + KINDS.length + ' board-style formats, ' + mocks.length + ' full mock papers, short answers, programs and a glossary.</p>' +
      '<div class="btn-row"><a class="btn" href="#/notes">Start studying</a>' +
      '<button class="btn ghost"' + quizAttr({ source: 'new', count: 10, title: 'Quick 10 (mixed)' }) + '>⚡ Quick 10 questions</button>' +
      '<a class="btn ghost" href="#/mock">Take a mock test</a></div>' +
      '</section>';

    if (saved && !saved.done) {
      html += '<div class="card resume section"><div><b>Unfinished quiz:</b> ' + esc(saved.title) + ' — ' +
        Object.keys(saved.answers).length + ' / ' + saved.ids.length + ' answered</div><a class="btn sm" href="#/quiz">Resume</a></div>';
    }

    html += '<div class="grid grid-4 section">' +
      stat(items.length, 'Practice questions') + stat(mocks.length, 'Mock papers') +
      stat(st.done, 'Attempted') + stat(st.done ? st.acc + '%' : '–', 'Accuracy') +
      stat(streak + (streak === 1 ? ' day' : ' days'), 'Study streak 🔥') + stat(Object.keys(readCh).length + '/' + chapters.length, 'Chapters read') + '</div>';

    // today + progress + weak chapters
    var weak = weakChapters(3);
    html += '<div class="grid grid-home section">' + todayCard() +
      '<div class="card"><h2>Your progress</h2><div class="prog-row">' + ring(st.total ? st.done / st.total * 100 : 0, 'attempted') +
      '<div><p class="muted" style="margin:0 0 6px">' + st.done + ' of ' + st.total + ' questions attempted</p>' +
      '<p style="margin:0 0 12px"><span class="pill good">✓ ' + st.right + '</span> <span class="pill bad">✗ ' + st.wrong + '</span></p>' +
      '<div class="btn-row"><button class="btn sm"' + quizAttr({ source: 'new', count: 10, title: 'Continue practice' }) + '>Continue practice</button>' +
      (nWrong ? '<button class="btn sm ghost"' + quizAttr({ source: 'wrong', count: 20, title: 'Retry wrong answers' }) + '>Retry ' + nWrong + ' wrong</button>' : '') +
      '</div></div></div></div>' +
      '<div class="card"><h2>Focus areas</h2>' +
      (weak.length ? '<p class="muted small">Chapters where your accuracy is lowest:</p>' + weak.map(function (x) {
        return '<div class="weak-row"><div><b>' + esc(x.ch.title) + '</b><div class="small muted">' + x.s.acc + '% correct · ' + x.s.done + '/' + x.s.total + ' done</div>' + bar(x.s.acc) + '</div>' +
          '<button class="btn sm"' + quizAttr({ chapters: [x.ch.chapter_id], count: 10, title: x.ch.title }) + '>Practise</button></div>';
      }).join('') : '<p class="muted">Answer at least 3 questions in a chapter and your weakest chapters will show up here.</p>' +
        '<a class="btn sm" href="#/practice">Open practice</a>') +
      '</div></div>';

    // question formats
    html += '<div class="section"><div class="section-title"><h2>Practise every board format</h2><a href="#/practice">All practice options →</a></div>' +
      '<div class="type-strip">' + KINDS.map(function (k) {
        var n = items.filter(function (q) { return q.kind === k; }).length;
        return '<button class="type-pill"' + quizAttr({ types: [k], count: 10, title: TYPES[k].label }) + '><span>' + TYPES[k].icon + '</span>' + esc(TYPES[k].label) + ' <b>' + n + '</b></button>';
      }).join('') + '</div></div>';

    // exam pattern
    html += '<div class="card section"><h2>Exam pattern</h2>' +
      '<p class="muted">' + esc(ep.type || '') + ' · Full marks <b>' + esc(ep.full_marks_theory || '') + '</b></p>' +
      '<div class="weight-bar">' + Object.keys(w).map(function (k) {
        return '<div class="w-' + unitClass(k) + '" style="width:' + (w[k] / totalW * 100) + '%">' + esc(unitShort(k)) + ' · ' + w[k] + '</div>';
      }).join('') + '</div>' +
      (ep.note ? '<p class="small muted" style="margin:0">' + esc(ep.note) + '</p>' : '') + '</div>';

    // chapters by unit
    html += '<div class="section"><div class="section-title"><h2>Syllabus</h2><a href="#/notes">All notes →</a></div>';
    (D.syllabus || []).forEach(function (u) {
      html += unitHead(u, 'h3') + '<div class="grid grid-3">';
      (u.chapters || []).forEach(function (c) { html += chapterCard(chapterById[c.chapter_id]); });
      html += '</div>';
    });
    html += '</div>';

    // extras
    html += '<div class="grid grid-3 section">' +
      '<a class="card feature" href="#/revision/glossary"><div class="ico">📖</div><h3>Glossary</h3><p class="muted small">' + (D.glossary || []).length + ' key terms with Bengali meanings.</p></a>' +
      '<a class="card feature" href="#/revision/plan"><div class="ico">🌙</div><h3>Last-night plan</h3><p class="muted small">Hour-by-hour plan for the night before the exam.</p></a>' +
      (D.sem4_reference ? '<a class="card feature" href="#/revision/sem4"><div class="ico">🔭</div><h3>Semester IV preview</h3><p class="muted small">Pattern and topics of the descriptive Sem IV paper.</p></a>' : '') +
      '</div>';

    if (m.disclaimer) html += '<div class="notice section">' + esc(m.disclaimer) + '</div>';
    if (m.sources && m.sources.length) {
      html += '<p class="small muted" style="margin-top:12px">Sources: ' + m.sources.map(function (s) {
        return s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + '</a>' : esc(s.name);
      }).join(' · ') + '</p>';
    }
    app.innerHTML = html;
    wireTodayCard();
  }
  // daily goal ring, exam countdown and smart-review call to action
  function todayCard() {
    var done = answeredToday(), goal = dailyGoal(), left = daysToExam(), nDue = dueItems().length;
    return '<div class="card today-card"><div class="section-title" style="margin-bottom:8px"><h2 style="margin:0">Today</h2>' +
      '<label class="small muted goal-set">Goal <select id="goalSel" aria-label="Daily goal">' + [10, 20, 30, 50, 80].map(function (g) {
        return '<option' + (g === goal ? ' selected' : '') + '>' + g + '</option>';
      }).join('') + '</select></label></div>' +
      '<div class="prog-row">' + ring(done / goal * 100, done + ' / ' + goal) +
      '<div class="today-info">' +
      (done >= goal ? '<p class="goal-done">🎉 Daily goal reached!</p>' : '<p class="muted small" style="margin:0 0 6px">' + (goal - done) + ' more questions to reach today\'s goal</p>') +
      '<p class="small" style="margin:0 0 10px">' + (nDue ? '<b>' + nDue + '</b> ' + (nDue === 1 ? 'question is' : 'questions are') + ' due for review' : 'No reviews due — learn something new') + '</p>' +
      '<button class="btn sm"' + quizAttr({ smart: true, count: 20 }) + '>🧠 Smart review (20)</button></div></div>' +
      '<div class="exam-row">' + (left == null ? '<span class="small muted">When is your exam?</span>' :
        left > 0 ? '<span class="countdown"><b>' + left + '</b> day' + (left === 1 ? '' : 's') + ' to the exam</span>' :
        left === 0 ? '<span class="countdown"><b>Exam day</b> — all the best! 🍀</span>' : '<span class="small muted">Exam date has passed</span>') +
      '<input type="date" id="examDate" value="' + esc(store.get(K.examDate, '')) + '" aria-label="Exam date"></div></div>';
  }
  function wireTodayCard() {
    var g = document.getElementById('goalSel'), d = document.getElementById('examDate');
    if (g) g.onchange = function () { store.set(K.goal, +this.value); route(); };
    if (d) d.onchange = function () { store.set(K.examDate, this.value); route(); };
  }
  function stat(v, label) { return '<div class="card stat"><b>' + esc(v == null ? '–' : v) + '</b><span>' + esc(label) + '</span></div>'; }
  function unitHead(u, tag) {
    return '<div class="unit-head"><span class="dot" style="background:var(--' + unitClass(u.unit) + ')"></span><' + tag + ' style="margin:0">' +
      esc(u.unit) + '</' + tag + '><span class="tag ' + unitClass(u.unit) + '">' + esc(u.marks) + ' marks</span></div>';
  }
  function chapterCard(ch) {
    var st = stats(itemsFor(ch.chapter_id));
    return '<a class="card chapter-card" href="#/notes/' + ch.chapter_id + '">' +
      '<span class="num">Chapter ' + String(ch.index).padStart(2, '0') + (readCh[ch.chapter_id] ? ' · <span class="read-mark">✓ Read</span>' : '') + '</span>' +
      '<h3>' + esc(ch.title) + '</h3>' + (ch.title_bn ? '<span class="bn-sub">' + esc(ch.title_bn) + '</span>' : '') + bar(st.total ? st.done / st.total * 100 : 0) +
      '<div class="meta"><span class="tag ' + unitClass(ch.unit) + '">' + unitShort(ch.unit) + '</span><span class="tag">' + st.total + ' questions</span>' +
      (st.done ? accTag(st) : '') + '</div></a>';
  }

  // =====================================================================
  // Notes
  // =====================================================================
  function sideList(activeId) {
    var html = '<aside class="card side-list">';
    (D.syllabus || []).forEach(function (u) {
      html += '<h4>' + esc(u.unit) + '</h4>';
      (u.chapters || []).forEach(function (c) {
        html += '<a href="#/notes/' + c.chapter_id + '"' + (c.chapter_id === activeId ? ' class="active"' : '') + '>' +
          chapterById[c.chapter_id].index + '. ' + esc(c.title) + (readCh[c.chapter_id] ? ' <span class="read-mark">✓</span>' : '') + '</a>';
      });
    });
    return html + '</aside>';
  }
  function renderNotesIndex() {
    var nRead = Object.keys(readCh).length;
    var html = '<div class="page-head"><h1>Study notes</h1><p>Chapter-wise key points, tables, worked examples and common exam traps.</p>' +
      '<div class="inline-progress"><span class="small muted">' + nRead + ' of ' + chapters.length + ' chapters marked as read</span>' + bar(nRead / chapters.length * 100) + '</div></div>';
    (D.syllabus || []).forEach(function (u) {
      html += unitHead(u, 'h2') + '<div class="grid grid-3">';
      (u.chapters || []).forEach(function (c) { html += chapterCard(chapterById[c.chapter_id]); });
      html += '</div>';
    });
    app.innerHTML = html;
  }
  function renderChapter(id) {
    var ch = chapterById[id], n = notesById[id];
    if (!ch) { app.innerHTML = '<div class="card empty">Chapter not found. <a href="#/notes">Back to notes</a></div>'; return; }
    var idx = chapters.indexOf(ch);
    var prev = chapters[idx - 1], next = chapters[idx + 1];
    var nShort = ((D.question_bank && D.question_bank.short_answer) || []).filter(function (s) { return s.chapter_id === id; }).length;
    var nProg = ((D.question_bank && D.question_bank.programs) || []).filter(function (s) { return s.chapter_id === id; }).length;
    var chItems = itemsFor(id);
    var st = stats(chItems);

    var body = '<div class="crumbs"><a href="#/notes">Notes</a> / ' + esc(ch.unit) + '</div>' +
      '<h1 style="margin-bottom:4px">' + esc(ch.title) + '</h1>' + (ch.title_bn ? '<p class="bn-sub big">' + esc(ch.title_bn) + '</p>' : '') +
      '<div class="btn-row" style="margin:10px 0 8px"><span class="tag ' + unitClass(ch.unit) + '">' + esc(ch.unit) + '</span>' +
      '<span class="tag">' + st.done + '/' + st.total + ' questions done' + (st.done ? ' · ' + st.acc + '%' : '') + '</span></div>' +
      '<div class="btn-row" style="margin-bottom:20px">' +
      '<button class="btn sm"' + quizAttr({ chapters: [id], count: 10, title: ch.title }) + '>Quiz: 10 questions</button>' +
      '<a class="btn sm ghost" href="#/browse/' + id + '">All ' + st.total + ' questions</a>' +
      (nShort ? '<a class="btn sm ghost" href="#/short/' + id + '">' + nShort + ' short answers</a>' : '') +
      (nProg ? '<a class="btn sm ghost" href="#/programs?ch=' + id + '">' + nProg + ' programs</a>' : '') + '</div>';

    if (!n) body += '<div class="card empty">No notes for this chapter yet.</div>';
    else {
      if (n.key_points && n.key_points.length) {
        body += '<div class="card"><h2>Key points</h2><ul class="key-points">' +
          n.key_points.map(function (k) { return '<li>' + formatText(k) + '</li>'; }).join('') + '</ul></div>';
      }
      if (n.syntax) {
        body += '<div class="card section"><h2>Syntax</h2>' + codeBlock(n.syntax, 'General form') + '</div>';
      }
      (n.tables || []).forEach(function (t) {
        body += '<div class="card section"><h3>' + esc(t.title || 'Table') + '</h3><div class="table-wrap"><table><thead><tr>' +
          (t.columns || []).map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          (t.rows || []).map(function (r) {
            return '<tr>' + (Array.isArray(r) ? r : Object.values(r)).map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div></div>';
      });
      if (n.examples && n.examples.length) {
        body += '<div class="card section"><h2>Examples</h2><p class="small muted">Tip: predict the output before you reveal it.</p>' + n.examples.map(function (ex, i) {
          return '<div style="margin-bottom:18px">' + codeBlock(ex.code || '', 'Example ' + (i + 1)) +
            (ex.output != null && ex.output !== '' ? '<details class="reveal"><summary>Show output</summary><div class="output">' + esc(ex.output) + '</div></details>' : '') + '</div>';
        }).join('') + '</div>';
      }
      if (n.exam_traps && n.exam_traps.length) {
        body += '<div class="card section trap-box"><h3>⚠ Exam traps</h3><ul class="traps">' +
          n.exam_traps.map(function (t) { return '<li>' + formatText(t) + '</li>'; }).join('') + '</ul></div>';
      }
    }

    // practice this chapter by format
    var kinds = KINDS.filter(function (k) { return chItems.some(function (q) { return q.kind === k; }); });
    body += '<div class="card section"><h2>Practise this chapter</h2><div class="type-grid small-grid">' + kinds.map(function (k) {
      var list = chItems.filter(function (q) { return q.kind === k; });
      var s = stats(list);
      return '<div class="type-mini"><div><span class="t-ico">' + TYPES[k].icon + '</span><b>' + esc(TYPES[k].label) + '</b></div>' +
        '<div class="small muted">' + s.done + '/' + s.total + ' done' + (s.done ? ' · ' + s.acc + '%' : '') + '</div>' +
        '<div class="btn-row"><button class="btn sm"' + quizAttr({ chapters: [id], types: [k], count: 0, title: ch.title + ' · ' + TYPES[k].label }) + '>Quiz</button>' +
        '<a class="btn sm ghost" href="#/browse/' + id + '?type=' + k + '">Browse</a></div></div>';
    }).join('') + '</div></div>';

    var isRead = !!readCh[id];
    body += '<div class="card section done-card"><div><b>Finished this chapter?</b><div class="small muted">Mark it as read, then test yourself.</div></div>' +
      '<div class="btn-row"><button class="btn ' + (isRead ? 'ghost' : '') + '" id="readBtn">' + (isRead ? '✓ Marked as read' : 'Mark as read') + '</button>' +
      '<button class="btn ghost"' + quizAttr({ chapters: [id], count: 10, title: ch.title }) + '>Take the quiz</button></div></div>';
    body += '<div class="chapter-nav">' +
      (prev ? '<a class="btn ghost" href="#/notes/' + prev.chapter_id + '">← ' + esc(prev.title) + '</a>' : '<span></span>') +
      (next ? '<a class="btn ghost" href="#/notes/' + next.chapter_id + '">' + esc(next.title) + ' →</a>' : '') + '</div>';
    app.innerHTML = '<div class="notes-layout">' + sideList(id) + '<article>' + body + '</article></div>';

    document.getElementById('readBtn').onclick = function () {
      if (readCh[id]) delete readCh[id]; else readCh[id] = 1;
      store.set(K.read, readCh);
      toast(readCh[id] ? 'Chapter marked as read' : 'Marked as unread');
      var y = window.scrollY; renderChapter(id); window.scrollTo(0, y);
    };
  }
  // escape text and bold a leading "Term:" label
  function formatText(s) {
    return esc(s).replace(/^([A-Za-z][\w\s\-\/()&#;.,']{1,48}?):\s/, '<b>$1:</b> ');
  }

  // =====================================================================
  // Item rendering — every question type goes through here
  // =====================================================================
  // question text with code: Bengali lines before/after the code are prose, the rest is a code block.
  // Handles "prose\ncode", "code\nprose" and "code\nprint(x) এর আউটপুট কী?".
  var BN = /[ঀ-৿]/;
  function proseLine(line) {
    // "print(s) এর আউটপুট কী?" -> inline code for the part before the Bengali text
    var i = line.search(BN), head = i > 0 ? line.slice(0, i).trim() : '';
    if (head && /[=()\[\]:+\-*\/%'"]/.test(head)) return '<code class="inline-code">' + esc(head) + '</code> ' + esc(line.slice(i));
    return esc(line);
  }
  function qText(q) {
    q = String(q || '');
    if (q.indexOf('\n') < 0) return esc(q);
    var lines = q.split('\n'), before = [], after = [];
    while (lines.length > 1 && BN.test(lines[0])) before.push(lines.shift());
    while (lines.length > 1 && BN.test(lines[lines.length - 1])) after.unshift(lines.pop());
    return before.map(proseLine).join('<br>') +
      '<pre class="q-code"><code>' + highlight(lines.join('\n')) + '</code></pre>' +
      (after.length ? '<div class="q-after">' + after.map(proseLine).join('<br>') + '</div>' : '');
  }
  function questionHtml(it, st) {
    switch (it.kind) {
      case 'ar':
        return '<div class="ar-box"><div><span class="ar-label">Assertion (A)</span>' + esc(it.assertion) + '</div>' +
          '<div><span class="ar-label">Reason (R)</span>' + esc(it.reason) + '</div></div>';
      case 'mm':
        var rows = Math.max(it.column_a.length, it.column_b.length), trs = '';
        for (var i = 0; i < rows; i++) trs += '<tr><td>' + esc(it.column_a[i] || '') + '</td><td>' + esc(it.column_b[i] || '') + '</td></tr>';
        return '<div class="mcq-q">' + esc(it.instruction) + '</div><div class="table-wrap mm-wrap"><table class="mm-table"><thead><tr><th>Column A</th><th>Column B</th></tr></thead><tbody>' + trs + '</tbody></table></div>';
      case 'tf':
        return '<div class="mcq-q">' + esc(it.statement) + '</div><p class="small muted tf-ask">বাক্যটি সত্য না মিথ্যা?</p>';
      case 'fb':
        var shown = st.reveal ? '<span class="blank filled">' + esc(it.answer) + '</span>' : '<span class="blank">&nbsp;</span>';
        var q = esc(it.question);
        return '<div class="mcq-q">' + (/_{2,}/.test(q) ? q.replace(/_{2,}/, shown) : q + ' ' + shown) + '</div>';
      case 'mt':
        return '<div class="mcq-q">' + esc(it.instruction) + '</div>';
      default:
        return '<div class="mcq-q">' + qText(it.question) + '</div>';
    }
  }
  function optionsHtml(map, st, correct) {
    return '<div class="opts">' + Object.keys(map || {}).map(function (L, i) {
      var cls = '';
      if (st.reveal) { if (L === correct) cls = ' correct'; else if (L === st.resp) cls = ' wrong'; }
      else if (L === st.resp) cls = ' selected';
      return '<button class="opt' + cls + '" data-letter="' + L + '"' + (st.locked ? ' disabled' : '') + '>' +
        '<span class="letter">' + L + '</span><span class="otext">' + esc(map[L]) + '</span>' +
        '<kbd class="khint">' + (i + 1) + '</kbd></button>';
    }).join('') + '</div>';
  }
  function fbHtml(it, st) {
    if (st.reveal) {
      var ok = isCorrect(it, st.resp);
      return '<div class="fb-given ' + (ok ? 'ok' : 'no') + '">Your answer: <b>' + esc(st.resp && st.resp !== '—' ? st.resp : '(none)') + '</b></div>' +
        (!ok && st.resp && st.resp !== '—' && !st.noOverride ? '<button class="link-btn small" data-override>My answer means the same — count it correct</button>' : '');
    }
    return '<form class="fb-form" autocomplete="off"><input type="text" class="fb-input" placeholder="Type your answer…" value="' + esc(st.resp && st.resp !== '—' ? st.resp : '') + '" aria-label="Your answer">' +
      '<button class="btn sm" type="submit">' + (st.exam ? 'Save' : 'Check') + '</button>' +
      (st.exam ? '' : '<button class="btn sm ghost" type="button" data-giveup>Show answer</button>') + '</form>' +
      (st.exam && hasResp(st.resp) ? '<div class="small muted saved-note">Saved ✓ — you can change it</div>' : '');
  }
  function mtHtml(it, st) {
    var c = mtMap(it), resp = Array.isArray(st.resp) ? st.resp : [];
    var h = '<div class="mt-table">' + it.column_a.map(function (a, i) {
      var v = resp[i] || '';
      var cls = st.reveal ? (v === c[a] ? ' ok' : ' no') : '';
      return '<div class="mt-row' + cls + '"><div class="mt-a">' + esc(a) + '</div><div class="mt-arrow">→</div><div class="mt-b">' +
        (st.locked ? '<span class="mt-val">' + esc(v || '—') + '</span>' + (st.reveal && v !== c[a] ? '<span class="mt-fix">✓ ' + esc(c[a]) + '</span>' : '') :
          '<select data-mt="' + i + '" aria-label="Match for ' + esc(a) + '"><option value="">Choose…</option>' + it.column_b_shuffled.map(function (b) {
            return '<option value="' + esc(b) + '"' + (b === v ? ' selected' : '') + '>' + esc(b) + '</option>';
          }).join('') + '</select>') + '</div></div>';
    }).join('') + '</div>';
    if (!st.locked) h += '<div class="btn-row" style="margin-top:10px"><button class="btn sm" data-mt-check>' + (st.exam ? 'Save' : 'Check') + '</button>' +
      (st.exam && hasResp(st.resp) ? '<span class="small muted saved-note">Saved ✓</span>' : '') + '</div>';
    return h;
  }
  function explainHtml(it, resp, key) {
    var ok = isCorrect(it, resp, key);
    var none = !hasResp(resp) || resp === '—';
    var head = none ? '<b class="no">উত্তর দেওয়া হয়নি।</b> ' : ok ? '<b class="ok">✓ সঠিক!</b> ' : '<b class="no">✗ ভুল।</b> ';
    var body = '';
    if (it.fmt === 'opt' || it.fmt === 'tf') {
      var ck = correctKey(it, key);
      if (!ok) body += 'সঠিক উত্তর: <b>' + esc(ck) + ') ' + esc(optMap(it)[ck]) + '</b><br>';
    } else if (it.fmt === 'fb') {
      if (!ok) body += 'সঠিক উত্তর: <b>' + esc(it.answer) + '</b><br>';
    } else if (it.fmt === 'mt') {
      var c = mtMap(it), r = Array.isArray(resp) ? resp : [];
      var n = it.column_a.filter(function (a, i) { return r[i] === c[a]; }).length;
      body += n + ' / ' + it.column_a.length + ' pairs correct.';
    }
    if (it.explanation) body += esc(it.explanation);
    return '<div class="explain">' + head + body + '</div>';
  }
  function itemBody(it, st) {
    var h = questionHtml(it, st);
    if (it.fmt === 'opt' || it.fmt === 'tf') h += optionsHtml(optMap(it), st, correctKey(it, st.key));
    else if (it.fmt === 'fb') h += fbHtml(it, st);
    else if (it.fmt === 'mt') h += mtHtml(it, st);
    if (st.reveal) h += explainHtml(it, st.resp, st.key);
    return h;
  }
  function typeTag(it) { return '<span class="tag type">' + TYPES[it.kind].icon + ' ' + esc(TYPES[it.kind].label) + '</span>'; }
  function itemHead(it, label, extra) {
    return '<div class="mcq-head"><span class="small muted mono">' + (label ? label + ' · ' : '') + esc(it.id) + '</span>' +
      '<span class="head-tags">' + typeTag(it) +
      '<span class="tag ' + unitClass(it.unit) + '">' + esc(chTitle(it)) + '</span>' +
      (it.difficulty ? '<span class="tag ' + esc(it.difficulty) + '">' + esc(it.difficulty) + '</span>' : '') + (extra == null ? bmButton(it.id) : extra) + '</span></div>';
  }
  function itemCard(it, num) {
    var resp = progress[it.id], done = hasResp(resp);
    return '<div class="card mcq" data-id="' + esc(it.id) + '" data-num="' + (num || 0) + '">' + itemHead(it, num ? 'Q' + num : '') +
      itemBody(it, { resp: resp, reveal: done, locked: done }) +
      (done ? '<button class="link-btn small retry" data-retry>↺ Try again</button>' : '') + '</div>';
  }
  // one delegated handler for answering any item type inside a container
  function wireItems(container, h) {
    container.addEventListener('click', function (e) {
      var card = e.target.closest('[data-id]');
      if (!card || !container.contains(card)) return;
      var id = card.getAttribute('data-id'), t;
      if ((t = e.target.closest('.opt')) && !t.disabled) h.respond(id, t.getAttribute('data-letter'), card);
      else if (e.target.closest('[data-mt-check]')) {
        var arr = [];
        card.querySelectorAll('select[data-mt]').forEach(function (s) { arr[+s.getAttribute('data-mt')] = s.value; });
        if (!arr.some(Boolean)) { toast('Choose a match for at least one row'); return; }
        h.respond(id, arr, card);
      }
      else if (e.target.closest('[data-giveup]')) h.respond(id, '—', card);
      else if (e.target.closest('[data-override]') && h.override) h.override(id, card);
      else if (e.target.closest('[data-retry]') && h.retry) h.retry(id, card);
    });
    container.addEventListener('submit', function (e) {
      var f = e.target.closest('.fb-form');
      if (!f) return;
      e.preventDefault();
      var v = f.querySelector('input').value.trim();
      if (!v) { toast('Type an answer first'); return; }
      h.respond(f.closest('[data-id]').getAttribute('data-id'), v, f.closest('[data-id]'));
    });
  }
  // browse / single-question handlers: answer, override, retry, then redraw the card
  function wireBrowse(container, onChange) {
    function redraw(card, id) {
      var tmp = document.createElement('div');
      tmp.innerHTML = itemCard(itemById[id], +card.getAttribute('data-num'));
      card.replaceWith(tmp.firstChild);
      if (onChange) onChange();
    }
    wireItems(container, {
      respond: function (id, resp, card) { recordAnswer(itemById[id], resp); redraw(card, id); },
      override: function (id, card) {
        progress[id] = itemById[id].answer; store.set(K.progress, progress);
        setSrs(id, true); redraw(card, id);
      },
      retry: function (id, card) {
        delete progress[id]; store.set(K.progress, progress); redraw(card, id);
        var input = container.querySelector('[data-id="' + id + '"] .fb-input');
        if (input) input.focus();
      }
    });
  }

  // =====================================================================
  // Practice hub: quick starts, formats, quiz builder, chapter table
  // =====================================================================
  function defaultBuilder() {
    return { chapters: chapters.map(function (c) { return c.chapter_id; }), types: KINDS.slice(), diff: 'all', source: 'all', count: 10, order: 'shuffle', mode: 'instant', timer: 'off' };
  }
  function buildPool(o) {
    var list;
    if (o.ids) list = o.ids.map(function (id) { return itemById[id]; }).filter(Boolean);
    else {
      list = o.ext ? extItems : items;
      if (!o.ext && o.chapters && o.chapters !== 'all') {
        var set = {}; o.chapters.forEach(function (c) { set[c] = 1; });
        list = list.filter(function (q) { return set[q.chapter_id]; });
      }
      if (!o.ext && o.types && o.types.length) list = list.filter(function (q) { return o.types.indexOf(q.kind) >= 0; });
      if (o.diff && o.diff !== 'all') list = list.filter(function (q) { return q.difficulty === o.diff; });
    }
    if (o.source === 'new') list = list.filter(function (q) { return !hasResp(progress[q.id]); });
    if (o.source === 'wrong') list = list.filter(isWrong);
    if (o.source === 'bookmarked') list = list.filter(function (q) { return bookmarks[q.id]; });
    // "retry wrong" / "bookmarked" with no other filter also include the optional extra questions
    if ((o.source === 'wrong' || o.source === 'bookmarked') && !o.ids && !o.ext && !o.chapters && !o.types) {
      list = list.concat(extItems.filter(o.source === 'wrong' ? isWrong : function (q) { return bookmarks[q.id]; }));
    }
    return list;
  }
  // a board-style paper: Python first, then E-Commerce, OMR-answerable formats only
  function randomPaperIds() {
    var opt = items.filter(function (q) { return q.fmt === 'opt'; });
    var py = shuffle(opt.filter(function (q) { return unitClass(q.unit) === 'py'; })).slice(0, 25);
    var ec = shuffle(opt.filter(function (q) { return unitClass(q.unit) === 'ec'; })).slice(0, 10);
    return py.concat(ec).map(function (q) { return q.id; });
  }
  function startQuiz(o) {
    var saved = store.get(K.quiz, null);
    if (saved && !saved.done && Object.keys(saved.answers).length &&
        !confirm('You have an unfinished quiz (' + saved.title + '). Start a new one and discard it?')) return;
    if (o.random) o = { ids: randomPaperIds(), order: 'inorder', mode: 'exam', limit: 75 * 60, title: o.title || 'Random board-style paper' };
    if (o.smart) o = { ids: smartPick(o.count || 20), order: 'inorder', mode: 'instant', title: 'Smart review' };
    var list = buildPool(o);
    if (o.order !== 'inorder') list = shuffle(list);
    if (o.count) list = list.slice(0, o.count);
    if (!list.length) {
      toast(o.source === 'new' ? 'You have attempted every question here — try "Retry wrong" or "All questions".' :
        o.source === 'wrong' ? 'No wrong answers to retry. 🎉' : o.source === 'bookmarked' ? 'No bookmarked questions yet.' : 'No questions match.');
      return;
    }
    var s = {
      title: o.title || 'Practice quiz', ids: list.map(function (q) { return q.id; }),
      mode: o.mode || 'instant', answers: {}, idx: 0, elapsed: 0,
      limit: o.limit || (o.timer === 'on' ? list.length * 60 : 0),
      streak: 0, best: 0, done: false, opts: o, token: Date.now() + '-' + Math.random()
    };
    store.set(K.quiz, s);
    if (location.hash === '#/quiz') route(); else location.hash = '#/quiz';
  }

  function renderPractice() {
    var b = store.get(K.builder, null) || defaultBuilder();
    var saved = store.get(K.quiz, null);
    var all = stats(items);
    var nWrong = wrongCount(), nBm = bookmarkCount(), nNew = all.total - all.done, nDue = dueItems().length;

    var html = '<div class="page-head"><h1>Practice</h1><p>Quiz yourself one question at a time in every board format, build a custom test, or browse the whole question bank. Your answers are saved in this browser.</p></div>';

    if (saved && !saved.done) {
      html += '<div class="card resume"><div><b>Unfinished quiz:</b> ' + esc(saved.title) + ' — ' + Object.keys(saved.answers).length + ' / ' + saved.ids.length +
        ' answered</div><div class="btn-row"><a class="btn sm" href="#/quiz">Resume</a><button class="btn sm ghost" id="discardQuiz">Discard</button></div></div>';
    }

    // overview + quick starts
    html += '<div class="practice-top section">' +
      '<div class="card overview">' + ring(all.total ? all.done / all.total * 100 : 0, 'attempted', 120) +
      '<div><div class="big-num">' + all.done + '<span>/' + all.total + '</span></div>' +
      '<p class="muted small" style="margin:0 0 8px">questions attempted</p>' +
      '<span class="pill good">✓ ' + all.right + '</span> <span class="pill bad">✗ ' + all.wrong + '</span> <span class="pill">' + all.acc + '% accuracy</span></div></div>' +
      '<div class="quick-grid">' +
      '<button class="card quick smart"' + quizAttr({ smart: true, count: 20 }) + '><span class="quick-ico">🧠</span>' +
      '<span><b>Smart review</b><span class="small muted">20 questions picked for you: ' + (nDue ? nDue + ' due for review, then ' : '') +
      'new ones from your weakest chapters. Correct answers come back after 1, 3, 7 and 16 days.</span></span></button>' +
      quick('⚡', 'Quick 10', 'Mixed formats you haven\'t tried', { source: 'new', count: 10, title: 'Quick 10 (mixed)' }, nNew) +
      quick('↺', 'Retry wrong', plural(nWrong, 'question') + ' to fix', { source: 'wrong', count: 0, title: 'Retry wrong answers' }, nWrong) +
      quick('★', 'Bookmarked', plural(nBm, 'saved question'), { source: 'bookmarked', count: 0, title: 'Bookmarked questions' }, nBm) +
      quick('⏱', 'Exam drill', '25 Python + 10 E-Com · 75 min', { random: true, title: 'Exam drill (board style)' }, 1) +
      '</div></div>';

    // formats
    html += '<div class="section" id="formats"><div class="section-title"><h2>Practise by format</h2><span class="muted small">The board paper mixes all of these</span></div><div class="type-grid">' +
      KINDS.map(function (k) {
        var list = items.filter(function (q) { return q.kind === k; }), s = stats(list);
        return '<div class="card type-card"><div class="type-top"><span class="t-ico big">' + TYPES[k].icon + '</span><div><b>' + esc(TYPES[k].label) + '</b>' +
          '<div class="small muted">' + esc(TYPES[k].desc) + '</div></div></div>' +
          '<div class="small muted type-stat"><span>' + s.done + ' / ' + s.total + ' done</span>' + (s.done ? accTag(s) : '') + '</div>' + bar(s.total ? s.done / s.total * 100 : 0) +
          '<div class="btn-row"><button class="btn sm"' + quizAttr({ types: [k], count: 10, title: TYPES[k].label }) + '>Quiz 10</button>' +
          '<a class="btn sm ghost" href="#/browse/all?type=' + k + '">Browse ' + s.total + '</a></div></div>';
      }).join('') + '</div></div>';

    // builder
    html += '<div class="card section builder"><h2>Build your own quiz</h2>' +
      '<div class="builder-grid"><div><div class="field-label">Chapters <span class="link-btn small" data-sel="all">All</span> · <span class="link-btn small" data-sel="none">None</span></div>' +
      (D.syllabus || []).map(function (u) {
        return '<div class="ch-group"><label class="ch-unit"><input type="checkbox" data-unit="' + esc(u.unit) + '"> <b>' + esc(u.unit) + '</b></label>' +
          u.chapters.map(function (c) {
            return '<label class="ch-item"><input type="checkbox" name="bch" value="' + c.chapter_id + '"' + (b.chapters.indexOf(c.chapter_id) >= 0 ? ' checked' : '') +
              ' data-u="' + esc(u.unit) + '"> ' + esc(c.title) + ' <span class="muted small">(' + itemsFor(c.chapter_id).length + ')</span></label>';
          }).join('') + '</div>';
      }).join('') + '</div>' +
      '<div class="builder-opts">' +
      multiChips('Formats', 'types', KINDS.map(function (k) { return [k, TYPES[k].label]; }), b.types || KINDS) +
      chipGroup('Difficulty <span class="muted" style="text-transform:none;letter-spacing:0">(MCQ formats only)</span>', 'diff', [['all', 'Any'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], b.diff) +
      chipGroup('Questions', 'source', [['all', 'All'], ['new', 'Not attempted'], ['wrong', 'Got wrong'], ['bookmarked', 'Bookmarked']], b.source) +
      chipGroup('How many', 'count', [['10', '10'], ['20', '20'], ['35', '35'], ['0', 'All']], String(b.count)) +
      chipGroup('Order', 'order', [['shuffle', 'Shuffled'], ['inorder', 'In order']], b.order) +
      chipGroup('Feedback', 'mode', [['instant', 'After each question'], ['exam', 'At the end (exam style)']], b.mode) +
      chipGroup('Timer', 'timer', [['off', 'Off'], ['on', '1 min / question']], b.timer) +
      '<div class="builder-go"><span id="poolCount" class="muted"></span><button class="btn" id="startBuilt">Start quiz →</button></div>' +
      '</div></div></div>';

    // chapter table
    html += '<div class="section"><div class="section-title"><h2>By chapter</h2></div><div class="card table-card"><div class="table-wrap plain"><table class="ch-table"><thead><tr><th>Chapter</th><th>Progress</th><th>Accuracy</th><th></th></tr></thead><tbody>' +
      chapters.map(function (c) {
        var s = stats(itemsFor(c.chapter_id));
        return '<tr><td><span class="dot-sm" style="background:var(--' + unitClass(c.unit) + ')"></span>' + esc(c.title) + '</td>' +
          '<td style="min-width:130px"><div class="small muted">' + s.done + ' / ' + s.total + '</div>' + bar(s.total ? s.done / s.total * 100 : 0) + '</td>' +
          '<td>' + (s.done ? accTag(s) : '<span class="muted small">—</span>') + '</td>' +
          '<td class="nowrap"><button class="btn sm"' + quizAttr({ chapters: [c.chapter_id], count: 10, title: c.title }) + '>Quiz</button> ' +
          '<a class="btn sm ghost" href="#/browse/' + c.chapter_id + '">Browse</a></td></tr>';
      }).join('') + '</tbody></table></div></div></div>';

    // beyond the syllabus
    if (extItems.length) {
      var es = stats(extItems), topics = [];
      extItems.forEach(function (q) { if (q.topic && topics.indexOf(q.topic) < 0) topics.push(q.topic); });
      html += '<div class="card section ext-card"><div class="section-title"><h2>＋ Beyond the syllabus <span class="tag">optional</span></h2>' +
        '<span class="small muted">' + es.done + ' / ' + es.total + ' done</span></div>' +
        '<p class="muted small">' + extItems.length + ' extra questions on topics from the Computer Science (COMS) question bank that are <b>not</b> in the COMA Semester 3 syllabus. Try them only after finishing the main syllabus.</p>' +
        '<div class="btn-row" style="margin-bottom:12px">' + topics.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' +
        '<div class="btn-row"><button class="btn sm ghost"' + quizAttr({ ext: true, count: 10, title: 'Beyond the syllabus' }) + '>Quiz 10</button>' +
        '<a class="btn sm ghost" href="#/browse/ext">Browse all</a></div></div>';
    }

    app.innerHTML = html;

    var disc = document.getElementById('discardQuiz');
    if (disc) disc.onclick = function () { store.del(K.quiz); route(); };

    // builder wiring
    function readBuilder() {
      var o = { chapters: [], types: [], diff: 'all', source: 'all', count: 10, order: 'shuffle', mode: 'instant', timer: 'off' };
      app.querySelectorAll('input[name="bch"]:checked').forEach(function (i) { o.chapters.push(i.value); });
      app.querySelectorAll('.chips[data-group]').forEach(function (g) {
        var on = g.querySelector('.chip.on');
        if (on) o[g.getAttribute('data-group')] = on.getAttribute('data-val');
      });
      app.querySelectorAll('.chips[data-multi] .chip.on').forEach(function (c) { o.types.push(c.getAttribute('data-val')); });
      o.count = +o.count;
      return o;
    }
    function syncUnits() {
      app.querySelectorAll('[data-unit]').forEach(function (u) {
        var boxes = app.querySelectorAll('input[name="bch"][data-u="' + u.getAttribute('data-unit') + '"]');
        var n = 0; boxes.forEach(function (i) { if (i.checked) n++; });
        u.checked = n === boxes.length; u.indeterminate = n > 0 && n < boxes.length;
      });
    }
    function update() {
      syncUnits();
      var o = readBuilder();
      store.set(K.builder, o);
      var n = o.types.length && o.chapters.length ? buildPool(o).length : 0;
      var take = o.count ? Math.min(o.count, n) : n;
      document.getElementById('poolCount').textContent = n + ' match' + (n === 1 ? 'es' : '') + (n ? ' · quiz of ' + take : '');
      document.getElementById('startBuilt').disabled = !n;
    }
    var builder = app.querySelector('.builder');
    builder.addEventListener('change', function (e) {
      if (e.target.hasAttribute('data-unit')) {
        var u = e.target.getAttribute('data-unit');
        app.querySelectorAll('input[name="bch"][data-u="' + u + '"]').forEach(function (i) { i.checked = e.target.checked; });
      }
      update();
    });
    builder.addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (chip) {
        if (chip.parentNode.hasAttribute('data-multi')) {
          chip.classList.toggle('on'); chip.setAttribute('aria-pressed', chip.classList.contains('on'));
        } else {
          chip.parentNode.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); });
          chip.classList.add('on'); chip.setAttribute('aria-pressed', 'true');
        }
        update();
      }
      var sel = e.target.closest('[data-sel]');
      if (sel) {
        var on = sel.getAttribute('data-sel') === 'all';
        app.querySelectorAll('input[name="bch"]').forEach(function (i) { i.checked = on; });
        update();
      }
    });
    document.getElementById('startBuilt').onclick = function () {
      var o = readBuilder();
      o.title = (o.chapters.length === 1 ? chapterById[o.chapters[0]].title :
        o.chapters.length === chapters.length ? 'Custom quiz · all chapters' : 'Custom quiz · ' + o.chapters.length + ' chapters') +
        (o.types.length === 1 ? ' · ' + TYPES[o.types[0]].label : '');
      startQuiz(o);
    };
    update();
  }
  function quick(icon, title, sub, opts, avail) {
    return '<button class="card quick"' + quizAttr(opts) + (avail ? '' : ' disabled') + '>' +
      '<span class="quick-ico">' + icon + '</span><b>' + esc(title) + '</b><span class="small muted">' + esc(sub) + '</span></button>';
  }
  function chipGroup(label, group, list, current) {
    return '<div class="field"><div class="field-label">' + label + '</div><div class="chips" data-group="' + group + '">' +
      list.map(function (it) {
        var on = String(it[0]) === String(current);
        return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-val="' + esc(it[0]) + '" aria-pressed="' + on + '">' + esc(it[1]) + '</button>';
      }).join('') + '</div></div>';
  }
  function multiChips(label, group, list, current) {
    return '<div class="field"><div class="field-label">' + label + '</div><div class="chips" data-multi="' + group + '">' +
      list.map(function (it) {
        var on = current.indexOf(it[0]) >= 0;
        return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-val="' + esc(it[0]) + '" aria-pressed="' + on + '">' + esc(it[1]) + '</button>';
      }).join('') + '</div></div>';
  }

  // =====================================================================
  // Quiz player (one question at a time, any format)
  // =====================================================================
  function renderQuiz() {
    var s = store.get(K.quiz, null);
    if (!s || !s.ids || !s.ids.length) {
      app.innerHTML = '<div class="card empty"><h2>No quiz in progress</h2><p>Start one from the practice page.</p><a class="btn" href="#/practice">Go to practice</a></div>';
      return;
    }
    if (s.done) return renderQuizSummary(s);
    var qs = s.ids.map(function (id) { return itemById[id]; }).filter(Boolean);
    var timer = null;

    // only write back if this is still the active quiz (a new one may have been started meanwhile)
    function save() {
      var cur = store.get(K.quiz, null);
      if (!cur || cur.token === s.token) store.set(K.quiz, s);
    }
    function isRevealed(q) { return s.mode === 'instant' && hasResp(s.answers[q.id]); }

    function draw() {
      var q = qs[s.idx], resp = s.answers[q.id];
      var answered = Object.keys(s.answers).length;
      var correctSoFar = qs.filter(function (x) { return isCorrect(x, s.answers[x.id]); }).length;
      var rev = isRevealed(q);
      var html = '<div class="quiz">' +
        '<div class="quiz-bar card"><div class="quiz-title"><a href="#/practice" class="muted small">← Practice</a><b>' + esc(s.title) + '</b></div>' +
        '<div class="quiz-meta">' +
        (s.mode === 'instant' ? '<span class="pill good" title="Correct so far">✓ ' + correctSoFar + '</span><span class="pill streak" title="Current streak">🔥 ' + s.streak + '</span>' :
          '<span class="pill">' + answered + ' / ' + qs.length + ' answered</span>') +
        '<span class="timer" id="qTimer">' + timerText() + '</span>' +
        '<button class="btn sm ghost" id="finishBtn">Finish</button></div></div>' +
        '<div class="quiz-progress">' + bar((s.idx + 1) / qs.length * 100) + '<span class="small muted">Question ' + (s.idx + 1) + ' of ' + qs.length + '</span></div>' +
        '<div class="card mcq quiz-card" data-id="' + esc(q.id) + '">' + itemHead(q, '') +
        itemBody(q, { resp: resp, reveal: rev, locked: rev, exam: s.mode === 'exam' }) + '</div>' +
        '<div class="quiz-nav"><button class="btn ghost" id="prevBtn"' + (s.idx === 0 ? ' disabled' : '') + '>← Previous</button>' +
        (s.idx < qs.length - 1 ? '<button class="btn" id="nextBtn">' + (hasResp(resp) || s.mode === 'exam' ? 'Next →' : 'Skip →') + '</button>' :
          '<button class="btn" id="endBtn">Finish quiz ✓</button>') + '</div>' +
        '<div class="card dots-card"><div class="omr">' + qs.map(function (x, i) {
          var a = s.answers[x.id], cls = '';
          if (hasResp(a)) cls = s.mode === 'instant' ? (isCorrect(x, a) ? 'r-ok' : 'r-no') : 'done';
          if (i === s.idx) cls += ' current';
          return '<button class="' + cls + '" data-go="' + i + '">' + (i + 1) + '</button>';
        }).join('') + '</div><p class="small muted kbd-help">Keys: <kbd>1</kbd>–<kbd>4</kbd> or <kbd>A</kbd>–<kbd>D</kbd> answer (<kbd>T</kbd>/<kbd>F</kbd> for true/false) · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>S</kbd> bookmark</p></div>' +
        '</div>';
      app.innerHTML = html;

      document.getElementById('prevBtn').onclick = function () { go(s.idx - 1); };
      var nb = document.getElementById('nextBtn'); if (nb) nb.onclick = function () { go(s.idx + 1); };
      var eb = document.getElementById('endBtn'); if (eb) eb.onclick = finishAsk;
      document.getElementById('finishBtn').onclick = finishAsk;
      wireItems(app.querySelector('.quiz-card'), {
        respond: function (id, r) { choose(r); },
        override: function () {
          var it = qs[s.idx];
          s.answers[it.id] = it.answer; recordAnswer(it, it.answer);
          s.streak++; s.best = Math.max(s.best, s.streak);
          save(); draw();
        }
      });
      app.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { go(+b.getAttribute('data-go')); }; });
      if (!rev) {
        var inp = app.querySelector('.quiz-card .fb-input');
        if (inp && !('ontouchstart' in window)) inp.focus();
      }
    }
    function timerText() {
      return s.limit ? '⏱ ' + fmtTime(s.limit - s.elapsed) : '⏱ ' + fmtTime(s.elapsed);
    }
    function go(i) {
      if (i < 0 || i >= qs.length) return;
      s.idx = i; save(); draw();
    }
    function choose(r) {
      var q = qs[s.idx];
      if (isRevealed(q)) return;
      s.answers[q.id] = r;
      if (s.mode === 'instant') {
        recordAnswer(q, r);
        if (isCorrect(q, r)) {
          s.streak++; s.best = Math.max(s.best, s.streak);
          if (s.streak % 5 === 0) toast('🔥 ' + s.streak + ' in a row!');
        } else s.streak = 0;
      }
      save(); draw();
      if (s.mode === 'exam' && s.idx < qs.length - 1) setTimeout(function () { if (!s.done && qs[s.idx] === q) go(s.idx + 1); }, 250);
    }
    function finishAsk() {
      var left = qs.length - Object.keys(s.answers).length;
      if (left && !confirm(left + ' question(s) not answered. Finish anyway?')) return;
      finish();
    }
    function finish() {
      if (timer) clearInterval(timer);
      if (s.mode === 'exam') qs.forEach(function (q) { if (hasResp(s.answers[q.id])) recordAnswer(q, s.answers[q.id]); });
      s.done = true;
      var score = qs.filter(function (q) { return isCorrect(q, s.answers[q.id]); }).length;
      var hist = store.get(K.quizHist, []);
      hist.unshift({ title: s.title, score: score, total: qs.length, secs: s.elapsed, date: today() });
      store.set(K.quizHist, hist.slice(0, 30));
      save();
      renderQuizSummary(s);
      window.scrollTo(0, 0);
    }
    function onKey(e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!document.getElementById('searchOverlay').hidden) return;
      var k = e.key.toLowerCase(), q = qs[s.idx];
      var letters = q.fmt === 'opt' || q.fmt === 'tf' ? Object.keys(optMap(q)) : [];
      var n = '1234'.indexOf(k);
      if (n >= 0 && letters[n]) { e.preventDefault(); choose(letters[n]); }
      else if (k.length === 1 && letters.indexOf(k.toUpperCase()) >= 0) { e.preventDefault(); choose(k.toUpperCase()); }
      else if (k === 'arrowright' || k === 'enter') { e.preventDefault(); if (s.idx < qs.length - 1) go(s.idx + 1); else finishAsk(); }
      else if (k === 'arrowleft') { e.preventDefault(); go(s.idx - 1); }
      else if (k === 's') { var bm = app.querySelector('.quiz-card [data-bm]'); if (bm) bm.click(); }
    }

    draw();
    document.addEventListener('keydown', onKey);
    timer = setInterval(function () {
      s.elapsed++;
      var el = document.getElementById('qTimer');
      if (el) { el.textContent = timerText(); el.classList.toggle('low', !!s.limit && s.limit - s.elapsed <= 60); }
      if (s.elapsed % 5 === 0) save();
      if (s.limit && s.elapsed >= s.limit) { toast('Time is up!'); finish(); }
    }, 1000);
    onLeave(function () { clearInterval(timer); document.removeEventListener('keydown', onKey); if (!s.done) save(); });
  }

  function renderQuizSummary(s) {
    var qs = s.ids.map(function (id) { return itemById[id]; }).filter(Boolean);
    var right = [], wrong = [], skipped = [];
    qs.forEach(function (q) {
      var a = s.answers[q.id];
      (!hasResp(a) ? skipped : isCorrect(q, a) ? right : wrong).push(q);
    });
    var pct = Math.round(right.length / qs.length * 100);
    var msg = pct >= 90 ? 'Outstanding! 🎉' : pct >= 75 ? 'Great work! 👏' : pct >= 50 ? 'Good effort — review the ones you missed.' : 'Keep going — revise the notes and try again.';
    function group(keyFn) {
      var g = {};
      qs.forEach(function (q) {
        var k = keyFn(q), c = g[k] = g[k] || { r: 0, t: 0 };
        c.t++; if (isCorrect(q, s.answers[q.id])) c.r++;
      });
      return g;
    }
    var byCh = group(function (q) { return q.chapter_id || 'ext'; });
    var byType = group(function (q) { return q.kind; });
    var redo = wrong.concat(skipped).map(function (q) { return q.id; });
    var filter = 'wrong';

    function table(title, g, labelFn, linkFn) {
      if (Object.keys(g).length < 2) return '';
      return '<div class="card"><h3>' + title + '</h3><div class="table-wrap plain"><table><tbody>' +
        Object.keys(g).map(function (k) {
          var c = g[k], p = Math.round(c.r / c.t * 100);
          return '<tr><td>' + esc(labelFn(k)) + '</td><td class="nowrap">' + c.r + ' / ' + c.t + '</td><td style="min-width:110px">' + bar(p) + '</td>' +
            '<td class="nowrap">' + (p < 60 && linkFn ? linkFn(k) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    }
    function list() {
      var shown = filter === 'all' ? qs : filter === 'wrong' ? wrong.concat(skipped) : right;
      if (!shown.length) return '<div class="card empty">' + (filter === 'wrong' ? 'Nothing to review — every answer was correct! 🎉' : 'No questions here.') + '</div>';
      return shown.map(function (q) {
        return '<div class="card mcq">' + itemHead(q, 'Q' + (qs.indexOf(q) + 1)) +
          itemBody(q, { resp: s.answers[q.id], reveal: true, locked: true, noOverride: true }) + '</div>';
      }).join('');
    }
    function draw() {
      var tables = table('By chapter', byCh, function (k) { return k === 'ext' ? 'Beyond syllabus' : (chapterById[k] || {}).title || k; },
        function (k) { return k === 'ext' ? '' : '<a href="#/notes/' + k + '">Revise notes →</a>'; }) +
        table('By format', byType, function (k) { return TYPES[k].label; }, function (k) { return '<a href="#/browse/all?type=' + k + '">Practise →</a>'; });
      app.innerHTML = '<div class="crumbs"><a href="#/practice">Practice</a> / Result</div>' +
        '<div class="card result-card"><div class="result-grid">' + ring(pct, 'score', 140) +
        '<div><p class="muted" style="margin:0">' + esc(s.title) + '</p><div class="result-big">' + right.length + ' / ' + qs.length + '</div>' +
        '<p style="margin:0 0 12px">' + msg + '</p>' +
        '<div class="btn-row"><span class="pill good">✓ ' + right.length + ' correct</span><span class="pill bad">✗ ' + wrong.length + ' wrong</span>' +
        (skipped.length ? '<span class="pill">– ' + skipped.length + ' skipped</span>' : '') +
        '<span class="pill">⏱ ' + fmtTime(s.elapsed) + '</span>' + (s.best > 1 ? '<span class="pill streak">🔥 best streak ' + s.best + '</span>' : '') + '</div></div></div>' +
        '<div class="btn-row" style="margin-top:18px">' +
        (redo.length ? '<button class="btn"' + quizAttr({ ids: redo, order: 'shuffle', mode: s.mode, title: 'Retry: ' + s.title }) + '>↺ Retry the ' + redo.length + ' you missed</button>' : '') +
        '<button class="btn ghost"' + quizAttr({ ids: s.ids, order: 'shuffle', mode: s.mode, limit: s.limit, title: s.title }) + '>Same questions again</button>' +
        '<a class="btn ghost" href="#/practice">New quiz</a></div></div>' +
        (tables ? '<div class="grid grid-2 section">' + tables + '</div>' : '') +
        '<div class="section"><div class="section-title"><h2>Review</h2><div class="chips" id="revFilter">' +
        [['wrong', 'Missed (' + (wrong.length + skipped.length) + ')'], ['right', 'Correct (' + right.length + ')'], ['all', 'All (' + qs.length + ')']].map(function (f) {
          return '<button class="chip' + (f[0] === filter ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>';
        }).join('') + '</div></div><div id="revList">' + list() + '</div></div>';
      document.getElementById('revFilter').onclick = function (e) {
        var c = e.target.closest('[data-f]');
        if (!c) return;
        filter = c.getAttribute('data-f');
        var y = window.scrollY; draw(); window.scrollTo(0, y);
      };
    }
    draw();
  }

  // =====================================================================
  // Browse the question bank (list view with filters)
  // =====================================================================
  function renderBrowse(chId, qs) {
    var type = qs.type || 'all', diff = qs.diff || 'all', status = qs.status || 'all', text = qs.q || '', page = Math.max(1, +(qs.page || 1));
    if (chId !== 'all' && chId !== 'ext' && !chapterById[chId]) chId = 'all';
    if (type !== 'all' && !TYPES[type]) type = 'all';
    var scope = itemsFor(chId);
    var list = scope;
    if (type !== 'all' && chId !== 'ext') list = list.filter(function (q) { return q.kind === type; });
    if (diff !== 'all') list = list.filter(function (q) { return q.difficulty === diff; });
    if (status === 'new') list = list.filter(function (q) { return !hasResp(progress[q.id]); });
    if (status === 'wrong') list = list.filter(isWrong);
    if (status === 'done') list = list.filter(function (q) { return hasResp(progress[q.id]); });
    if (status === 'bookmarked') list = list.filter(function (q) { return bookmarks[q.id]; });
    if (text) {
      var t = text.toLowerCase();
      list = list.filter(function (q) { return itemText(q).toLowerCase().indexOf(t) >= 0; });
    }
    var pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (page > pages) page = pages;
    var slice = list.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    var chOpts = '<option value="all">All chapters</option>' + (D.syllabus || []).map(function (u) {
      return '<optgroup label="' + esc(u.unit) + '">' + u.chapters.map(function (c) {
        return '<option value="' + c.chapter_id + '"' + (c.chapter_id === chId ? ' selected' : '') + '>' + esc(c.title) + ' (' + itemsFor(c.chapter_id).length + ')</option>';
      }).join('') + '</optgroup>';
    }).join('') + (extItems.length ? '<option value="ext"' + (chId === 'ext' ? ' selected' : '') + '>＋ Beyond syllabus (' + extItems.length + ')</option>' : '');
    var typeOpts = '<option value="all">All formats</option>' + KINDS.map(function (k) {
      var n = itemsFor(chId === 'ext' ? 'all' : chId).filter(function (q) { return q.kind === k; }).length;
      return n ? '<option value="' + k + '"' + (k === type ? ' selected' : '') + '>' + esc(TYPES[k].label) + ' (' + n + ')</option>' : '';
    }).join('');
    var heading = chId === 'ext' ? 'Beyond the syllabus' : chId === 'all' ? (type === 'all' ? 'Question bank' : TYPES[type].label) : chapterById[chId].title;

    var html = '<div class="crumbs"><a href="#/practice">Practice</a> / Browse</div>' +
      '<div class="page-head"><h1>' + esc(heading) + '</h1><p>Answer right here to check yourself. Use ↺ Try again to reset a question, ☆ to bookmark it.</p></div>' +
      '<div class="filters">' +
      '<input type="search" id="fText" placeholder="Search questions…" value="' + esc(text) + '">' +
      '<select id="fCh">' + chOpts + '</select>' +
      (chId === 'ext' ? '' : '<select id="fType">' + typeOpts + '</select>') +
      '<select id="fDiff"><option value="all">Any difficulty</option>' + ['easy', 'medium', 'hard'].map(function (d) {
        return '<option value="' + d + '"' + (d === diff ? ' selected' : '') + '>' + cap(d) + '</option>';
      }).join('') + '</select>' +
      '<select id="fStatus">' + [['all', 'All questions'], ['new', 'Not attempted'], ['wrong', 'Answered wrong'], ['done', 'Attempted'], ['bookmarked', 'Bookmarked ★']].map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === status ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div class="score-strip" id="scoreStrip">' + scoreStrip(stats(scope)) + '</div>' +
      '<div class="btn-row" style="margin-bottom:16px"><span class="muted small" style="align-self:center">' + plural(list.length, 'question') + ' shown</span>' +
      (list.length ? '<button class="btn sm"' + quizAttr({ ids: list.map(function (q) { return q.id; }), order: 'shuffle', title: heading }) + '>Quiz these ' + list.length + '</button>' : '') +
      '<button class="btn ghost sm" id="resetBtn">Reset answers</button></div>';

    if (!slice.length) html += '<div class="card empty">No questions match these filters.</div>';
    html += '<div id="mcqList">' + slice.map(function (q, i) { return itemCard(q, (page - 1) * PER_PAGE + i + 1); }).join('') + '</div>';
    html += pager(page, pages);
    app.innerHTML = html;

    function go(o) {
      var n = { ch: chId, type: type, diff: diff, status: status, q: text, page: 1 };
      for (var k in o) n[k] = o[k];
      var parts = [];
      if (n.type !== 'all' && n.ch !== 'ext') parts.push('type=' + n.type);
      if (n.diff !== 'all') parts.push('diff=' + n.diff);
      if (n.status !== 'all') parts.push('status=' + n.status);
      if (n.q) parts.push('q=' + encodeURIComponent(n.q));
      if (n.page > 1) parts.push('page=' + n.page);
      location.hash = '#/browse/' + n.ch + (parts.length ? '?' + parts.join('&') : '');
    }
    document.getElementById('fCh').onchange = function () { go({ ch: this.value }); };
    var ftp = document.getElementById('fType'); if (ftp) ftp.onchange = function () { go({ type: this.value }); };
    document.getElementById('fDiff').onchange = function () { go({ diff: this.value }); };
    document.getElementById('fStatus').onchange = function () { go({ status: this.value }); };
    var ft = document.getElementById('fText'), tmr;
    ft.oninput = function () { clearTimeout(tmr); tmr = setTimeout(function () { go({ q: ft.value.trim() }); }, 400); };
    if (text) { ft.focus(); ft.setSelectionRange(ft.value.length, ft.value.length); }
    document.getElementById('resetBtn').onclick = function () {
      if (!confirm('Clear saved answers for the ' + list.length + ' questions shown?')) return;
      list.forEach(function (q) { delete progress[q.id]; });
      store.set(K.progress, progress);
      route();
    };
    app.querySelectorAll('.pager button').forEach(function (b) {
      b.onclick = function () { go({ page: +b.getAttribute('data-page') }); };
    });
    wireBrowse(document.getElementById('mcqList'), function () {
      document.getElementById('scoreStrip').innerHTML = scoreStrip(stats(scope));
    });
  }
  function pager(page, pages) {
    if (pages < 2) return '';
    var html = '<div class="pager">';
    html += '<button data-page="' + Math.max(1, page - 1) + '"' + (page === 1 ? ' disabled' : '') + '>‹</button>';
    for (var p = 1; p <= pages; p++) {
      if (pages > 9 && p !== 1 && p !== pages && Math.abs(p - page) > 2) {
        if (p === 2 || p === pages - 1) html += '<span class="muted">…</span>';
        continue;
      }
      html += '<button data-page="' + p + '"' + (p === page ? ' class="active"' : '') + '>' + p + '</button>';
    }
    return html + '<button data-page="' + Math.min(pages, page + 1) + '"' + (page === pages ? ' disabled' : '') + '>›</button></div>';
  }
  function scoreStrip(s) {
    return '<span class="pill">' + s.done + ' / ' + s.total + ' attempted</span>' +
      '<span class="pill good">✓ ' + s.right + ' correct</span>' +
      '<span class="pill bad">✗ ' + s.wrong + ' wrong</span>' +
      '<div style="flex:1;min-width:140px">' + bar(s.total ? s.done / s.total * 100 : 0) + '</div>';
  }
  function renderSingleItem(id) {
    var q = itemById[id];
    if (!q) { app.innerHTML = '<div class="card empty">Question not found. <a href="#/practice">Back to practice</a></div>'; return; }
    app.innerHTML = '<div class="crumbs"><a href="#/browse/' + (q.chapter_id || 'ext') + (q.chapter_id ? '?type=' + q.kind : '') + '">← More like this</a></div><div id="mcqList">' + itemCard(q, 0) + '</div>';
    wireBrowse(document.getElementById('mcqList'));
  }

  // =====================================================================
  // Short answers (with self-rating)
  // =====================================================================
  function renderShort(chId, qs) {
    var all = (D.question_bank && D.question_bank.short_answer) || [];
    var openId = qs.open, status = qs.status || 'all', text = qs.q || '';
    if (openId && chId === 'all') {
      var hit = all.filter(function (s) { return s.id === openId; })[0];
      if (hit) chId = hit.chapter_id;
    }
    var list = chId === 'all' ? all : all.filter(function (s) { return s.chapter_id === chId; });
    var scope = list;
    if (status === 'know') list = list.filter(function (s) { return saSelf[s.id] === 'know'; });
    if (status === 'review') list = list.filter(function (s) { return saSelf[s.id] === 'review'; });
    if (status === 'unrated') list = list.filter(function (s) { return !saSelf[s.id]; });
    if (text) {
      var t = text.toLowerCase();
      list = list.filter(function (s) { return (s.question + ' ' + s.answer).toLowerCase().indexOf(t) >= 0; });
    }
    var nKnow = scope.filter(function (s) { return saSelf[s.id] === 'know'; }).length;
    var nRev = scope.filter(function (s) { return saSelf[s.id] === 'review'; }).length;

    var chOpts = '<option value="all">All chapters (' + all.length + ')</option>' + chapters.map(function (c) {
      var n = all.filter(function (s) { return s.chapter_id === c.chapter_id; }).length;
      return n ? '<option value="' + c.chapter_id + '"' + (c.chapter_id === chId ? ' selected' : '') + '>' + esc(c.title) + ' (' + n + ')</option>' : '';
    }).join('');
    var html = '<div class="page-head"><h1>Short answer questions</h1><p>Answer in your head first, then reveal the model answer and rate yourself. "Revise again" questions are easy to find later.</p></div>' +
      '<div class="filters"><input type="search" id="sText" placeholder="Search…" value="' + esc(text) + '"><select id="sCh">' + chOpts + '</select>' +
      '<select id="sStatus">' + [['all', 'All'], ['unrated', 'Not rated yet'], ['review', 'Revise again ↻'], ['know', 'I knew it ✓']].map(function (o) {
        return '<option value="' + o[0] + '"' + (o[0] === status ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div class="score-strip"><span class="pill good">✓ ' + nKnow + ' known</span><span class="pill bad">↻ ' + nRev + ' to revise</span><span class="pill">' + (scope.length - nKnow - nRev) + ' not rated</span>' +
      '<div style="flex:1;min-width:140px">' + bar(scope.length ? nKnow / scope.length * 100 : 0) + '</div>' +
      '<button class="btn ghost sm" id="expandAll">Show all</button><button class="btn ghost sm" id="collapseAll">Hide all</button></div>';
    var lastCh = null;
    list.forEach(function (s) {
      if (chId === 'all' && s.chapter_id !== lastCh) {
        lastCh = s.chapter_id;
        html += '<h3 style="margin:24px 0 10px">' + esc((chapterById[s.chapter_id] || {}).title || s.chapter) + '</h3>';
      }
      var r = saSelf[s.id];
      html += '<details class="qa' + (r ? ' rated-' + r : '') + '" id="' + esc(s.id) + '"' + (s.id === openId ? ' open' : '') + '><summary><span class="qid">' + esc(s.id) + '</span><span>' + markTerms(s.question, [text]) +
        '</span>' + (r ? '<span class="rate-badge">' + (r === 'know' ? '✓' : '↻') + '</span>' : '') +
        '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></summary>' +
        '<div class="ans">' + markTerms(s.answer, [text]).replace(/\n/g, '<br>') +
        '<div class="rate-row"><span class="small muted">How did you do?</span>' +
        '<button class="btn sm ' + (r === 'know' ? '' : 'ghost') + '" data-rate="know" data-sid="' + esc(s.id) + '">✓ I knew it</button>' +
        '<button class="btn sm ' + (r === 'review' ? 'warn' : 'ghost') + '" data-rate="review" data-sid="' + esc(s.id) + '">↻ Revise again</button></div></div></details>';
    });
    if (!list.length) html += '<div class="card empty">No short answers match.</div>';
    app.innerHTML = html;

    function go(o) {
      var n = { ch: chId, status: status, q: text };
      for (var k in o) n[k] = o[k];
      var parts = [];
      if (n.status !== 'all') parts.push('status=' + n.status);
      if (n.q) parts.push('q=' + encodeURIComponent(n.q));
      location.hash = '#/short/' + n.ch + (parts.length ? '?' + parts.join('&') : '');
    }
    document.getElementById('sCh').onchange = function () { go({ ch: this.value }); };
    document.getElementById('sStatus').onchange = function () { go({ status: this.value }); };
    var st = document.getElementById('sText'), tmr;
    st.oninput = function () { clearTimeout(tmr); tmr = setTimeout(function () { go({ q: st.value.trim() }); }, 400); };
    if (text) { st.focus(); st.setSelectionRange(st.value.length, st.value.length); }
    document.getElementById('expandAll').onclick = function () { app.querySelectorAll('details.qa').forEach(function (d) { d.open = true; }); };
    document.getElementById('collapseAll').onclick = function () { app.querySelectorAll('details.qa').forEach(function (d) { d.open = false; }); };
    if (openId) { var el = document.getElementById(openId); if (el && !qs.status) el.scrollIntoView({ block: 'center' }); }
  }

  // update a short answer's self-rating in place (no re-render, so the list doesn't jump)
  function rateShort(id, v) {
    if (saSelf[id] === v) delete saSelf[id]; else saSelf[id] = v;
    store.set(K.sa, saSelf);
    var r = saSelf[id];
    var d = document.getElementById(id);
    if (!d) return;
    d.classList.remove('rated-know', 'rated-review');
    if (r) d.classList.add('rated-' + r);
    var badge = d.querySelector('.rate-badge');
    if (r) {
      if (!badge) {
        badge = document.createElement('span'); badge.className = 'rate-badge';
        d.querySelector('summary').insertBefore(badge, d.querySelector('summary .chev'));
      }
      badge.textContent = r === 'know' ? '✓' : '↻';
    } else if (badge) badge.remove();
    d.querySelectorAll('[data-rate]').forEach(function (b) {
      var on = b.getAttribute('data-rate') === r;
      b.classList.toggle('ghost', !on);
      b.classList.toggle('warn', on && r === 'review');
    });
    if (r === 'know') toast('Nice! Marked as known');
    if (r === 'review') toast('Added to "Revise again"');
  }

  // =====================================================================
  // Programs
  // =====================================================================
  function renderPrograms(qs) {
    var all = (D.question_bank && D.question_bank.programs) || [];
    var chId = qs.ch || 'all', text = qs.q || '', openId = qs.open;
    var hide = !!store.get(K.hideCode, false);
    var list = all.filter(function (p) {
      if (chId !== 'all' && p.chapter_id !== chId) return false;
      return !text || (p.question + ' ' + p.answer_code).toLowerCase().indexOf(text.toLowerCase()) >= 0;
    });
    var chIds = [];
    all.forEach(function (p) { if (chIds.indexOf(p.chapter_id) < 0) chIds.push(p.chapter_id); });

    var html = '<div class="page-head"><h1>Python programs</h1><p>Important programs with complete code and sample output. Turn on practice mode to try writing each one before you look.</p></div>' +
      '<div class="filters"><input type="search" id="pText" placeholder="Search programs…" value="' + esc(text) + '">' +
      '<label class="toggle"><input type="checkbox" id="hideCode"' + (hide ? ' checked' : '') + '> Practice mode (hide code)</label></div>' +
      '<div class="chips" style="margin-bottom:18px">' +
      '<a class="chip' + (chId === 'all' ? ' on' : '') + '" href="#/programs">All (' + all.length + ')</a>' +
      chIds.map(function (id) {
        var n = all.filter(function (p) { return p.chapter_id === id; }).length;
        return '<a class="chip' + (chId === id ? ' on' : '') + '" href="#/programs?ch=' + id + '">' + esc((chapterById[id] || {}).title || id) + ' (' + n + ')</a>';
      }).join('') + '</div>';

    var byCh = {};
    list.forEach(function (p) { (byCh[p.chapter_id] = byCh[p.chapter_id] || []).push(p); });
    var n = 0;
    chapters.forEach(function (c) {
      if (!byCh[c.chapter_id]) return;
      html += '<h2 style="margin:28px 0 12px">' + esc(c.title) + '</h2>';
      byCh[c.chapter_id].forEach(function (p) {
        n++;
        var code = codeBlock(p.answer_code || '', 'Python') + (p.sample_output ? '<div class="output">' + esc(p.sample_output) + '</div>' : '');
        html += '<div class="card program" id="' + esc(p.id) + '"><div class="mcq-head"><span class="small muted mono">' + esc(p.id) + '</span></div>' +
          '<h3>' + n + '. ' + markTerms(p.question, [text]) + '</h3>' +
          (hide ? '<details class="reveal"' + (p.id === openId ? ' open' : '') + '><summary>Show solution</summary>' + code + '</details>' : code) + '</div>';
      });
    });
    if (!list.length) html += '<div class="card empty">No programs match.</div>';
    app.innerHTML = html;

    var pt = document.getElementById('pText'), tmr;
    pt.oninput = function () {
      clearTimeout(tmr);
      tmr = setTimeout(function () {
        var v = pt.value.trim();
        location.hash = '#/programs?' + (chId !== 'all' ? 'ch=' + chId + '&' : '') + (v ? 'q=' + encodeURIComponent(v) : '');
      }, 400);
    };
    if (text) { pt.focus(); pt.setSelectionRange(pt.value.length, pt.value.length); }
    document.getElementById('hideCode').onchange = function () {
      store.set(K.hideCode, this.checked);
      var y = window.scrollY; renderPrograms(qs); window.scrollTo(0, y);
    };
    if (openId) { var el = document.getElementById(openId); if (el) el.scrollIntoView({ block: 'start' }); }
  }

  // =====================================================================
  // Mock tests (board-pattern papers + practice papers)
  // =====================================================================
  function mockSummary(id) {
    var h = mockHist[id] || [];
    var best = h.reduce(function (b, x) { return !b || x.score > b.score ? x : b; }, null);
    return { attempts: h.length, best: best, last: h[h.length - 1] };
  }
  function mockCard(mk) {
    var t = mk.t, sm = mockSummary(mk.id);
    var run = store.get(K.mockRun + mk.id, null);
    var inProgress = run && !run.submitted && run.started;
    var mix = t.type_mix || t.difficulty_mix;
    var mixLabels = { mcq: 'MCQ', output: 'Output', ar: 'A–R', match: 'Match', 'case': 'Case', easy: 'Easy', medium: 'Medium', hard: 'Hard' };
    return '<div class="card mock-card' + (mk.id === 'MOCK-HARD' ? ' hard-mock' : '') + '"><div class="mcq-head"><h3 style="margin:0">' + esc(mk.title) + '</h3>' +
      (inProgress ? '<span class="tag medium">In progress</span>' : sm.best ? '<span class="tag easy">Best ' + sm.best.score + '/' + sm.best.total + '</span>' : '') + '</div>' +
      '<p class="muted small">' + mk.list.length + ' questions · ' + esc(t.total_marks) + ' marks · ' + esc(t.suggested_duration_minutes) + ' min' +
      (t.negative_marking ? ' · negative marking' : '') + '</p>' +
      (mix ? '<div class="btn-row mix">' + Object.keys(mix).filter(function (k) { return mix[k]; }).map(function (k) {
        return '<span class="tag">' + esc(mixLabels[k] || k) + ' ' + mix[k] + '</span>';
      }).join('') + '</div>' : '') +
      (sm.attempts ? '<p class="small muted">' + plural(sm.attempts, 'attempt') + ' · last ' + sm.last.score + '/' + sm.last.total + '</p>' : '<p class="small muted">Not attempted yet</p>') +
      '<a class="btn" href="#/mock/' + esc(mk.id) + '">' + (inProgress ? 'Resume' : run && run.submitted ? 'View result' : sm.attempts ? 'Retake' : 'Start') + '</a></div>';
  }
  function renderMockIndex() {
    var board = mocks.filter(function (m) { return m.group === 'board'; });
    var prac = mocks.filter(function (m) { return m.group === 'practice'; });
    var note = board[0] && board[0].t.pattern_note;
    var html = '<div class="page-head"><h1>Mock tests</h1><p>Full 35-mark papers. Answers are saved as you go — leave and resume later (the timer pauses while you are away).</p></div>';
    if (board.length) {
      html += '<div class="section-title"><h2>Board-pattern papers <span class="tag easy">recommended</span></h2></div>' +
        (note ? '<p class="muted small" style="margin-top:-6px">' + esc(note) + '</p>' : '') +
        '<div class="grid grid-3">' + board.map(mockCard).join('') + '</div>';
    }
    if (prac.length) {
      html += '<div class="section-title section"><h2>Practice papers</h2><span class="muted small">MCQ-only papers, including a hard challenge paper</span></div>' +
        '<div class="grid grid-3">' + prac.map(mockCard).join('') + '</div>';
    }
    html += '<div class="grid grid-3 section"><div class="card mock-card random-mock"><h3>🎲 Random paper</h3>' +
      '<p class="muted small">A fresh paper every time: 25 Python + 10 E-Commerce questions in every OMR format (MCQ, output, case, A–R, column match), picked from the whole bank. 75 min · answers at the end.</p>' +
      '<button class="btn"' + quizAttr({ random: true, title: 'Random board-style paper' }) + '>Generate paper</button></div></div>';
    app.innerHTML = html;
  }

  function renderMock(id) {
    var mk = mockById[id];
    if (!mk) { app.innerHTML = '<div class="card empty">Mock test not found. <a href="#/mock">Back</a></div>'; return; }
    var t = mk.t, list = mk.list;
    var dur = (t.suggested_duration_minutes || 60) * 60;
    var runKey = K.mockRun + id;
    var run = store.get(runKey, null) || { answers: {}, flags: {}, secondsLeft: dur, started: false, submitted: false };
    var timer = null;
    var reviewFilter = 'all';

    function keyOf(x) { return correctKey(x.it, x.key); }
    function save() { store.set(runKey, run); }

    function intro() {
      var sm = mockSummary(id);
      var resumable = run.started && !run.submitted;
      app.innerHTML = '<div class="crumbs"><a href="#/mock">Mock tests</a> / ' + esc(mk.title) + '</div>' +
        '<div class="card intro-card"><h1>' + esc(mk.title) + '</h1>' +
        (t.pattern_note ? '<p class="muted">' + esc(t.pattern_note) + '</p>' : '') +
        '<div class="grid grid-4" style="margin:18px 0">' + stat(list.length, 'Questions') + stat(t.total_marks, 'Marks') + stat(t.suggested_duration_minutes + ' min', 'Suggested time') + stat(t.negative_marking ? 'Yes' : 'No', 'Negative marking') + '</div>' +
        '<ul class="instructions"><li>Each question carries ' + esc(t.marks_per_question || 1) + ' mark. Choose one option per question — just like the OMR sheet.</li>' +
        (mk.group === 'board' ? '<li>Python comes first (Q1–25), E-Commerce last (Q26–35), with assertion–reason, column matching, case-based and output questions mixed in.</li>' : '') +
        '<li>Use <b>⚑ Mark for review</b> to come back to a question; the answer sheet shows your status.</li>' +
        '<li>Your answers are saved automatically. If you leave, the timer pauses and you can resume.</li>' +
        '<li>Results show your score per unit and the explanation for every question.</li></ul>' +
        (sm.attempts ? '<p class="small muted">Previous best: ' + sm.best.score + '/' + sm.best.total + ' (' + plural(sm.attempts, 'attempt') + ')</p>' : '') +
        '<div class="btn-row">' + (resumable ?
          '<button class="btn" id="goBtn">Resume (' + fmtTime(run.secondsLeft) + ' left)</button><button class="btn ghost" id="restartBtn">Start over</button>' :
          '<button class="btn" id="goBtn">Start test</button>') + '</div></div>';
      document.getElementById('goBtn').onclick = function () { run.started = true; save(); startTimer(); draw(); };
      var rb = document.getElementById('restartBtn');
      if (rb) rb.onclick = function () {
        if (!confirm('Discard your saved answers and start again?')) return;
        run = { answers: {}, flags: {}, secondsLeft: dur, started: true, submitted: false };
        save(); startTimer(); draw();
      };
    }

    function draw() {
      var answered = Object.keys(run.answers).length, flagged = Object.keys(run.flags).length;
      var sub = run.submitted;
      var html = '<div class="crumbs"><a href="#/mock">Mock tests</a> / ' + esc(mk.title) + '</div>';
      if (sub) html += resultHtml();
      else {
        html += '<div class="mock-bar"><div><b>' + esc(mk.title) + '</b> <span class="muted small">· ' + answered + ' / ' + list.length + ' answered' + (flagged ? ' · ⚑ ' + flagged + ' marked' : '') + '</span></div>' +
          '<div class="btn-row" style="align-items:center"><span class="timer" id="timer">⏱ ' + fmtTime(run.secondsLeft) + '</span>' +
          '<button class="btn sm" id="submitBtn">Submit</button></div></div>';
      }
      html += '<div class="mock-layout"><div id="mockQs">';
      list.forEach(function (x, i) {
        var q = x.it, chosen = run.answers[q.id], ans = keyOf(x);
        if (sub && reviewFilter !== 'all') {
          var st = !chosen ? 'skip' : chosen === ans ? 'right' : 'wrong';
          if (reviewFilter === 'missed' ? st === 'right' : st !== reviewFilter) return;
        }
        var flagBtn = sub ? bmButton(q.id) : '<button class="flag-btn' + (run.flags[q.id] ? ' on' : '') + '" data-flag="' + i + '">⚑ ' + (run.flags[q.id] ? 'Marked' : 'Mark for review') + '</button>';
        html += '<div class="card mcq' + (run.flags[q.id] && !sub ? ' flagged' : '') + '" id="mq' + i + '" data-i="' + i + '">' +
          itemHead(q, 'Q' + (i + 1), flagBtn) +
          itemBody(q, { resp: chosen, reveal: sub, locked: sub, key: x.key }) +
          (!sub && chosen ? '<button class="link-btn small" data-clear="' + i + '">Clear answer</button>' : '') + '</div>';
      });
      html += '</div><aside class="card mock-side"><h3>Answer sheet</h3><div class="omr">';
      list.forEach(function (x, i) {
        var chosen = run.answers[x.it.id], cls = '';
        if (sub) cls = !chosen ? 'r-skip' : chosen === keyOf(x) ? 'r-ok' : 'r-no';
        else { if (chosen) cls = 'done'; if (run.flags[x.it.id]) cls += ' flag'; }
        html += '<button class="' + cls + '" data-jump="' + i + '">' + (i + 1) + '</button>';
      });
      html += '</div><div class="legend small muted">' + (sub ?
        '<span><i class="lg ok"></i>Correct</span><span><i class="lg no"></i>Wrong</span><span><i class="lg skip"></i>Skipped</span>' :
        '<span><i class="lg done"></i>Answered</span><span><i class="lg flag"></i>Marked</span><span><i class="lg skip"></i>Not answered</span>') + '</div>' +
        (sub ? '<div class="btn-row" style="margin-top:16px"><a class="btn sm" href="#/mock">All tests</a><button class="btn sm ghost" id="retryBtn">Retake</button></div>' : '') + '</aside></div>';
      app.innerHTML = html;

      app.querySelectorAll('[data-jump]').forEach(function (b) {
        b.onclick = function () {
          var el = document.getElementById('mq' + b.getAttribute('data-jump'));
          if (!el && sub) { reviewFilter = 'all'; draw(); el = document.getElementById('mq' + b.getAttribute('data-jump')); }
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
      });
      if (!sub) {
        document.getElementById('submitBtn').onclick = function () {
          var left = list.length - Object.keys(run.answers).length;
          var fl = Object.keys(run.flags).length;
          if ((left || fl) && !confirm((left ? left + ' unanswered' : '') + (left && fl ? ' and ' : '') + (fl ? fl + ' marked for review' : '') + '. Submit anyway?')) return;
          submit();
        };
        document.getElementById('mockQs').onclick = function (e) {
          var card = e.target.closest('[data-i]');
          if (!card) return;
          var q = list[+card.getAttribute('data-i')].it;
          var b = e.target.closest('.opt');
          if (b) run.answers[q.id] = b.getAttribute('data-letter');
          else if (e.target.closest('[data-flag]')) { if (run.flags[q.id]) delete run.flags[q.id]; else run.flags[q.id] = 1; }
          else if (e.target.closest('[data-clear]')) delete run.answers[q.id];
          else return;
          save();
          var y = window.scrollY; draw(); window.scrollTo(0, y);
        };
      } else {
        document.getElementById('retryBtn').onclick = function () {
          run = { answers: {}, flags: {}, secondsLeft: dur, started: false, submitted: false };
          save(); intro();
        };
        var rf = document.getElementById('reviewFilter');
        if (rf) rf.onclick = function (e) {
          var c = e.target.closest('[data-f]');
          if (!c) return;
          reviewFilter = c.getAttribute('data-f');
          var y = window.scrollY; draw(); window.scrollTo(0, y);
        };
      }
    }

    function resultHtml() {
      var score = 0, skipped = 0, units = {}, types = {};
      list.forEach(function (x) {
        var q = x.it, a = run.answers[q.id], ok = a === keyOf(x);
        var u = units[q.unit] = units[q.unit] || { right: 0, total: 0 };
        var ty = types[q.kind] = types[q.kind] || { right: 0, total: 0 };
        u.total++; ty.total++;
        if (!a) skipped++;
        else if (ok) { score++; u.right++; ty.right++; }
      });
      var mpq = t.marks_per_question || 1;
      var pct = Math.round(score / list.length * 100);
      var msg = pct >= 90 ? 'Outstanding! 🎉' : pct >= 75 ? 'Great work! 👏' : pct >= 50 ? 'Good — review the ones you missed.' : 'Keep practising — revise the notes and try again.';
      var hist = mockHist[id] || [];
      return '<div class="card result-card"><div class="result-grid">' + ring(pct, 'score', 140) +
        '<div><p class="muted" style="margin:0">Your score</p><div class="result-big">' + score * mpq + ' / ' + list.length * mpq + '</div><p style="margin:0 0 10px">' + msg + '</p>' +
        '<div class="btn-row"><span class="pill good">✓ ' + score + '</span><span class="pill bad">✗ ' + (list.length - score - skipped) + '</span><span class="pill">– ' + skipped + ' skipped</span>' +
        (run.secsUsed != null ? '<span class="pill">⏱ ' + fmtTime(run.secsUsed) + '</span>' : '') + '</div></div>' +
        '<div>' + Object.keys(units).map(function (k) {
          var u = units[k];
          return '<p style="margin:0 0 4px"><span class="tag ' + unitClass(k) + '">' + esc(k) + '</span> <b>' + u.right + ' / ' + u.total + '</b></p>' +
            '<div style="margin-bottom:12px">' + bar(u.right / u.total * 100) + '</div>';
        }).join('') + '</div></div>' +
        (Object.keys(types).length > 1 ? '<div class="type-results">' + Object.keys(types).map(function (k) {
          return '<span class="pill">' + TYPES[k].icon + ' ' + esc(TYPES[k].label) + ' <b>' + types[k].right + '/' + types[k].total + '</b></span>';
        }).join('') + '</div>' : '') +
        (hist.length > 1 ? '<div class="hist-row small muted">Attempts: ' + hist.map(function (h) { return '<span class="pill">' + h.score + '/' + h.total + '</span>'; }).join(' ') + '</div>' : '') +
        '</div>' +
        '<div class="section-title section"><h2>Review</h2><div class="chips" id="reviewFilter">' +
        [['all', 'All'], ['missed', 'Missed'], ['wrong', 'Wrong'], ['skip', 'Skipped'], ['right', 'Correct']].map(function (f) {
          return '<button class="chip' + (f[0] === reviewFilter ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>';
        }).join('') + '</div></div>';
    }

    function submit() {
      if (timer) { clearInterval(timer); timer = null; }
      var score = list.filter(function (x) { return run.answers[x.it.id] === keyOf(x); }).length;
      run.submitted = true;
      run.secsUsed = dur - run.secondsLeft;
      list.forEach(function (x) { if (run.answers[x.it.id]) recordAnswer(x.it, run.answers[x.it.id], x.key); });
      (mockHist[id] = mockHist[id] || []).push({ score: score, total: list.length, secs: run.secsUsed, date: today() });
      store.set(K.mockHist, mockHist);
      save();
      draw();
      window.scrollTo(0, 0);
    }

    function startTimer() {
      if (timer) clearInterval(timer);
      timer = setInterval(function () {
        run.secondsLeft--;
        var el = document.getElementById('timer');
        if (el) { el.textContent = '⏱ ' + fmtTime(run.secondsLeft); el.classList.toggle('low', run.secondsLeft <= 300); }
        if (run.secondsLeft % 5 === 0) save();
        if (run.secondsLeft === 300) toast('5 minutes left');
        if (run.secondsLeft <= 0) { toast('Time is up — submitting your test.'); submit(); }
      }, 1000);
    }
    onLeave(function () { if (timer) clearInterval(timer); if (!run.submitted) save(); });

    if (run.submitted) draw();
    else intro();
  }

  // =====================================================================
  // Revision: quick facts, plan, glossary, keywords, traps, Sem IV
  // =====================================================================
  function renderRevision(tab, qs) {
    var tabs = [['quick', 'Quick revision'], ['plan', 'Exam tips & plan'], ['glossary', 'Glossary'], ['keywords', 'Python keywords'], ['traps', 'Exam traps']];
    if (D.sem4_reference) tabs.push(['sem4', 'Semester IV preview']);
    if (!tabs.some(function (t) { return t[0] === tab; })) tab = 'quick';
    var html = '<div class="page-head"><h1>Revision</h1><p>Everything to read in the last days before the exam.</p></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<a role="tab" class="tab' + (t[0] === tab ? ' on' : '') + '" href="#/revision/' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + esc(t[1]) + '</a>';
      }).join('') + '</div><div class="tab-body">';

    if (tab === 'quick') {
      html += '<div class="btn-row" style="margin-bottom:12px"><button class="btn sm ghost" onclick="window.print()">🖨 Print</button></div><ul class="rev-list">' +
        (D.quick_revision || []).map(function (r) { return '<li class="mono small">' + esc(r) + '</li>'; }).join('') + '</ul>';
    } else if (tab === 'plan') {
      html += '<div class="grid grid-2"><div><h2>Exam tips</h2><ul class="rev-list tips">' +
        (D.exam_tips || []).map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul></div>' +
        '<div><h2>The last night</h2>' + ((D.study_plan_last_night || []).length ? '<ol class="timeline">' + D.study_plan_last_night.map(function (p) {
          return '<li><span class="slot">' + esc(p.slot) + '</span><span>' + esc(p.task) + '</span></li>';
        }).join('') + '</ol>' : '<p class="muted">No plan in this study pack.</p>') + '</div></div>';
    } else if (tab === 'glossary') {
      var g = (D.glossary || []).slice().sort(function (a, b) { return a.term.localeCompare(b.term); });
      var q = (qs.q || '').toLowerCase();
      html += '<div class="filters"><input type="search" id="gText" placeholder="Search ' + g.length + ' terms…" value="' + esc(qs.q || '') + '">' +
        '<label class="toggle"><input type="checkbox" id="gFlash"> Flashcard mode (tap to reveal)</label></div>' +
        '<div class="gloss-grid" id="gloss">' + g.map(function (x) {
          return '<div class="card gloss" data-t="' + esc((x.term + ' ' + x.meaning_bn).toLowerCase()) + '"' + (q && (x.term + ' ' + x.meaning_bn).toLowerCase().indexOf(q) < 0 ? ' hidden' : '') + '>' +
            '<b>' + esc(x.term) + '</b><span class="gloss-m">' + esc(x.meaning_bn) + '</span></div>';
        }).join('') + '</div><p class="muted small" id="gEmpty" hidden>No terms match.</p>';
    } else if (tab === 'keywords') {
      var kw = D.python_keywords || [];
      html += '<div class="card"><p class="muted">Python 3 has <b>' + kw.length + '</b> reserved keywords. They cannot be used as variable names. Only <code class="inline-code">True</code>, <code class="inline-code">False</code> and <code class="inline-code">None</code> start with a capital letter — and <code class="inline-code">print</code> is <b>not</b> a keyword.</p>' +
        '<div class="kw-grid">' + kw.map(function (k) { return '<span class="kw' + (/^[A-Z]/.test(k) ? ' cap' : '') + '">' + esc(k) + '</span>'; }).join('') + '</div></div>';
    } else if (tab === 'traps') {
      html += '<div class="card trap-box">' + (D.study_notes || []).map(function (n) {
        return n.exam_traps && n.exam_traps.length ? '<p style="margin:0 0 4px"><b><a href="#/notes/' + n.chapter_id + '">' + esc(n.title) + '</a></b></p><ul class="traps">' +
          n.exam_traps.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '';
      }).join('') + '</div>';
    } else if (tab === 'sem4') {
      var s4 = D.sem4_reference;
      html += '<div class="card"><h2>' + esc(s4.title) + '</h2><div class="notice" style="margin-bottom:16px">' + esc(s4.note) + '</div>' +
        '<div class="grid grid-4" style="margin-bottom:18px">' + stat(s4.time, 'Time') + stat(s4.full_marks, 'Full marks') + stat('Descriptive', 'Exam type') + '</div>' +
        (s4.languages ? '<p class="small muted">Language: ' + esc(s4.languages) + '</p>' : '') +
        '<h3>Paper structure</h3><div class="table-wrap"><table><thead><tr><th>Section</th><th>Questions</th><th>Marks each</th><th>Total</th><th>Choice</th></tr></thead><tbody>' +
        (s4.sections || []).map(function (x) {
          return '<tr><td><b>' + esc(x.section) + '</b></td><td>' + esc(x.questions) + '</td><td>' + esc(x.marks_each) + '</td><td>' + esc(x.total) + '</td><td>' + esc(x.choice) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<h3 class="section">Topics asked in 2026</h3><div class="grid grid-3">' + Object.keys(s4.topics_asked || {}).map(function (k) {
          return '<div class="card"><h4>' + esc(k) + '</h4><ul class="traps small">' + s4.topics_asked[k].map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
        }).join('') + '</div>' +
        (s4.observation ? '<div class="notice section">' + esc(s4.observation) + '</div>' : '') + '</div>';
    }
    app.innerHTML = html + '</div>';

    if (tab === 'glossary') {
      var gi = document.getElementById('gText'), grid = document.getElementById('gloss');
      var filter = function () {
        var v = gi.value.trim().toLowerCase(), n = 0;
        grid.querySelectorAll('.gloss').forEach(function (c) { var ok = !v || c.getAttribute('data-t').indexOf(v) >= 0; c.hidden = !ok; if (ok) n++; });
        document.getElementById('gEmpty').hidden = n > 0;
      };
      gi.oninput = filter; filter();
      if (qs.q) gi.focus();
      document.getElementById('gFlash').onchange = function () {
        grid.classList.toggle('flash', this.checked);
        grid.querySelectorAll('.gloss').forEach(function (c) { c.classList.remove('shown'); });
      };
      grid.onclick = function (e) { var c = e.target.closest('.gloss'); if (c && grid.classList.contains('flash')) c.classList.toggle('shown'); };
    }
  }

  // =====================================================================
  // Progress dashboard + backup
  // =====================================================================
  function renderProgress() {
    var all = stats(items);
    var shorts = (D.question_bank && D.question_bank.short_answer) || [];
    var nKnow = shorts.filter(function (s) { return saSelf[s.id] === 'know'; }).length;
    var qh = store.get(K.quizHist, []);
    var days = [];
    for (var i = 13; i >= 0; i--) { var d = new Date(); d.setDate(d.getDate() - i); days.push(dateKey(d)); }
    var maxDay = Math.max.apply(null, days.map(function (k) { return activity[k] || 0; }).concat([1]));

    var html = '<div class="page-head"><h1>My progress</h1><p>Everything is stored only in this browser. Use backup to move your progress to another device.</p></div>' +
      '<div class="grid grid-4">' + stat(all.done + '/' + all.total, 'Questions attempted') + stat(all.done ? all.acc + '%' : '–', 'Accuracy') +
      stat(Object.keys(readCh).length + '/' + chapters.length, 'Chapters read') + stat(nKnow + '/' + shorts.length, 'Short answers known') +
      stat(streakDays() + ' 🔥', 'Day streak') + stat(bookmarkCount(), 'Bookmarked') + '</div>';

    html += '<div class="card section"><h3>Last 14 days</h3><div class="activity">' + days.map(function (k) {
      var v = activity[k] || 0;
      return '<div class="act-col" title="' + k + ': ' + v + ' answers"><div class="act-bar" style="height:' + (v / maxDay * 100) + '%"></div><span>' + k.slice(8) + '</span></div>';
    }).join('') + '</div><p class="small muted" style="margin:6px 0 0">Questions answered per day</p></div>';

    html += '<div class="card section"><h3>By format</h3><div class="table-wrap plain"><table><thead><tr><th>Format</th><th>Done</th><th>Accuracy</th><th></th></tr></thead><tbody>' +
      KINDS.concat(extItems.length ? ['ext'] : []).map(function (k) {
        var s = stats(k === 'ext' ? extItems : items.filter(function (q) { return q.kind === k; }));
        return '<tr><td>' + TYPES[k].icon + ' ' + esc(TYPES[k].label) + '</td><td class="nowrap" style="min-width:120px">' + s.done + ' / ' + s.total + bar(s.total ? s.done / s.total * 100 : 0) + '</td>' +
          '<td>' + (s.done ? accTag(s) : '—') + '</td><td class="nowrap"><a href="#/browse/' + (k === 'ext' ? 'ext' : 'all?type=' + k) + '">Practise →</a></td></tr>';
      }).join('') + '</tbody></table></div></div>';

    html += '<div class="card section"><h3>Chapters</h3><div class="table-wrap plain"><table><thead><tr><th>Chapter</th><th>Read</th><th>Questions</th><th>Accuracy</th><th>Short answers known</th></tr></thead><tbody>' +
      chapters.map(function (c) {
        var s = stats(itemsFor(c.chapter_id));
        var sh = shorts.filter(function (x) { return x.chapter_id === c.chapter_id; });
        var k = sh.filter(function (x) { return saSelf[x.id] === 'know'; }).length;
        return '<tr><td><a href="#/notes/' + c.chapter_id + '">' + esc(c.title) + '</a></td><td>' + (readCh[c.chapter_id] ? '✓' : '—') + '</td>' +
          '<td class="nowrap">' + s.done + ' / ' + s.total + '</td><td style="min-width:110px">' + (s.done ? s.acc + '%' + bar(s.acc) : '—') + '</td>' +
          '<td>' + (sh.length ? k + ' / ' + sh.length : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    var taken = mocks.filter(function (m) { return (mockHist[m.id] || []).length; });
    html += '<div class="grid grid-2 section"><div class="card"><h3>Mock test history</h3>' + (taken.length ? '<div class="table-wrap plain"><table><tbody>' +
      taken.map(function (m) {
        return (mockHist[m.id] || []).map(function (h) {
          return '<tr><td><a href="#/mock/' + esc(m.id) + '">' + esc(m.title) + '</a></td><td>' + h.score + '/' + h.total + '</td><td class="muted small">' + esc(h.date || '') + '</td><td class="muted small">' + (h.secs != null ? fmtTime(h.secs) : '') + '</td></tr>';
        }).join('');
      }).join('') + '</tbody></table></div>' : '<p class="muted">No mock tests taken yet. <a href="#/mock">Take one →</a></p>') + '</div>' +
      '<div class="card"><h3>Recent quizzes</h3>' + (qh.length ? '<div class="table-wrap plain"><table><tbody>' +
      qh.slice(0, 10).map(function (h) {
        return '<tr><td>' + esc(h.title) + '</td><td>' + h.score + '/' + h.total + '</td><td class="muted small">' + esc(h.date) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="muted">No quizzes yet. <a href="#/practice">Start one →</a></p>') + '</div></div>';

    html += '<div class="card section"><h3>Backup & reset</h3><p class="small muted">Download your progress as a file, then restore it on another phone or computer.</p>' +
      '<div class="btn-row"><button class="btn" id="exportBtn">⬇ Download backup</button>' +
      '<label class="btn ghost" for="importFile">⬆ Restore from file</label><input type="file" id="importFile" accept=".json,application/json" hidden>' +
      '<button class="btn ghost danger" id="resetAll">Reset all progress</button></div></div>';
    app.innerHTML = html;

    var keys = [K.progress, K.bookmarks, K.read, K.sa, K.mockHist, K.activity, K.quizHist];
    document.getElementById('exportBtn').onclick = function () {
      var data = { app: 'coma-study-pack', exported: new Date().toISOString(), data: {} };
      keys.forEach(function (k) { data.data[k] = store.get(k, null); });
      var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'coma-progress-' + today() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    document.getElementById('importFile').onchange = function () {
      var f = this.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var obj = JSON.parse(r.result);
          if (!obj || obj.app !== 'coma-study-pack' || !obj.data) throw new Error('bad file');
          if (!confirm('Replace your current progress with this backup from ' + String(obj.exported || '').slice(0, 10) + '?')) return;
          keys.forEach(function (k) { if (obj.data[k] != null) store.set(k, obj.data[k]); });
          location.reload();
        } catch (e) { toast('That file is not a valid COMA backup.'); }
      };
      r.readAsText(f);
    };
    document.getElementById('resetAll').onclick = function () {
      if (!confirm('Delete ALL your answers, bookmarks, ratings and test history from this browser? This cannot be undone.')) return;
      keys.concat([K.quiz, K.builder]).forEach(store.del);
      mocks.forEach(function (m) { store.del(K.mockRun + m.id); });
      location.reload();
    };
  }

  // =====================================================================
  // Search
  // =====================================================================
  function itemText(it) {
    switch (it.kind) {
      case 'ar': return it.assertion + ' ' + it.reason;
      case 'mm': return it.instruction + ' ' + it.column_a.join(' ') + ' ' + it.column_b.join(' ');
      case 'tf': return it.statement;
      case 'fb': return it.question + ' ' + it.answer;
      case 'mt': return it.instruction + ' ' + it.column_a.join(' ') + ' ' + it.column_b_shuffled.join(' ');
      default: return it.question + ' ' + Object.values(it.options || {}).join(' ');
    }
  }
  function itemShow(it) {
    return it.kind === 'ar' ? 'A: ' + it.assertion + ' R: ' + it.reason : it.kind === 'tf' ? it.statement :
      it.kind === 'mm' || it.kind === 'mt' ? it.instruction + ' — ' + it.column_a.join(', ') : it.question;
  }
  var searchIndex = null;
  var searchTimer = null;
  function buildIndex() {
    var idx = [];
    (D.study_notes || []).forEach(function (n) {
      idx.push({ kind: 'Chapter', text: n.title + ' ' + (n.title_bn || ''), href: '#/notes/' + n.chapter_id });
      (n.key_points || []).concat(n.exam_traps || []).forEach(function (k) {
        idx.push({ kind: 'Notes · ' + n.title, text: k, href: '#/notes/' + n.chapter_id });
      });
      (n.examples || []).forEach(function (ex) {
        idx.push({ kind: 'Example · ' + n.title, text: ex.code, href: '#/notes/' + n.chapter_id });
      });
    });
    (D.glossary || []).forEach(function (g) {
      idx.push({ kind: 'Glossary', text: g.term + ' — ' + g.meaning_bn, href: '#/revision/glossary?q=' + encodeURIComponent(g.term) });
    });
    items.concat(extItems).forEach(function (it) {
      idx.push({ kind: TYPES[it.kind].label + ' · ' + it.id, text: itemText(it), show: itemShow(it), href: '#/q/' + it.id });
    });
    var qb = D.question_bank || {};
    (qb.short_answer || []).forEach(function (s) {
      idx.push({ kind: 'Short answer · ' + s.id, text: s.question + ' ' + s.answer, show: s.question, href: '#/short/' + s.chapter_id + '?open=' + s.id });
    });
    (qb.programs || []).forEach(function (p) {
      idx.push({ kind: 'Program · ' + p.id, text: p.question + ' ' + p.answer_code, show: p.question, href: '#/programs?open=' + p.id });
    });
    idx.forEach(function (it) { it.lower = it.text.toLowerCase(); });
    return idx;
  }
  function openSearch() {
    if (!D) return;
    var ov = document.getElementById('searchOverlay');
    ov.hidden = false;
    var inp = document.getElementById('searchInput');
    inp.value = ''; inp.focus();
    document.getElementById('searchResults').innerHTML = '<p class="muted small" style="padding:10px 12px">Type to search notes, questions of every format, glossary, short answers and programs (English or বাংলা).</p>';
  }
  function closeSearch() { document.getElementById('searchOverlay').hidden = true; }
  function runSearch() {
    var input = this;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      if (!searchIndex) searchIndex = buildIndex();
      var q = input.value.trim().toLowerCase();
      var box = document.getElementById('searchResults');
      if (q.length < 2) { box.innerHTML = ''; return; }
      var terms = q.split(/\s+/);
      var hits = searchIndex.filter(function (it) {
        return terms.every(function (w) { return it.lower.indexOf(w) >= 0; });
      }).slice(0, 40);
      if (!hits.length) { box.innerHTML = '<p class="muted small" style="padding:10px 12px">No results.</p>'; return; }
      box.innerHTML = hits.map(function (h) {
        var s = h.show || h.text;
        return '<a href="' + h.href + '"><div class="kind">' + esc(h.kind) + '</div><div class="snip">' +
          markTerms(s.length > 220 ? s.slice(0, 220) + '…' : s, terms) + '</div></a>';
      }).join('');
    }, 120);
  }

  boot();
})();
