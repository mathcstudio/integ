(function () {
  var CAMPS = window.CAMPS, NOTES = window.NOTES, KEY = "integral-climb-v2", MARK = "①②③④";
  var API_URL = String(window.CLIMB_API_URL || "").trim();   /* config.js 에 적은 앱스크립트 웹 앱 주소 */
  var HAS = /^https:\/\/script\.google\.com\/.+\/exec$/.test(API_URL);
  var app = document.getElementById("app");
  var BYID = {};
  CAMPS.forEach(function (c, ci) { c.probs.forEach(function (p, pi) { p.camp = ci; p.idx = pi; BYID[p.id] = p; }); });
  var BYKEY = {};
  CAMPS.forEach(function (c, ci) { BYKEY[c.key] = ci; });
  var ROAD = { 10: "완만한 길", 20: "능선길", 30: "절벽길", 40: "서술길" };
  var SUMMIT = CAMPS.length - 2, BONUS = CAMPS.length - 1;
  /* 서버 설정의 기본값. limC = 선택형 기회, limN = 입력형 기회(없으면 서술형과 같게), limE = 서술형 기회,
     wait = 오답 뒤 제출을 막는 시간(초),
     back = 기회를 다 썼을 때 "camp"(이전 캠프 구간부터) 또는 "prob"(그 문제만) */
  var DEFAULTS = { limC: 3, limN: null, limE: 5, essayOn: false, wait: 15, back: "camp" };
  function withDefaults(o) { var c = {}, k; for (k in DEFAULTS) c[k] = DEFAULTS[k]; for (k in (o || {})) if (o[k] != null) c[k] = o[k]; return c; }
  var CFG = withDefaults();

  function fresh(name) { return { name: name || "", start: 0, end: 0, probs: {}, cele: {}, rev: 0, synced: false, outbox: [], view: "intro", cur: null }; }
  var S = fresh("");
  try { var sv = JSON.parse(localStorage.getItem(KEY) || "null"); if (sv && sv.probs) S = sv; } catch (e) {}
  S.view = "intro"; S.cur = null;
  function norm() {
    S.cele = S.cele || {}; S.outbox = S.outbox || []; S.rev = S.rev || 0; S.probs = S.probs || {}; S.note = S.note || {};
    S.final = S.final || { done: false, ok: {}, tries: {}, vals: {}, miss: 0 };
  }
  norm();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

  function freshUi() { return { order: null, vals: [], active: 0, ok: [], no: [], fb: null, busy: false, focus: 0, fresh: false }; }
  var ui = freshUi(), joining = false, joinErr = "", dirty = false;
  var exOpen = {};
  function freshAdm() { return { byBad: false, data: null, reviews: [], essays: [], err: "", busy: false, open: null, stu: null, pw: "", sel: {}, msg: "" }; }
  var adm = freshAdm(), gateFb = {};

  /* ---------- 도우미 ---------- */
  function parse(s) {
    var m = /^(-?\d+)(?:\/(\d+))?$/.exec(String(s).trim());
    if (!m) return null;
    var d = m[2] ? +m[2] : 1; if (!d) return null;
    return [+m[1], d];
  }
  function same(a, b) { var x = parse(a), y = parse(b); return !!x && !!y && x[0] * y[1] === y[0] * x[1]; }
  function texNum(s) { var x = parse(s); if (!x) return s; return x[1] === 1 ? String(x[0]) : (x[0] < 0 ? "-" : "") + "\\tfrac{" + Math.abs(x[0]) + "}{" + x[1] + "}"; }
  function st(id) {
    var s = S.probs[id] || (S.probs[id] = { step: 0, miss: 0, done: false, score: 0, log: [] });
    if (s.tries == null) { s.tries = 0; s.wrong = []; s.hint = false; s.fail = false; s.resets = 0; s.ai = ""; }
    if (!s.draft) s.draft = [];
    return s;
  }
  function isDone(p) { return !!(S.probs[p.id] && S.probs[p.id].done); }
  /* 구간의 길 묶음. 순서대로 열리고, 묶음마다 하나씩 완등해야 구간을 통과한다.
     서술길은 서버에 채점 설정(API 키)이 있을 때만 생긴다. */
  function stages(c) {
    if (c.bonus) return [{ label: "보너스 길", list: c.probs }];
    var out = [{ label: "몸풀기 길", list: c.probs.filter(function (p) { return p.idx < 2; }) },
      { label: "중간 길", list: c.probs.filter(function (p) { return p.idx >= 2 && !p.essay; }) }];
    var es = c.probs.filter(function (p) { return p.essay; });
    if (es.length && (CFG.essayOn || es.some(isDone))) out.push({ label: "서술길", list: es });
    return out;
  }
  function stageDone(st) { return st.list.some(isDone); }
  function stageOpen(c, k) { return c.bonus || k === 0 || stageDone(stages(c)[k - 1]); }
  function stageOf(p) {
    var sts = stages(CAMPS[p.camp]);
    for (var k = 0; k < sts.length; k++) if (sts[k].list.indexOf(p) >= 0) return sts[k];
    return null;
  }
  function probOpen(p) {
    var c = CAMPS[p.camp], sts = stages(c);
    for (var k = 0; k < sts.length; k++) if (sts[k].list.indexOf(p) >= 0) return unlocked(p.camp) && stageOpen(c, k);
    return false;
  }
  function probsPassed(ci) { return stages(CAMPS[ci]).every(stageDone); }
  /* 정상은 문제에 더해 마지막 관문(개념 빈칸)까지 통과해야 한다 */
  function passed(ci) { return probsPassed(ci) && (ci !== SUMMIT || S.final.done); }
  function progress() { return { c: CAMPS.map(function (_, ci) { return probsPassed(ci) ? 1 : 0; }), f: S.final.done ? 1 : 0 }; }
  function essaysDone() { var n = 0; CAMPS.forEach(function (c) { c.probs.forEach(function (p) { if (p.essay && isDone(p)) n++; }); }); return n; }
  function unlocked(ci) { return ci === 0 || passed(ci - 1); }
  function total() { var t = 0; Object.keys(S.probs).forEach(function (k) { if (S.probs[k].done) t += S.probs[k].score; }); return t; }
  function height() { var h = 0; CAMPS.forEach(function (c, ci) { if (passed(ci) && (ci === 0 || h === CAMPS[ci - 1].alt)) h = c.alt; }); return h; }
  function position() { for (var ci = 0; ci < CAMPS.length; ci++) if (!passed(ci)) return CAMPS[ci].name + " 가는 길"; return "모든 구간 완등"; }
  /* 선택형은 선지가 넷뿐이라 기회를 적게, 직접 계산해 넣는 입력형은 서술형만큼 준다 */
  function limN() { return CFG.limN != null ? CFG.limN : CFG.limE; }
  function lim(step) { return step.t === "essay" ? CFG.limE : step.t === "nums" ? limN() : CFG.limC; }
  function minScore(p) { return Math.round(p.pts * 0.4); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function M(tex) { return "\\(\\displaystyle " + tex + "\\)"; }
  function optHtml(o) { return o.indexOf("T:") === 0 ? o.slice(2) : M(o); }
  function qHtml(p) { return '<div class="q' + (p.text ? " text" : "") + '">' + (p.text || M(p.tex)) + "</div>"; }
  function typeset(el) { if (window.__mjReady && MathJax.typesetPromise) MathJax.typesetPromise([el || app]).catch(function () {}); }
  window.__typeset = function () { typeset(); };
  function shuffle(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); for (i = n - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function comma(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  var calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- 오답 뒤 대기: 틀리면 잠시 제출 버튼을 막는다 ---------- */
  var lockTimer = 0;
  function lockLeft() { return Math.max(0, Math.ceil(((S.lockUntil || 0) - Date.now()) / 1000)); }
  function startLock() { var w = Number(CFG.wait); if (!(w >= 0)) w = 15; S.lockUntil = w > 0 ? Date.now() + w * 1000 : 0; }
  /* 화면을 다시 그리지 않고 버튼과 안내 문구만 고친다(쓰던 글과 커서를 건드리지 않기 위해) */
  function applyLock() {
    clearTimeout(lockTimer);
    var n = lockLeft();
    Array.prototype.forEach.call(document.querySelectorAll("[data-lockable]"), function (el) {
      el.disabled = n > 0 || el.dataset.off === "1";
      if (el.dataset.label && el.dataset.off !== "1") el.textContent = n > 0 ? n + "초 뒤 가능" : el.dataset.label;
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-wait]"), function (el) {
      el.textContent = n > 0 ? n + "초 뒤에 다시 제출할 수 있습니다. 그동안 아래 질문을 보고 다시 생각해 보세요." : "";
    });
    if (n > 0) lockTimer = setTimeout(applyLock, 250);
  }

  /* ---------- 서버(앱스크립트) ---------- */
  function call(fn, arg) {
    return new Promise(function (res, rej) {
      if (!HAS) return rej(new Error("demo"));
      /* text/plain 으로 보내야 브라우저가 사전 요청(preflight) 없이 앱스크립트에 전달한다 */
      fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ fn: fn, arg: arg }), redirect: "follow" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(res, rej);
    });
  }
  var sending = false, syncState = "";
  function setSync(v) { syncState = v; var el = document.querySelector(".sync"); if (el) { el.textContent = syncText(); el.className = "sync" + (v === "bad" ? " bad" : ""); } }
  function syncText() { return !HAS ? "연결 전 · 이 기기에만 저장" : syncState === "busy" ? "저장 중…" : syncState === "bad" ? "저장 안 됨 · 다시 시도 중" : syncState === "ok" ? "저장됨" : ""; }
  function summary() {
    var miss = 0, resets = 0, done = 0;
    Object.keys(S.probs).forEach(function (k) { var s = S.probs[k]; miss += s.miss; resets += s.resets || 0; if (s.done) done++; });
    return { pos: position(), alt: height(), score: total(), done: done, essays: essaysDone(), miss: miss, resets: resets, end: S.end || 0 };
  }
  function queueSave(entry) {
    if (entry) { entry.at = Date.now(); S.outbox.push(entry); }
    S.rev++; dirty = false; save(); pump();
  }
  function pump() {
    if (!HAS || sending || !S.name) return;
    sending = true; setSync("busy");
    var logs = S.outbox.slice(), rev = S.rev, copy = JSON.parse(JSON.stringify(S));
    copy.outbox = []; copy.synced = true; copy.view = "intro"; copy.cur = null; copy.prog = progress();
    call("apiSave", { name: S.name, rev: rev, synced: !!S.synced, state: JSON.stringify(copy), sum: summary(), logs: logs }).then(function (r) {
      sending = false;
      if (r && r.gone) { wiped(); return; }
      if (!r || !r.ok) throw new Error("save");
      S.outbox = S.outbox.slice(logs.length); S.synced = true; save(); setSync("ok");
      if (S.rev !== rev) pump();
    }).catch(function () { sending = false; setSync("bad"); setTimeout(pump, 6000); });
  }

  /* 서버에 저장했던 기록이 사라졌다 = 선생님이 지웠다. 이 기기의 기록도 지우고 첫 화면으로 돌아간다. */
  function wiped() {
    var sid = S.sid, sname = S.sname;
    Array.prototype.forEach.call(document.querySelectorAll(".cele, .note, .tour"), function (el) { el.remove(); });
    S = fresh(""); S.sid = sid; S.sname = sname; norm(); save(); dirty = false; syncState = "";
    joinErr = "선생님이 등반 기록을 지웠습니다. 다시 입장하면 처음부터 시작합니다.";
    ui = freshUi(); render(); window.scrollTo(0, 0);
  }

  /* ---------- 화면 전환 ---------- */
  function go(view, cur) {
    if (dirty && view !== "prob") queueSave();
    S.view = view; S.cur = cur || null; save();
    ui = freshUi(); render(); window.scrollTo(0, 0);
    if (view === "map") { var el = app.querySelector(".camp.open"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" }); checkNote(); maybeTour(); }
    if (view === "map" || view === "prob") rvPoll(false);
  }

  function bar(back) {
    return '<div class="bar"><div>' + (back ? '<button class="btn small" data-act="map">← 등산로</button>' : '<span class="who">' + esc(S.name) + "</span>") +
      '</div><div class="right"><span class="sync' + (syncState === "bad" ? " bad" : "") + '">' + syncText() + '</span><span class="total">' + comma(total()) + "점</span>" +
      (S.view !== "record" ? '<button class="btn small" data-act="record">등반 기록</button>' : "") + "</div></div>";
  }

  /* 산 그림: 능선이 함수의 그래프이고, 그 아래 넓이를 a부터 b까지 여섯 구간으로 나눈다.
     filled = 색을 채울 구간 수, at = 등반자가 서 있는 경계 번호(0은 입구) */
  var CV = { X0: 34, X1: 326, Y0: 214, H: 176, N: 6 };
  var STRIP = ["#0F6B78", "#2A8794", "#4BA2AD", "#7DBFC6", "#B0D9DC", "#D9ECEE"];
  var SHORT = ["기본", "위끝·아래끝", "합·차", "구간", "절댓값", "우·기함수"];
  function cf(t) { return 0.1 + 0.9 * Math.pow(t, 1.5) + 0.035 * Math.sin(t * Math.PI * 5); }
  function cpt(t) { return [CV.X0 + (CV.X1 - CV.X0) * t, CV.Y0 - CV.H * cf(t)]; }
  function standAt(j) { if (j <= 0) return [CV.X0 - 14, CV.Y0 - 9]; var p = cpt(Math.min(j, CV.N) / CV.N); return [p[0], p[1] - 9]; }
  function curveSvg(filled, at) {
    var h = "", i, k, p;
    for (i = CV.N - 1; i >= 0; i--) {
      var a = i / CV.N, b = (i + 1) / CV.N, d = "M" + cpt(a)[0].toFixed(1) + "," + CV.Y0;
      for (k = 0; k <= 12; k++) { p = cpt(a + (b - a) * k / 12); d += " L" + p[0].toFixed(1) + "," + p[1].toFixed(1); }
      d += " L" + cpt(b)[0].toFixed(1) + "," + CV.Y0 + "Z";
      h += '<path class="cv-strip' + (i < filled ? " on" : "") + '" data-strip="' + i + '" d="' + d + '" style="--c:' + STRIP[i] + '"/>';
    }
    var line = ""; for (k = 0; k <= 72; k++) { p = cpt(k / 72); line += (k ? " L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); }
    h += '<path class="cv-line" d="' + line + '"/><line class="cv-axis" x1="18" y1="' + CV.Y0 + '" x2="346" y2="' + CV.Y0 + '"/><line class="cv-axis" x1="' + CV.X0 + '" y1="20" x2="' + CV.X0 + '" y2="' + (CV.Y0 + 8) + '"/>';
    for (i = 0; i <= CV.N; i++) {
      var x = cpt(i / CV.N)[0];
      h += '<text class="cv-x" x="' + x + '" y="' + (CV.Y0 + 20) + '">' + (i === 0 ? "a" : i === CV.N ? "b" : "x" + "₁₂₃₄₅".charAt(i - 1)) + "</text>";
      if (i < CV.N) { var m = cpt((i + .5) / CV.N); h += '<text class="cv-name' + (i < filled ? (i < 3 ? " dark" : " light") : "") + '" data-name="' + i + '" x="' + m[0] + '" y="' + (CV.Y0 - 8) + '" font-size="' + (SHORT[i].length > 4 ? 7.4 : 9) + '">' + SHORT[i] + "</text>"; }
      if (i > 0 && i < CV.N) { var c = cpt(i / CV.N); h += '<circle class="cv-dot" cx="' + c[0] + '" cy="' + c[1] + '" r="4.5"/>'; }
    }
    var top = cpt(1), st = standAt(at);
    h += '<line class="cv-pole" x1="' + top[0] + '" y1="' + top[1] + '" x2="' + top[0] + '" y2="' + (top[1] - 26) + '"/><polygon class="cv-flag" points="' + top[0] + "," + (top[1] - 26) + " " + (top[0] - 18) + "," + (top[1] - 20) + " " + top[0] + "," + (top[1] - 14) + '"/>' +
      '<text class="cv-hand" x="' + (top[0] - 34) + '" y="' + (top[1] - 10) + '">y = f(x)</text>' +
      '<g class="cv-climber" id="cvClimber" style="transform:translate(' + st[0] + "px," + st[1] + 'px)"><circle class="head" cx="0" cy="-15" r="4.4"/>' +
      '<path class="body" d="M0,-11 L0,-1 M0,-7 L6,-4 M0,-1 L-4,8 M0,-1 L5,8"/><line class="stick" x1="9" y1="-12" x2="9" y2="8"/></g>';
    return '<svg viewBox="0 0 360 250" role="img" aria-label="능선이 함수의 그래프인 산. 그래프 아래 넓이가 여섯 구간으로 나뉘어 있다">' + h + "</svg>";
  }
  function reached() { var n = 0; while (n <= SUMMIT && passed(n)) n++; return n; }

  function vIntro() {
    return '<div class="hero"><div class="hero-top"><p class="kick">a에서 b까지, 구간을 하나씩</p><h1>정적분 <span>등반</span></h1></div>' +
      '<div class="hero-art">' + curveSvg(CV.N, S.start ? reached() : 0) + "</div>" +
      '<div class="hero-form"><div class="row"><label class="who-f" for="idInput">학번<input id="idInput" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="예: 20101" autocomplete="off" value="' + esc(S.sid || "") + '"' + (joining ? " disabled" : "") + "></label>" +
      '<label class="who-f grow" for="nameInput">이름<input id="nameInput" maxlength="12" placeholder="예: 김하늘" autocomplete="off" autocapitalize="off" value="' + esc(S.sname || "") + '"' + (joining ? " disabled" : "") + "></label>" +
      '<button class="btn start" data-act="start"' + (joining ? " disabled" : "") + ">" + (joining ? "불러오는 중…" : S.start ? "이어서 등반" : "등반 시작") + "</button></div>" +
      '<div class="hero-foot"><p class="err" role="status">' + esc(joinErr) + '</p><button class="link" data-act="admin">관리자 모드</button></div></div></div>';
  }

  /* ---------- 밝게 비추는 안내 ---------- */
  var MAP_TOUR = [
    { sel: function () { return app.querySelector(".camp.open .camp-body"); }, text: "지금 오를 구간입니다. 핵심 한 줄을 읽고 먼저 스스로 풀어 보세요. 예시는 막힐 때만 눌러서 봅니다." },
    { sel: function () { return app.querySelector(".camp.open .tiers"); }, text: "몸풀기 길은 고르고, 중간 길은 빈칸을 직접 계산해 채우고, 서술길은 풀이를 글로 씁니다. 뒤로 갈수록 스스로 하는 부분이 늘어납니다. 서술길에서 거듭제곱은 x^2처럼 씁니다." },
    { sel: function () { var c = app.querySelector(".camp.open"); return c && c.previousElementSibling ? c.previousElementSibling.querySelector(".camp-body") : null; }, text: "길을 모두 완등하면 다음 캠프에 도착합니다. 도착하면 나오는 핵심 정리는 공책에 꼭 적어 두세요. 정상 직전에 다시 묻습니다." },
    { sel: function () { return app.querySelector(".bar .right"); }, text: function () { return "틀리면 점수가 조금 깎이고 잠시 동안 다시 제출할 수 없습니다. 그동안 다시 생각해 보세요. 힌트는 버튼을 눌러야 보입니다. 한 줄에서 기회를 다 쓰면 " + (CFG.back === "prob" ? "그 문제를 처음부터 다시 풉니다." : "이전 캠프 구간부터 다시 올라야 합니다.") + " 점수와 내 풀이는 여기서 확인합니다."; } }
  ];
  var PAD_TOUR = [{ sel: function () { return app.querySelector(".pad"); }, text: "값은 이 숫자판으로 입력합니다. 분수는 4/3, 음수는 −4처럼 누른 뒤 ‘확인’을 누르세요." }];
  function startTour(steps, flag) {
    if (document.querySelector(".tour")) return;
    var i = 0, t = document.createElement("div");
    t.className = "tour"; t.setAttribute("role", "dialog"); t.setAttribute("aria-label", "사용 안내");
    t.innerHTML = '<div class="tour-ring"></div><div class="tour-box"><b class="n"></b><p></p><div class="btns"><button class="skip" data-tour="skip">건너뛰기</button><span><button class="prev" data-tour="prev">이전</button><button class="next" data-tour="next"></button></span></div></div>';
    document.body.appendChild(t);
    var ring = t.querySelector(".tour-ring"), box = t.querySelector(".tour-box");
    function place() {
      var el = steps[i].sel(); if (!el) { step(1); return; }
      var r = el.getBoundingClientRect(), W = window.innerWidth, Hh = window.innerHeight, pad = 6;
      ring.style.left = (r.left - pad) + "px"; ring.style.top = (r.top - pad) + "px"; ring.style.width = (r.width + 2 * pad) + "px"; ring.style.height = (r.height + 2 * pad) + "px";
      var bw = Math.min(460, W - 32), bh = box.offsetHeight, left = Math.max(16, Math.min(r.left, W - bw - 16));
      var top = r.bottom + pad + 14;
      if (top + bh > Hh - 12) top = r.top - pad - 14 - bh;
      if (top < 12) top = Hh - bh - 16;
      box.style.width = bw + "px"; box.style.left = left + "px"; box.style.top = top + "px";
    }
    function show() {
      var el = steps[i].sel(); if (!el) { step(1); return; }
      t.querySelector(".n").textContent = steps.length > 1 ? (i + 1) + " / " + steps.length : "안내";
      t.querySelector("p").textContent = typeof steps[i].text === "function" ? steps[i].text() : steps[i].text;
      t.querySelector(".prev").style.visibility = i ? "visible" : "hidden";
      t.querySelector(".skip").style.visibility = steps.length > 1 && i < steps.length - 1 ? "visible" : "hidden";
      t.querySelector(".next").textContent = i === steps.length - 1 ? (steps.length > 1 ? "등반하러 가기" : "알겠습니다") : "다음";
      if (el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "auto" });
      place(); setTimeout(place, 60);
      var nb = t.querySelector(".next"); if (nb.focus) nb.focus({ preventScroll: true });
    }
    function done() { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); t.remove(); S[flag] = Date.now(); save(); if (S.view === "map") checkNote(); }
    function step(dir) { i += dir; if (i < 0) i = 0; if (i >= steps.length) { done(); return; } show(); }
    t.addEventListener("click", function (e) {
      var b = e.target.closest("[data-tour]"); if (!b) return;
      if (b.dataset.tour === "skip") done(); else step(b.dataset.tour === "prev" ? -1 : 1);
    });
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    show();
  }
  function maybeTour() {
    if (document.querySelector(".tour, .cele, .note")) return;
    if (S.view === "map" && !S.tut) { window.scrollTo(0, 0); startTour(MAP_TOUR, "tut"); }
    else if (S.view === "prob" && !S.tutPad && app.querySelector(".pad")) startTour(PAD_TOUR, "tutPad");
  }

  function routeBtn(p, locked) {
    var s = S.probs[p.id], d = s && s.done, going = s && !d && (s.step > 0 || s.miss > 0), rv = s && !d && s.review;
    return '<button class="route' + (p.essay ? " essay" : "") + (d ? " done" : going ? " going" : "") + '" data-prob="' + p.id + '"' + (locked ? " disabled" : "") + "><b>" + ROAD[p.pts] + "</b><span>" +
      (d ? "완등 " + s.score + "점" : rv ? (rv.st === "pending" ? "선생님 확인 대기" : rv.st === "no" ? "오답 확인됨" : "선택이 필요합니다") : going ? "오르는 중 · " + p.pts + "점" : p.pts + "점") + "</span></button>";
  }
  function tierHtml(st, open) {
    var ok = stageDone(st);
    return '<div class="tier"><div class="tier-head">' + st.label + (ok ? '<span class="ok">✓ 완료</span>' : "<span>" + (!open ? "앞의 길을 완등하면 열립니다" : st.list.length > 1 ? "하나 고르기" : "꼭 완등하기") + "</span>") +
      '</div><div class="routes">' + st.list.map(function (p) { return routeBtn(p, !open); }).join("") + "</div></div>";
  }
  function vMap() {
    var h = "", cur = -1;
    CAMPS.forEach(function (c, ci) { if (unlocked(ci) && !passed(ci) && cur < 0) cur = ci; });
    for (var ci = CAMPS.length - 1; ci >= 0; ci--) {
      var c = CAMPS[ci], open = unlocked(ci), ok = passed(ci);
      var cls = ok ? "passed" : open ? (ci === cur ? "open" : "") : "locked";
      var status = ok ? "도착" : open ? (c.bonus ? "선택 구간" : ci === SUMMIT && probsPassed(ci) ? "마지막 관문" : "오르는 중") : "잠김";
      h += '<div class="camp ' + cls + '"><div class="alt"><div class="peg">' + (ok ? "⚑" : c.bonus ? "★" : ci + 1) + "</div><small>" + comma(c.alt) + 'm</small></div><div class="camp-body">' +
        '<div class="camp-head"><span><span class="nm">' + c.name + '</span><span class="tp">' + c.topic + '</span></span><span class="st">' + status + "</span></div>";
      if (open) {
        h += '<p class="tip">' + c.tip + "</p>" + (exOpen[ci] ? '<div class="ex"><b>예시</b>' + M(c.ex) + "</div>" :
          '<div><button class="btn small peek" data-ex="' + ci + '">막히면 예시 보기</button></div>') +
          '<div class="tiers">' + stages(c).map(function (st, k) { return tierHtml(st, stageOpen(c, k)); }).join("") + "</div>";
        if (ci === SUMMIT) {
          var ready = probsPassed(ci), nOk = Object.keys(S.final.ok).length;
          h += '<div class="tier"><div class="tier-head">마지막 관문' + (S.final.done ? '<span class="ok">✓ 완료</span>' : "<span>" + (ready ? "여섯 캠프의 핵심 정리를 빈칸에 쓰기" : "위의 길을 모두 완등하면 열립니다") + "</span>") + '</div><div class="routes">' +
            '<button class="route' + (S.final.done ? " done" : ready ? " going" : "") + '" data-act="final"' + (ready ? "" : " disabled") + "><b>개념 빈칸 쓰기</b><span>" + (S.final.done ? "통과" : nOk + " / 6") + "</span></button></div></div>";
        }
      }
      h += "</div></div>";
    }
    var top = passed(SUMMIT) ? '<div class="banner"><b>정상 등정! 해발 ' + comma(CAMPS[SUMMIT].alt) + 'm</b><button class="btn" data-act="record">등반 기록 보기</button></div>' : "";
    return bar(false) + top + '<div class="trail">' + h + "</div>";
  }

  function logHtml(s, markNew) {
    return s.log.map(function (l, k) {
      var body = l.k === "m" ? M(l.v) : l.k === "t" ? l.v : esc(l.v);
      return '<div class="logline' + (markNew && k === s.log.length - 1 ? " new" : "") + '"><i>' + (l.k === "e" ? "✎" : MARK[k]) + "</i><div" + (l.k === "e" ? ' class="essay-log"' : "") + ">" + body + "</div></div>";
    }).join("");
  }
  /* 틀렸을 때 답을 알려 주는 대신, 스스로 확인할 방법을 묻는다 */
  function askOf(p, k) {
    var step = p.steps[k], last = k === p.steps.length - 1;
    if (step.t === "essay") return "칸마다 쓴 식이 앞 칸에서 자연스럽게 이어지나요? 한 줄씩 소리 내어 읽어 보세요.";
    if (step.t === "choice") return step.o[0].indexOf("T:") === 0 ? "각 설명을 간단한 식에 직접 적용해 보세요. 어느 것이 언제나 성립하나요?" :
      "고른 식이 맞는지 스스로 확인할 수 있습니다. 부정적분이면 미분해 보고, 정리한 식이면 원래 식과 위끝·아래끝을 비교해 보세요.";
    if (step.show) return "빈칸에 넣은 수로 식을 완성해 보세요. 거꾸로 계산(미분하거나 전개)하면 처음 식이 나오나요?";
    return last ? "위끝을 넣은 값에서 아래끝을 넣은 값을 뺐나요? 앞에서 구한 값과 부호를 하나씩 다시 확인해 보세요." :
      "항마다 따로 계산해 종이에 적어 보세요. 음수를 넣을 때 괄호를 쳤나요?";
  }
  /* 서술길에서 기회를 다 쓰면: 오답을 인정하고 다시 시작하거나, 선생님께 확인을 요청한다 */
  function failCost(p) {
    var stg = stageOf(p), required = !CAMPS[p.camp].bonus && stg && !stageDone(stg);
    return CFG.back !== "prob" && required ? "산사태가 일어나 " + CAMPS[Math.max(0, p.camp - 1)].name + " 구간부터 다시 오릅니다." : "이 서술길을 처음부터 다시 씁니다.";
  }
  function reviewHtml(p, s) {
    var rv = s.review, mine = '<div class="essay-log mine">' + esc(rv.text) + "</div>" + (rv.hint ? '<p class="tip"><b>AI 도움말</b> ' + esc(rv.hint) + "</p>" : "");
    if (rv.st === "pending") {
      return '<div class="fail-box wait-box"><b>선생님 확인을 기다리는 중입니다</b><p>아래 풀이를 선생님께 보냈습니다. 정답으로 인정되면 완등으로 처리됩니다.</p>' + mine +
        '<p class="fb" role="status">' + esc(ui.rvMsg || "") + "</p>" +
        '<div class="row"><button class="btn primary" data-act="rvPoll"' + (ui.busy ? " disabled" : "") + ">" + (ui.busy ? "확인하는 중…" : "확인 결과 새로 고침") + '</button><button class="btn" data-act="map">등산로 보기</button></div></div>';
    }
    if (rv.st === "no") {
      return '<div class="fail-box"><b>선생님이 오답으로 확인했습니다</b><p>풀이를 다시 살펴보고 새로 도전하세요. ' + failCost(p) + "</p>" + mine +
        '<div class="row"><button class="btn primary" data-act="rvAccept">다시 시작</button></div></div>';
    }
    return '<div class="fail-box"><b>기회 ' + CFG.limE + "번을 모두 썼습니다</b><p>마지막으로 낸 풀이입니다. 어떻게 할지 고르세요.</p>" + mine +
      '<div class="pick2"><button class="btn" data-act="rvAccept"><b>오답을 인정하고 다시 시작</b><small>' + failCost(p) + "</small></button>" +
      '<button class="btn primary" data-act="rvAsk"' + (ui.busy ? " disabled" : "") + "><b>" + (ui.busy ? "보내는 중…" : "선생님께 확인 요청") + "</b><small>내 풀이가 옳다고 생각하면 선생님이 직접 확인합니다.</small></button></div>" +
      '<p class="fb no" role="status">' + esc(ui.rvMsg || "") + "</p></div>";
  }
  function nextHtml(p, s) {
    var c = CAMPS[p.camp], sts = stages(c), k = -1, h = '<div class="done-box"><b>완등 +' + s.score + "점</b>";
    if (!c.bonus) sts.forEach(function (st, i) { if (k < 0 && !stageDone(st)) k = i; });
    if (k >= 0) {
      var st = sts[k];
      h += "<p>다음은 <b>" + st.label + "</b>입니다. " + (st.list.length > 1 ? "오를 길을 하나 고르세요." : "이 길을 완등하면 " + (p.camp === SUMMIT ? "마지막 관문이 열립니다." : c.name + "에 도착합니다.")) + '</p><div class="routes">' +
        st.list.map(function (q) { return routeBtn(q, false); }).join("") + "</div>";
    } else if (p.camp === SUMMIT && !S.final.done) {
      h += '<p>문제는 모두 통과했습니다. 이제 마지막 관문에서 캠프마다 적어 둔 핵심 정리를 다시 씁니다.</p><div><button class="btn primary" data-act="final">마지막 관문 도전</button></div>';
    } else h += "<p>" + (c.bonus ? "보너스 봉우리에 올랐습니다. 남은 길에도 도전해 보세요." : "이 구간을 통과했습니다.") + "</p>";
    return h + '<div><button class="btn small" data-act="map">등산로 보기</button></div></div>';
  }
  function vProb() {
    var p = BYID[S.cur], s = st(p.id), c = CAMPS[p.camp];
    var left = '<div class="card"><div class="meta"><span>' + c.name + " · " + c.topic + " · " + ROAD[p.pts] + " " + p.pts + "점</span>" +
      '<span class="miss">' + (s.miss ? "실수 " + s.miss + "회 (−" + Math.min(s.miss * 3, p.pts - minScore(p)) + "점)" : "") + "</span></div>" + qHtml(p) +
      (s.log.length ? '<div class="log"><h3>내 풀이</h3>' + logHtml(s, ui.fresh) + "</div>" : "") + "</div>";
    var right;
    if (s.done) {
      right = nextHtml(p, s);
    } else if (s.review) {
      right = reviewHtml(p, s);
    } else if (s.fail) {
      var fs = p.steps[s.step];
      right = '<div class="fail-box"><b>기회 ' + lim(fs) + "번을 모두 썼습니다</b><p>이 문제는 " + (p.essay ? "풀이를 처음부터" : "풀이 ①부터") + " 다시 시작해야 합니다. 아래 내용을 다시 읽고 도전하세요.</p>" +
        '<div class="hintbox"><b>이 구간의 핵심</b><p>' + c.tip + "</p><p>" + M(c.ex) + "</p><p>" + fs.h + "</p></div>" +
        '<div class="row"><button class="btn primary" data-act="restart">처음부터 다시 풀기</button><button class="btn" data-act="map">다른 길 고르기</button></div></div>';
    } else {
      var step = p.steps[s.step], L = lim(step), dots = "";
      for (var di = 0; di < L; di++) dots += '<i class="' + (di < L - s.tries ? "" : "used") + '"></i>';
      right = '<div class="card now"><div class="now-head"><h3>' + (p.essay ? "서술형 풀이" : "풀이 " + (s.step + 1) + " / " + p.steps.length + " 단계") + "</h3>" +
        '<span class="tries" aria-label="남은 기회 ' + (L - s.tries) + '번">남은 기회 ' + dots + '</span></div><p class="prompt">' + step.p + "</p>";
      if (step.t === "essay") {
        right += '<div class="symbols" aria-label="기호 넣기">' + ["∫", "^", "[ ]", "( )", "−", "/", "="].map(function (k) { return '<button type="button" data-sym="' + k + '">' + k + "</button>"; }).join("") + "</div>" +
          step.f.map(function (fd, i) {
            var lb = MARK[i] + " " + fd[0];
            return '<label class="essay-f" for="essay' + i + '">' + lb + '<textarea id="essay' + i + '" data-essay="' + i + '" rows="2" autocapitalize="off" autocomplete="off" spellcheck="false"' +
              ' placeholder="' + esc(fd[1]) + '"' + (ui.busy ? " readonly" : "") + ">" + esc(s.draft[i] || "") + "</textarea></label>";
          }).join("") +
          '<p class="hint" style="text-align:left">제곱은 x^2, 분수는 1/3처럼 씁니다.</p>' +
          '<div><button class="btn primary" data-act="grade" data-lockable data-label="채점 받기"' + (ui.busy ? ' data-off="1" disabled' : "") + ">" + (ui.busy ? "채점 중…" : "채점 받기") + "</button></div>";
      } else if (step.t === "choice") {
        if (!ui.order) ui.order = shuffle(step.o.length);
        right += '<div class="opts">' + ui.order.map(function (i) {
          var w = s.wrong.indexOf(i) >= 0;
          return '<button class="opt' + (step.o[i].indexOf("T:") === 0 ? " t" : "") + (w ? " wrong" : "") + '" data-lockable data-opt="' + i + '"' + (w ? ' data-off="1" disabled' : "") + ">" + optHtml(step.o[i]) + "</button>";
        }).join("") + "</div>";
      } else {
        if (step.show) right += '<div class="formula">' + M(step.show) + "</div>";
        right += '<div class="fields' + (step.show ? " few" : "") + '">' + step.f.map(function (f, i) {
          var cls = ui.ok[i] ? " ok" : ui.no[i] ? " no" : i === ui.active ? " active" : "";
          return '<button class="field' + cls + '" data-field="' + i + '"><span>' + M(f[0] + " =") + '</span><span class="val">' + esc(ui.vals[i] || "") + "</span></button>";
        }).join("") + "</div>" +
          '<div class="pad">' + ["7", "8", "9", "⌫", "4", "5", "6", "-", "1", "2", "3", "/"].map(function (k) {
            return '<button class="key" data-key="' + k + '" aria-label="' + (k === "⌫" ? "지우기" : k === "-" ? "음수 부호" : k === "/" ? "분수 기호" : k) + '">' + (k === "-" ? "−" : k) + "</button>";
          }).join("") + '<button class="key" data-key="0">0</button><button class="key go" data-key="go" data-lockable data-label="확인">확인</button></div>' +
          '<p class="hint">분수는 4/3, 음수는 −4처럼 입력합니다.</p>';
      }
      right += '<p class="fb ' + (ui.fb ? ui.fb[0] : "") + '" role="status">' + (ui.fb ? ui.fb[1] : "") + '</p><p class="wait" data-wait role="status"></p>';
      if (s.hint) right += '<div class="hintbox"><b>다시 생각해 보기</b>' + (s.ai ? "<p>" + esc(s.ai) + "</p>" : "") + (s.why ? '<p><b class="hl">방금 고른 답</b>' + s.why + "</p>" : "") + "<p>" + askOf(p, s.step) + "</p>" +
        (s.hintOpen ? '<p><b class="hl">힌트</b>' + step.h + "</p>" : '<p><button class="btn small" data-act="hint">그래도 모르겠으면 힌트 보기</button></p>') + "</div>";
      right += "</div>";
    }
    return bar(true) + '<div class="prob">' + left + right + "</div>";
  }

  function vRecord() {
    var sm = summary();
    var h = bar(true) + '<div class="card" style="display:flex;flex-direction:column;gap:14px"><h2>' + esc(S.name) + "의 등반 기록</h2>" +
      '<div class="sum"><div><small>도달 높이</small><b>' + comma(sm.alt) + "m</b></div><div><small>총점</small><b>" + comma(sm.score) + "점</b></div>" +
      "<div><small>완등한 문제</small><b>" + sm.done + "개</b></div><div><small>서술길</small><b>" + sm.essays + "개</b></div><div><small>실수</small><b>" + sm.miss + "회</b></div></div>";
    if (!sm.done) h += '<p class="empty">아직 완등한 문제가 없습니다. 푼 문제의 풀이가 여기에 한 줄씩 기록됩니다.</p>';
    CAMPS.forEach(function (c) {
      c.probs.forEach(function (p) {
        var s = S.probs[p.id]; if (!s || !s.done) return;
        h += '<div class="rec"><div class="rec-head">' + c.name + " · " + c.topic + " · " + ROAD[p.pts] + "<span>" + s.score + " / " + p.pts + "점 · 실수 " + s.miss + "회" + (s.hints ? " · 힌트 " + s.hints + "회" : "") +
          (s.resets ? " · 다시 시작 " + s.resets + "회" : "") + "</span></div>" + qHtml(p) + logHtml(s) + "</div>";
      });
    });
    return h + "</div>";
  }

  /* ---------- 마지막 관문: 개념 빈칸 ---------- */
  var BL = ["(가)", "(나)"];
  function vFinal() {
    var f = S.final, h = bar(true) + '<div class="gate"><div class="card"><h2>마지막 관문</h2><p class="tip" style="margin-top:8px">캠프마다 공책에 적어 둔 핵심 정리를 보고 빈칸을 채우세요. 여섯 개를 모두 맞혀야 정상에 오릅니다.</p></div>';
    for (var ci = 0; ci < SUMMIT + 1; ci++) {
      var c = CAMPS[ci], n = NOTES[c.key], ok = !!f.ok[c.key], fb = gateFb[c.key], tr = f.tries[c.key] || 0, dots = "";
      for (var di = 0; di < limN(); di++) dots += '<i class="' + (di < limN() - tr ? "" : "used") + '"></i>';
      h += '<div class="card gate-item' + (ok ? " ok" : "") + '"><div class="gate-head"><span>' + c.name + " · " + c.topic + "</span>" +
        (ok ? '<span class="ok">✓ 통과</span>' : '<span class="tries">남은 기회 ' + dots + "</span>") + '</div><div class="formula">' +
        (ok ? n.full : n.quiz).map(function (l) { return "<div>" + l + "</div>"; }).join("") + "</div>";
      if (!ok) {
        h += '<div class="blanks">' + n.blanks.map(function (_, i) {
          var v = (f.vals[c.key] || [])[i] || "";
          return '<label for="bl' + c.key + i + '">' + BL[i] + '<input id="bl' + c.key + i + '" data-blank="' + c.key + ":" + i + '" maxlength="6" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="' + esc(v) + '"' +
            (fb && fb.bad && fb.bad[i] ? ' class="no"' : "") + "></label>";
        }).join("") + '<button class="btn primary" data-gate="' + c.key + '" data-lockable data-label="확인">확인</button></div>' +
          '<p class="fb no" role="status">' + (fb ? fb.msg : "") + '</p><p class="wait" data-wait role="status"></p>';
      }
      h += "</div>";
    }
    return h + "</div>";
  }
  function normBlank(v) { return String(v || "").trim().toLowerCase().replace(/[−–—ㅡ]/g, "-").replace(/＋/g, "+").replace(/\s/g, ""); }
  function checkGate(key) {
    if (lockLeft()) return;
    var f = S.final, n = NOTES[key], vals = f.vals[key] || [], bad = [], anyBad = false, empty = false;
    n.blanks.forEach(function (acc, i) { var v = normBlank(vals[i]); if (!v) empty = true; bad[i] = acc.indexOf(v) < 0; if (bad[i]) anyBad = true; });
    if (empty) { gateFb[key] = { msg: "빈칸을 모두 채운 뒤 확인을 누르세요.", bad: [] }; render(); return; }
    if (!anyBad) {
      f.ok[key] = true; delete gateFb[key]; dirty = true;
      if (Object.keys(f.ok).length >= SUMMIT + 1) {
        f.done = true; if (!S.end) S.end = Date.now();
        queueSave({ camp: "정상", id: "개념 관문", road: "마지막 관문", result: "통과", score: 0, miss: f.miss, work: "" });
        render(); setTimeout(function () { celebrate(SUMMIT); }, calm ? 0 : 400); return;
      }
      save(); render(); return;
    }
    f.miss++; f.tries[key] = (f.tries[key] || 0) + 1; dirty = true; startLock();
    f.msk = f.msk || {}; f.msk[key] = (f.msk[key] || 0) + 1;
    if (f.tries[key] >= limN()) {
      f.tries[key] = 0; f.vals[key] = []; delete gateFb[key]; save(); render();
      showNote(BYKEY[key], true); return;
    }
    gateFb[key] = { msg: "틀렸습니다. 공책에서 ‘" + CAMPS[BYKEY[key]].name + "’ 정리를 찾아 다시 써 보세요.", bad: bad };
    save(); render();
  }

  /* ---------- 개념 정리 팝업 ---------- */
  function checkNote() {
    if (document.querySelector(".note, .cele")) return;
    for (var ci = 0; ci <= SUMMIT; ci++) if (probsPassed(ci) && !S.note[ci]) { showNote(ci, false); return; }
  }
  function showNote(ci, review) {
    var old = document.querySelector(".note"); if (old) old.remove();
    var c = CAMPS[ci], n = NOTES[c.key], d = document.createElement("div");
    d.className = "note"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", c.name + " 핵심 정리");
    d.innerHTML = '<div class="note-in"><p class="kicker">' + c.name + " · " + c.topic + "</p><h2>" + (review ? "다시 읽고 적어 두세요" : "핵심 정리") + '</h2><p class="say">' + n.say + "</p>" +
      '<div class="formula">' + n.full.map(function (l) { return "<div>" + l.replace(/\\boxed\{([^{}]*)\}/g, "$1") + "</div>"; }).join("") + "</div>" +
      '<p class="memo">' + (review ? "기회를 모두 썼습니다. 이 내용을 공책에 적은 뒤 닫고, 이 캠프의 빈칸을 처음부터 다시 쓰세요." :
        "<b>지금 공책에 그대로 적어 두세요.</b> 정상 직전 마지막 관문에서 이 내용을 다시 묻습니다. 이 정리는 다시 열어 볼 수 없습니다.") + "</p>" +
      '<label class="chk" for="noteChk"><input type="checkbox" id="noteChk"> 공책에 적었습니다</label>' +
      '<div><button class="btn primary" id="noteClose" disabled>닫기</button></div></div>';
    document.body.appendChild(d);
    var chk = d.querySelector("#noteChk"), btn = d.querySelector("#noteClose");
    chk.addEventListener("change", function () { btn.disabled = !chk.checked; });
    btn.addEventListener("click", function () {
      d.remove();
      if (!review) { S.note[ci] = Date.now(); dirty = true; save(); checkNote(); maybeTour(); }
    });
    typeset(d);
  }

  function showEssayTip() {
    var d = document.createElement("div");
    d.className = "note"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "서술길 쓰는 법");
    d.innerHTML = '<div class="note-in"><p class="kicker">서술길 쓰는 법</p><h2>거듭제곱은 ^ 로 씁니다</h2>' +
      '<p class="say">풀이를 키보드로 쓰기 때문에, 식을 아래처럼 약속된 방법으로 씁니다.</p>' +
      '<table class="how"><tbody>' +
      "<tr><th>거듭제곱</th><td>" + M("x^{2}") + "</td><td><kbd>x^2</kbd></td></tr>" +
      "<tr><th>분수</th><td>" + M("\\tfrac{1}{3}x^{3}") + "</td><td><kbd>1/3x^3</kbd></td></tr>" +
      "<tr><th>부정적분에 대입</th><td>" + M("\\left[x^{2}\\right]_{0}^{1}") + "</td><td><kbd>[x^2] 0에서 1까지</kbd></td></tr>" +
      "<tr><th>정적분</th><td>" + M("\\int_{0}^{1}2x\\,dx") + "</td><td><kbd>∫(2x)dx 0에서 1까지</kbd></td></tr>" +
      "</tbody></table>" +
      '<p class="memo">^ 와 ∫ 는 입력 칸 위의 기호 버튼을 눌러도 들어갑니다.</p>' +
      '<div><button class="btn primary" id="tipClose">알겠습니다</button></div></div>';
    document.body.appendChild(d);
    d.querySelector("#tipClose").addEventListener("click", function () { d.remove(); S.tipEssay = Date.now(); save(); });
    typeset(d);
  }

  /* ---------- 관리자 모드: 학급별·단계별 달성률 ---------- */
  var STAGES = CAMPS.slice(0, SUMMIT + 1).map(function (c, ci) { return { name: c.name, sub: c.topic, get: function (s) { return s.c[ci]; } }; })
    .concat([{ name: "마지막 관문", sub: "개념 빈칸 · 정상 등정", get: function (s) { return s.f; } }, { name: "보너스", sub: CAMPS[BONUS].topic, get: function (s) { return s.c[BONUS]; } }]);
  function classOf(sid) {
    sid = String(sid || "").replace(/\D/g, "");
    if (sid.length >= 5) return { key: sid.slice(0, 3), label: sid.charAt(0) + "학년 " + parseInt(sid.slice(1, 3), 10) + "반" };
    if (sid.length === 4) return { key: sid.slice(0, 2), label: sid.charAt(0) + "학년 " + sid.charAt(1) + "반" };
    return { key: "zzz", label: "학급 미확인" };
  }
  function sampleData() {
    var out = [], fam = "김이박최정강조윤장임", giv = ["하늘", "바다", "서준", "지우", "도윤", "서연", "민준", "하은", "예준", "수아"];
    for (var k = 1; k <= 3; k++) for (var n = 1; n <= 9; n++) {
      var reach = (n * 7 + k * 3) % 9, c = [0, 0, 0, 0, 0, 0, 0];
      for (var i = 0; i < Math.min(reach, 6); i++) c[i] = 1;
      if (reach >= 8) c[6] = 1;
      var it = {}, g = {};
      CAMPS.forEach(function (cp, ci) {
        if (ci > Math.min(reach, 5)) return;
        cp.probs.forEach(function (q, qi) {
          if (cp.bonus || qi === 1 || qi === 3) return;
          var m = (n * (qi + 2) + k + ci * 3) % (qi === 0 ? 3 : 5), ms = [], wo = {};
          if (m) { ms[(n + ci) % q.steps.length] = m; if (q.steps[0].t === "choice") { ms = [m]; wo["0:" + (1 + (n + ci) % 3)] = m; } }
          it[q.id] = [ci < reach ? 1 : 0, m, ms, wo];
        });
        if (reach >= 7) g[cp.key] = [1, (n + ci) % 3];
      });
      out.push({ sid: "2" + ("0" + k).slice(-2) + ("0" + n).slice(-2), name: fam.charAt((n + k) % 10) + giv[(n * k) % 10], c: c, f: reach >= 7 ? 1 : 0, score: reach * 31 + n, pos: "", it: it, g: g });
    }
    return out;
  }
  function sampleReviews() {
    return [{ who: "20103 최서준", camp: "제2캠프", id: "C5", text: "① [하나의 정적분으로 합친 식] ∫3x^2 dx 0에서 3까지\n② [합친 식의 부정적분과 대입] [x^3] 0에서 3까지 = 27 - 0\n③ [계산과 답] 27", hint: "합친 식의 구간 표기가 분명하지 않습니다.", at: "2026-11-16T01:20:00Z" }];
  }
  function sampleEssays() {
    return [
      { who: "20101 이하늘", camp: "베이스캠프", id: "A5", result: "서술 오답", text: "① [x^3-x^2+x]\n② 2 대입\n③ 6", hint: "아래끝을 대입해 빼는 과정이 빠졌습니다.", at: "2026-11-16T01:12:00Z" },
      { who: "20101 이하늘", camp: "베이스캠프", id: "A5", result: "서술 정답", text: "① [x^3-x^2+x]\n② (8-4+2)-(-1-1-1)\n③ 9", hint: "대입 과정이 잘 드러났습니다.", at: "2026-11-16T01:14:00Z" },
      { who: "20102 박바다", camp: "베이스캠프", id: "A5", result: "서술 정답", text: "① x^3-x^2+x\n② 6-(-3)\n③ 9", hint: "부정적분과 대입이 모두 보입니다.", at: "2026-11-16T01:15:00Z" }
    ];
  }
  function when(v) { var d = new Date(v); if (isNaN(d)) return ""; var z = function (n) { return ("0" + n).slice(-2); }; return (d.getMonth() + 1) + "/" + d.getDate() + " " + z(d.getHours()) + ":" + z(d.getMinutes()); }
  function essaysOf(who) { return adm.essays.filter(function (e) { return e.who === who; }); }
  function vAdmin() {
    var h = '<div class="bar"><button class="btn small" data-act="adminExit">← 첫 화면</button></div><div class="card admin"><h2>관리자 모드</h2>';
    if (!adm.data) {
      return h + '<p class="note-line">' + (HAS ? "‘설정’ 시트의 관리자 비밀번호를 입력하세요." : "아직 서버 주소(config.js)가 설정되지 않았습니다. 아무 비밀번호나 넣으면 예시 데이터가 나옵니다.") + "</p>" +
        '<div class="row"><input type="password" id="adminPw" autocomplete="off" placeholder="비밀번호"' + (adm.busy ? " disabled" : "") + ">" +
        '<button class="btn primary" data-act="adminLogin"' + (adm.busy ? " disabled" : "") + ">" + (adm.busy ? "확인 중…" : "들어가기") + "</button></div>" +
        '<p class="err" role="status">' + esc(adm.err) + "</p></div>";
    }
    var groups = {}, keys = [];
    adm.data.forEach(function (s) { var g = classOf(s.sid); if (!groups[g.key]) { groups[g.key] = { label: g.label, list: [] }; keys.push(g.key); } groups[g.key].list.push(s); });
    keys.sort();
    function cells(list) {
      return STAGES.map(function (st) {
        var n = list.filter(function (s) { return st.get(s); }).length, pct = list.length ? Math.round(n * 100 / list.length) : 0;
        return '<td style="background:color-mix(in srgb, var(--accent) ' + Math.round(pct * 0.5) + '%, transparent)"><b>' + pct + "%</b><small>" + n + " / " + list.length + "</small></td>";
      }).join("");
    }
    h += '<p class="note-line">' + (HAS ? "" : "<b>예시 데이터</b> · ") + "입장한 학생 " + adm.data.length + "명 기준 · 각 칸은 그 단계를 통과한 학생의 비율입니다. 학급 이름을 누르면 학생 명단이 나옵니다.</p>" +
      '<div class="row"><button class="btn small" data-act="adminRefresh"' + (adm.busy ? " disabled" : "") + ">" + (adm.busy ? "불러오는 중…" : "새로 고침") + '</button><button class="btn small danger" data-act="adminDelAll"' + (adm.busy || !adm.data.length ? " disabled" : "") + '>전체 학생 삭제</button>' +
      '<span class="err">' + esc(adm.err) + '</span><span class="okmsg" role="status">' + esc(adm.msg) + "</span></div>" +
      reviewsHtml() +
      '<div class="tbl-wrap"><table class="rate"><thead><tr><th>학급</th><th>인원</th>' + STAGES.map(function (st) { return "<th>" + st.name + "<small>" + st.sub + "</small></th>"; }).join("") + "</tr></thead><tbody>" +
      keys.map(function (k) { var g = groups[k]; return '<tr' + (adm.open === k ? ' class="sel"' : "") + '><th><button data-cls="' + k + '">' + g.label + "</button></th><td>" + g.list.length + "</td>" + cells(g.list) + "</tr>"; }).join("") +
      '<tr class="tot"><th>전체</th><td>' + adm.data.length + "</td>" + cells(adm.data) + "</tr></tbody></table></div>";
    if (!adm.data.length) h += '<p class="note-line">아직 입장한 학생이 없습니다.</p>';
    var scoped = adm.open && groups[adm.open] ? groups[adm.open] : null, tail = itemsHtml(scoped ? scoped.list : adm.data, scoped ? scoped.label : "전체");
    if (adm.open && groups[adm.open]) {
      var list = groups[adm.open].list.slice().sort(function (a, b) { return String(a.sid).localeCompare(String(b.sid)); });
      h += "<h2>" + groups[adm.open].label + ' 명단</h2><div class="tbl-wrap"><table class="list"><thead><tr><th>선택</th><th>학번</th><th>이름</th><th>통과한 단계</th><th>총점</th><th>서술길 답안</th></tr></thead><tbody>' +
        list.map(function (s) {
          var last = "아직 없음"; STAGES.forEach(function (st) { if (st.get(s)) last = st.name; });
          var cnt = STAGES.filter(function (st) { return st.get(s); }).length;
          var who = s.sid + " " + s.name, ne = essaysOf(who).length;
          return "<tr" + (adm.stu === who ? ' class="sel"' : "") + '><td><input type="checkbox" class="pickbox" id="pick' + esc(s.sid) + '" data-sel="' + esc(who) + '" aria-label="' + esc(who) + ' 선택"' + (adm.sel[who] ? " checked" : "") + "></td><td>" + esc(s.sid) + "</td><td>" + esc(s.name) + "</td><td>" + cnt + " / " + STAGES.length + " · " + last + "</td><td>" + (Number(s.score) || 0) + "</td><td>" +
            (ne ? '<button class="btn small" data-stu="' + esc(who) + '">' + (adm.stu === who ? "닫기" : ne + "건 보기") + "</button>" : "없음") + "</td></tr>";
        }).join("") + "</tbody></table></div>";
      var nSel = list.filter(function (s) { return adm.sel[s.sid + " " + s.name]; }).length;
      h += '<div class="row"><button class="btn small danger" data-act="adminDelSel"' + (nSel && !adm.busy ? "" : " disabled") + ">선택 학생 삭제" + (nSel ? " (" + nSel + "명)" : "") + '</button><span class="note-line">삭제하면 그 학생의 등반기록과 풀이기록이 시트에서 지워지고, 다음에 입장할 때 처음부터 시작합니다.</span></div>';
      if (adm.stu && list.some(function (s) { return s.sid + " " + s.name === adm.stu; })) {
        var es = essaysOf(adm.stu);
        h += '<div id="essayPanel" class="essays"><h2>' + esc(adm.stu) + " · 서술길 답안</h2>" +
          '<p class="note-line">제출한 순서대로 모두 보여 줍니다. 오답으로 채점된 제출도 포함됩니다.</p>' +
          es.map(function (e) {
            var ok = e.result === "서술 정답", q = BYID[e.id];
            return '<div class="essay-card' + (ok ? " ok" : "") + '"><div class="essay-head"><b>' + esc(e.camp) + (q ? " · " + CAMPS[q.camp].topic : "") + '</b><span class="badge' + (ok ? " ok" : "") + '">' + (ok ? "정답" : "오답") + "</span><span>" + when(e.at) + "</span></div>" +
              (q ? '<div class="q">' + M(q.tex) + "</div>" : "") +
              '<div class="essay-log">' + esc(e.text) + "</div>" +
              (e.hint ? '<p class="note-line"><b>AI 도움말</b> ' + esc(e.hint) + "</p>" : "") + "</div>";
          }).join("") + "</div>";
      }
    }
    return h + tail + "</div>";
  }
  /* 문항별 오답률: 도전한 학생 가운데 한 번이라도 틀린 학생의 비율.
     어느 줄에서 많이 틀렸는지, 선택형이면 어떤 오답을 많이 골랐는지도 보여 준다. */
  function itemStats(list) {
    var rows = [];
    CAMPS.forEach(function (c) {
      c.probs.forEach(function (p) {
        var r = { label: c.name + " · " + ROAD[p.pts], q: p, n: 0, done: 0, bad: 0, miss: 0, steps: p.steps.map(function () { return 0; }), opts: {} };
        list.forEach(function (s) {
          var v = s.it && s.it[p.id]; if (!v) return;
          r.n++; if (v[0]) r.done++; if (v[1] > 0) r.bad++; r.miss += v[1] || 0;
          (v[2] || []).forEach(function (m, k) { if (m && k < r.steps.length) r.steps[k] += m; });
          Object.keys(v[3] || {}).forEach(function (key) { r.opts[key] = (r.opts[key] || 0) + v[3][key]; });
        });
        rows.push(r);
      });
    });
    CAMPS.slice(0, SUMMIT + 1).forEach(function (c) {
      var r = { label: "마지막 관문 · " + c.name, gate: c.key, n: 0, done: 0, bad: 0, miss: 0, steps: [], opts: {} };
      list.forEach(function (s) { var v = s.g && s.g[c.key]; if (!v) return; r.n++; if (v[0]) r.done++; if (v[1] > 0) r.bad++; r.miss += v[1] || 0; });
      rows.push(r);
    });
    return rows;
  }
  function itemsHtml(list, scope) {
    var rows = itemStats(list).filter(function (r) { return r.n > 0; });
    var h = "<h2>문항별 오답률 <small>" + esc(scope) + "</small></h2>";
    if (!rows.length) return h + '<p class="note-line">아직 문제를 푼 기록이 없습니다.</p>';
    if (adm.byBad) rows.sort(function (a, b) { return b.bad / b.n - a.bad / a.n || b.miss - a.miss; });
    return h + '<div class="row"><p class="note-line">오답률은 그 문제에 도전한 학생 가운데 한 번이라도 틀린 학생의 비율입니다. 학급 이름을 누르면 그 학급만 집계합니다.</p>' +
      '<button class="btn small" data-act="adminSort">' + (adm.byBad ? "등산로 순서로 보기" : "오답률 높은 순으로 보기") + "</button></div>" +
      '<div class="tbl-wrap"><table class="list items"><thead><tr><th>문항</th><th>문제</th><th>도전</th><th>오답률</th><th>평균 오답</th><th>많이 틀린 줄</th><th>가장 많이 고른 오답</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var pct = Math.round(r.bad * 100 / r.n), top = "", maxS = Math.max.apply(null, r.steps.concat([0]));
        var stepTxt = r.q && r.q.steps.length > 1 ? r.steps.map(function (m, k) { return '<span class="' + (m && m === maxS ? "hot" : "") + '">' + MARK[k] + " " + m + "</span>"; }).join(" ") : "";
        var best = null; Object.keys(r.opts).forEach(function (key) { if (!best || r.opts[key] > r.opts[best]) best = key; });
        if (best && r.q) { var kv = best.split(":"), stp = r.q.steps[+kv[0]]; if (stp && stp.o && stp.o[+kv[1]]) top = '<span class="pick">' + MARK[+kv[0]] + " " + optHtml(stp.o[+kv[1]]) + "</span> <small>" + r.opts[best] + "회</small>"; }
        return "<tr><th>" + r.label + '</th><td class="qcell">' + (r.q ? (r.q.text ? "글로 된 문제" : M(r.q.tex)) : "개념 빈칸") + "</td><td>" + r.n + "명</td>" +
          '<td><div class="meter"><i style="width:' + pct + '%"></i></div><b>' + pct + "%</b> <small>" + r.bad + " / " + r.n + "</small></td><td>" + (r.miss / r.n).toFixed(1) + "회</td><td>" + stepTxt + "</td><td>" + top + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* 학생이 보낸 서술길 확인 요청: 관리자 화면 맨 위에 보인다 */
  function reviewsHtml() {
    var rv = adm.reviews || [];
    if (!rv.length) return '<p class="note-line rv-none">서술길 확인 요청이 없습니다.</p>';
    return '<div class="reviews"><h2>확인 요청 ' + rv.length + '건</h2><p class="note-line">서술길에서 기회를 다 쓴 학생이 자기 풀이를 확인해 달라고 보냈습니다. 정답으로 인정하면 그 학생은 완등으로 처리됩니다.</p>' +
      rv.map(function (e) {
        var q = BYID[e.id];
        return '<div class="essay-card rv"><div class="essay-head"><b>' + esc(e.who) + "</b><span>" + esc(e.camp) + (q ? " · " + CAMPS[q.camp].topic : "") + "</span><span>" + when(e.at) + "</span></div>" +
          (q ? '<div class="q">' + M(q.tex) + "</div>" : "") + '<div class="essay-log">' + esc(e.text) + "</div>" +
          (e.hint ? '<p class="note-line"><b>AI 도움말</b> ' + esc(e.hint) + "</p>" : "") +
          '<div class="row"><button class="btn small primary" data-rvid="' + esc(e.id) + '" data-rvwho="' + esc(e.who) + '" data-rvok="1"' + (adm.busy ? " disabled" : "") + '>정답 인정</button>' +
          '<button class="btn small danger" data-rvid="' + esc(e.id) + '" data-rvwho="' + esc(e.who) + '" data-rvok="0"' + (adm.busy ? " disabled" : "") + ">오답 처리</button></div></div>";
      }).join("") + "</div>";
  }
  function adminReview(who, id, ok) {
    adm.busy = true; adm.err = ""; adm.msg = ""; render();
    var req = HAS ? call("apiAdminReview", { pw: adm.pw, who: who, id: id, ok: ok }) :
      Promise.resolve({ ok: true, students: adm.data, essays: adm.essays, reviews: adm.reviews.filter(function (e) { return !(e.who === who && e.id === id); }) });
    req.then(function (r) {
      adm.busy = false;
      if (!r || !r.ok) { adm.err = (r && r.error) || "처리하지 못했습니다."; render(); return; }
      adm.data = r.students || []; adm.essays = r.essays || []; adm.reviews = r.reviews || [];
      adm.msg = who + " 학생의 풀이를 " + (ok ? "정답으로 인정했습니다." : "오답으로 처리했습니다."); render();
    }).catch(function () { adm.busy = false; adm.err = "접속하지 못했습니다. 새로 고침으로 처리 여부를 확인하세요."; render(); });
  }
  /* 관리자 화면을 열어 두면 새 확인 요청이 들어왔는지 30초마다 살핀다 */
  setInterval(function () {
    if (S.view !== "admin" || !adm.data || adm.busy || !HAS || document.querySelector(".note")) return;
    call("apiAdmin", adm.pw).then(function (r) {
      if (!r || !r.ok || S.view !== "admin" || adm.busy) return;
      var before = JSON.stringify(adm.reviews);
      adm.data = r.students || []; adm.essays = r.essays || []; adm.reviews = r.reviews || [];
      if (JSON.stringify(adm.reviews) !== before) render();                 /* 요청이 바뀌었을 때만 다시 그린다 */
    }).catch(function () {});
  }, 30000);

  /* 삭제는 되돌릴 수 없으므로 한 번 더 확인받는다 */
  function confirmDelete(names, all) {
    var d = document.createElement("div");
    d.className = "note"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "삭제 확인");
    d.innerHTML = '<div class="note-in danger"><p class="kicker">되돌릴 수 없습니다</p><h2>' + (all ? "전체 학생 " + adm.data.length + "명을 삭제할까요?" : "선택한 학생 " + names.length + "명을 삭제할까요?") + "</h2>" +
      '<p class="say">' + (all ? "모든 학생의 등반기록과 풀이기록이 시트에서 지워집니다." : esc(names.join(", "))) + "</p>" +
      '<p class="memo">삭제된 학생은 다음에 입장할 때 처음부터 다시 시작합니다. 서술길에 제출한 풀이도 함께 지워집니다.</p>' +
      '<label class="chk" for="delChk"><input type="checkbox" id="delChk"> 되돌릴 수 없음을 확인했습니다</label>' +
      '<div class="row"><button class="btn danger solid" id="delGo" disabled>삭제</button><button class="btn" id="delNo">취소</button></div></div>';
    document.body.appendChild(d);
    var chk = d.querySelector("#delChk"), go = d.querySelector("#delGo");
    chk.addEventListener("change", function () { go.disabled = !chk.checked; });
    d.querySelector("#delNo").addEventListener("click", function () { d.remove(); });
    go.addEventListener("click", function () { d.remove(); adminDelete(names, all); });
  }
  function adminDelete(names, all) {
    adm.busy = true; adm.err = ""; adm.msg = ""; render();
    var req;
    if (HAS) req = call("apiAdminDelete", { pw: adm.pw, all: !!all, who: names });
    else {                                               /* 서버 연결 전: 예시 데이터에서만 지운다 */
      var keep = all ? [] : adm.data.filter(function (s) { return names.indexOf(s.sid + " " + s.name) < 0; });
      req = Promise.resolve({ ok: true, removed: adm.data.length - keep.length, students: keep, essays: adm.essays.filter(function (e) { return keep.some(function (s) { return s.sid + " " + s.name === e.who; }); }) });
    }
    req.then(function (r) {
      adm.busy = false;
      if (!r || !r.ok) { adm.err = (r && r.error) || "삭제하지 못했습니다."; render(); return; }
      adm.data = r.students || []; adm.essays = r.essays || []; adm.reviews = r.reviews || []; adm.sel = {}; adm.stu = null;
      adm.msg = r.removed + "명을 삭제했습니다."; render();
    }).catch(function () { adm.busy = false; adm.err = "접속하지 못했습니다. 삭제되지 않았을 수 있으니 새로 고침으로 확인하세요."; render(); });
  }
  function adminLoad(pw) {
    adm.busy = true; adm.err = ""; render();
    var req = HAS ? call("apiAdmin", pw) : Promise.resolve({ ok: true, students: sampleData(), essays: sampleEssays(), reviews: sampleReviews() });
    req.then(function (r) {
      adm.busy = false;
      if (!r || !r.ok) { adm.err = (r && r.error) || "불러오지 못했습니다."; if (!adm.data) adm.pw = ""; render(); return; }
      adm.pw = pw; adm.data = r.students || []; adm.essays = r.essays || []; adm.reviews = r.reviews || []; adm.sel = {}; adm.msg = ""; render();
    }).catch(function () { adm.busy = false; adm.err = "접속하지 못했습니다. 인터넷 연결을 확인하세요."; render(); });
  }

  function render() {
    var wide = (S.view === "prob" && BYID[S.cur]) || S.view === "admin";
    app.className = "wrap" + (wide ? " wide" : "");
    app.classList.toggle("intro-view", S.view === "intro");
    app.innerHTML = S.view === "admin" ? vAdmin() : S.view === "map" ? vMap() : S.view === "final" ? vFinal() : S.view === "prob" && BYID[S.cur] ? vProb() : S.view === "record" ? vRecord() : vIntro();
    typeset(); applyLock();
    if (S.view === "prob" && !S.tutPad && app.querySelector(".pad")) setTimeout(maybeTour, 250);
  }

  /* ---------- 축하 장면 ---------- */
  function confetti(canvas, amount) {
    var ctx = canvas.getContext("2d"), dpr = Math.min(window.devicePixelRatio || 1, 2), W, H, t0 = 0, parts = [];
    function size() { W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    size();
    var cols = ["#D2541B", "#0F6B78", "#F2B705", "#1B7F4A", "#FFFFFF", "#5CC4D3"];
    for (var i = 0; i < amount; i++) parts.push({ x: W / 2 + (Math.random() - .5) * W * .5, y: H * .45, vx: (Math.random() - .5) * 13, vy: -6 - Math.random() * 11,
      s: 6 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[i % cols.length] });
    function frame(t) {
      if (!canvas.isConnected) return;
      if (!t0) t0 = t; var el = t - t0;
      ctx.clearRect(0, 0, W, H);
      parts.forEach(function (p) {
        p.vy += .32; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - el / 3200);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      });
      if (el < 3200) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function countUp(el, a, b) {
    if (calm || a === b) { el.textContent = comma(b) + "m"; return; }
    var t0 = 0;
    function f(t) { if (!el.isConnected) return; if (!t0) t0 = t; var k = Math.min(1, (t - t0) / 1300), e = 1 - Math.pow(1 - k, 3); el.textContent = comma(Math.round(a + (b - a) * e)) + "m"; if (k < 1) requestAnimationFrame(f); }
    requestAnimationFrame(f);
  }
  /* kind: "start" 또는 통과한 구간 번호 */
  function celebrate(kind) {
    var old = document.querySelector(".cele"); if (old) old.remove();
    var start = kind === "start", ci = start ? -1 : kind, c = start ? null : CAMPS[ci];
    var from = start ? 0 : Math.min(ci, CV.N), to = start ? 0 : Math.min(ci + 1, CV.N);
    var prevAlt = start || ci === 0 ? 0 : CAMPS[ci - 1].alt;
    var title = start ? "등반 시작!" : ci === SUMMIT ? "정상 등정!" : ci === BONUS ? "보너스 봉우리 정복!" : c.name + " 도착!";
    var sub = start ? "정상까지 " + comma(CAMPS[SUMMIT].alt) + "m. 첫 목표는 베이스캠프입니다." :
      ci === SUMMIT ? "모든 구간을 올랐습니다. 보너스 봉우리가 열렸습니다." :
      ci === BONUS ? "산 위의 산까지 올랐습니다. 대단합니다!" :
      "다음 구간은 ‘" + CAMPS[ci + 1].topic + "’입니다.";
    var d = document.createElement("div");
    d.className = "cele"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", title);
    d.innerHTML = "<canvas></canvas><div class=\"cele-in\">" + curveSvg(from, from) +
      '<p class="kicker">' + esc(S.name) + "</p><h2>" + title + '</h2><p class="altnum" id="celeAlt">' + comma(prevAlt) + 'm</p><p class="sub">' + sub + "</p>" +
      '<button class="btn primary" data-act="celeClose">' + (start ? "출발" : "계속 오르기") + "</button></div>";
    document.body.appendChild(d);
    d.querySelector("[data-act=celeClose]").addEventListener("click", function () { d.remove(); if (!start) go("map"); else maybeTour(); });
    var move = function () {
      var g = d.querySelector("#cvClimber"); if (!g) return;
      var sp = standAt(to); g.style.transform = "translate(" + sp[0] + "px," + sp[1] + "px)";
      if (to > from) {                                   /* 방금 오른 구간에 색이 차오른다 */
        var strip = d.querySelector('[data-strip="' + (to - 1) + '"]'), nm = d.querySelector('[data-name="' + (to - 1) + '"]');
        setTimeout(function () { if (strip) strip.setAttribute("class", "cv-strip on"); if (nm) nm.setAttribute("class", "cv-name " + (to - 1 < 3 ? "dark" : "light")); }, calm ? 0 : 700);
      }
      countUp(d.querySelector("#celeAlt"), prevAlt, start ? 0 : c.alt);
      if (!start && !calm) setTimeout(function () { if (d.isConnected) confetti(d.querySelector("canvas"), ci >= SUMMIT ? 220 : 110); }, 900);
    };
    setTimeout(move, calm ? 0 : 450);
    var b = d.querySelector(".btn"); if (b && b.focus) b.focus({ preventScroll: true });
  }

  /* ---------- 채점 ---------- */
  function workText(s) { return s.log.map(function (l, k) { return (l.k === "e" ? "" : MARK[k] + " ") + String(l.v).replace(/\\\(|\\\)|\\displaystyle ?/g, ""); }).join("\n"); }
  function advance(p, s, entry) {
    s.log.push(entry); s.step++; s.tries = 0; s.wrong = []; s.hint = false; s.hintOpen = false; s.ai = ""; s.why = "";
    ui = freshUi(); ui.fresh = true; ui.fb = ["ok", "맞았습니다. 다음 줄로 갑니다."]; dirty = true;
    if (s.step >= p.steps.length) {
      s.done = true; s.score = Math.max(minScore(p), p.pts - 3 * s.miss); ui.fb = null;
      var ci = p.camp, firstPass = probsPassed(ci) && !S.cele[ci];
      if (firstPass) S.cele[ci] = Date.now();
      queueSave({ camp: CAMPS[ci].name, id: p.id, road: ROAD[p.pts], result: "완등", score: s.score, miss: s.miss, work: workText(s) });
      render();
      if (firstPass && ci !== SUMMIT) setTimeout(function () { celebrate(ci); }, calm ? 0 : 500);
      else if (firstPass) setTimeout(checkNote, calm ? 0 : 500);
      return;
    }
    save(); render();
  }
  function missed(msg) {
    var s = st(S.cur), p = BYID[S.cur];
    s.miss++; s.tries++; s.hint = true; ui.fb = ["no", msg]; ui.fresh = false; dirty = true; startLock();
    s.ms = s.ms || []; s.ms[s.step] = (s.ms[s.step] || 0) + 1;                      /* 줄별 오답 수(관리자 통계용) */
    if (s.tries >= lim(p.steps[s.step]) && p.steps[s.step].t === "essay") {
      /* 서술길은 바로 내려가지 않고 학생이 고른다 */
      s.review = { st: "choose", text: s.sub || "", hint: s.ai || "" };
      queueSave({ camp: CAMPS[p.camp].name, id: p.id, road: ROAD[p.pts], result: "기회 소진 · 선택 대기", score: 0, miss: s.miss, work: s.sub || "" });
      ui = freshUi(); render(); return;
    }
    if (s.tries >= lim(p.steps[s.step])) {
      var L = lim(p.steps[s.step]), entry = { camp: CAMPS[p.camp].name, id: p.id, road: ROAD[p.pts], result: "기회 소진", score: 0, miss: s.miss, work: workText(s) };
      /* 내려가는 것은 꼭 올라야 하는 길에서만. 이미 완료한 묶음의 다른 길(추가 점수용)이나
         보너스 봉우리에서는 그 문제만 다시 푼다. */
      var stg = stageOf(p), required = !CAMPS[p.camp].bonus && stg && !stageDone(stg);
      if (CFG.back !== "prob" && required) {
        var from = fallBack(p);
        entry.result = "기회 소진 · " + CAMPS[from].name + " 구간부터 다시";
        queueSave(entry); ui = freshUi(); render(); showFallback(p.camp, from, L); return;
      }
      s.fail = true; queueSave(entry);
    }
    save(); render();
    var el = app.querySelector(".now"); if (el) el.classList.add("shake");
  }
  /* 기회를 다 쓰면 이전 캠프 구간의 처음으로 돌아간다(베이스캠프에서는 그 구간의 처음).
     돌아간 구간과 지금 구간의 길을 모두 다시 완등해야 한다. 서술길에 쓰던 글은 남겨 둔다. */
  function fallBack(p) {
    var ci = p.camp, from = Math.max(0, ci - 1);
    for (var k = from; k <= ci; k++) {
      CAMPS[k].probs.forEach(function (q) {
        var o = S.probs[q.id]; if (!o) return;
        var touched = o.done || o.step > 0 || o.tries > 0 || q === p;
        S.probs[q.id] = { hints: o.hints || 0, ms: o.ms || [], wo: o.wo || {}, step: 0, miss: o.miss || 0, done: false, score: 0, log: [], tries: 0, wrong: [], hint: false, fail: false, resets: (o.resets || 0) + (touched ? 1 : 0), ai: "", draft: o.draft || [] };
      });
      delete S.cele[k]; delete S.note[k];
    }
    dirty = true;
    return from;
  }
  /* 산사태 장면: 돌이 능선을 따라 굴러 내려오고, 등반자가 아래 캠프로 피한다 */
  function rockSlide(svg, topT, endT) {
    var NS = "http://www.w3.org/2000/svg", g = document.createElementNS(NS, "g"), rocks = [], t0 = 0, DUR = 2600;
    svg.insertBefore(g, svg.querySelector("#cvClimber"));
    for (var i = 0; i < 12; i++) {
      var el = document.createElementNS(NS, i % 3 === 2 ? "circle" : "polygon"), r = 4 + Math.random() * 6;
      if (el.tagName === "circle") el.setAttribute("r", r * .7);
      else el.setAttribute("points", [[-r, -r * .3], [-r * .3, -r], [r * .7, -r * .7], [r, r * .2], [r * .2, r], [-r * .8, r * .6]].map(function (p) { return p.join(","); }).join(" "));
      el.setAttribute("class", i % 3 === 2 ? "rock dust" : "rock");
      g.appendChild(el);
      rocks.push({ el: el, delay: i * 110 + Math.random() * 120, speed: .75 + Math.random() * .5, hop: 6 + Math.random() * 16, ph: Math.random() * 6, spin: (Math.random() - .5) * 900 });
    }
    function frame(now) {
      if (!svg.isConnected) return;
      if (!t0) t0 = now; var el = now - t0;
      rocks.forEach(function (k) {
        var u = Math.max(0, Math.min(1, (el - k.delay) / (1500 / k.speed)));
        var t = topT + (endT - topT) * (u * u * .6 + u * .4), p = cpt(Math.max(-0.06, Math.min(1, t)));
        var y = Math.min(p[1], CV.Y0) - 4 - Math.abs(Math.sin(u * 9 + k.ph)) * k.hop * (1 - u * .5);
        k.el.setAttribute("transform", "translate(" + p[0].toFixed(1) + "," + y.toFixed(1) + ") rotate(" + (u * k.spin).toFixed(0) + ")");
        k.el.style.opacity = u <= 0 ? 0 : u > .9 ? Math.max(0, (1 - u) * 10) : 1;
      });
      if (el < DUR) requestAnimationFrame(frame); else g.remove();
    }
    requestAnimationFrame(frame);
  }
  function showFallback(ci, from, L) {
    var old = document.querySelector(".cele, .note"); if (old) old.remove();
    var c = CAMPS[from], cur = CAMPS[ci], same = from === ci;
    var place = from === 0 ? "등산로 입구" : CAMPS[from - 1].name, altFrom = ci === 0 ? 0 : CAMPS[ci - 1].alt, altTo = from === 0 ? 0 : CAMPS[from - 1].alt;
    var d = document.createElement("div");
    d.className = "cele slide"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "산사태 발생");
    d.innerHTML = '<div class="cele-in">' + curveSvg(ci, ci) +
      '<p class="kicker">기회 ' + L + '번을 모두 썼습니다</p><h2>산사태 발생!</h2><p class="altnum" id="celeAlt">' + comma(altFrom) + "m</p>" +
      '<p class="sub">' + (same ? "굴러떨어지는 돌을 입구에서 간신히 피했습니다. ‘" + c.topic + "’ 구간의 길을 처음부터 다시 오릅니다." :
        "산사태를 피해 " + place + "까지 내려왔습니다. ‘" + c.topic + "’ 구간부터 다시 올라 ‘" + cur.topic + "’ 구간에 다시 도전하세요.") +
      "<br>서술길에 써 둔 풀이는 그대로 남아 있습니다.</p>" +
      '<button class="btn primary" id="fbClose">' + (same ? "다시 오르기" : place + "에서 다시 오르기") + "</button></div>";
    document.body.appendChild(d);
    d.querySelector("#fbClose").addEventListener("click", function () { d.remove(); go("map"); });
    var svg = d.querySelector("svg"), g = d.querySelector("#cvClimber");
    function settle() {                                   /* 무너진 구간의 색이 빠지고 등반자가 아래에 선다 */
      var sp = standAt(from); g.style.transform = "translate(" + sp[0] + "px," + sp[1] + "px)";
      for (var k = from; k < ci; k++) {
        var strip = d.querySelector('[data-strip="' + k + '"]'), nm = d.querySelector('[data-name="' + k + '"]');
        if (strip) strip.setAttribute("class", "cv-strip"); if (nm) nm.setAttribute("class", "cv-name");
      }
      countUp(d.querySelector("#celeAlt"), altFrom, altTo);
    }
    if (calm) { settle(); }
    else {
      svg.classList.add("quake");
      rockSlide(svg, Math.min(1, (ci + 1.3) / CV.N), (from - .4) / CV.N);
      setTimeout(function () { if (d.isConnected) settle(); }, 650);
      setTimeout(function () { if (svg.isConnected) svg.classList.remove("quake"); }, 2300);
    }
    var b = d.querySelector("#fbClose"); if (b && b.focus) b.focus({ preventScroll: true });
  }
  /* ---------- 서술길: 선생님 확인 요청 ---------- */
  function pendingIds() { return Object.keys(S.probs).filter(function (k) { var r = S.probs[k].review; return r && r.st === "pending"; }); }
  function rvAsk() {
    var id = S.cur, s = st(id); if (!s.review || ui.busy) return;
    ui.busy = true; ui.rvMsg = ""; render();
    call("apiReview", { name: S.name, id: id, text: s.review.text, hint: s.review.hint }).then(function (r) {
      ui.busy = false;
      if (!r || !r.ok) { ui.rvMsg = (r && r.error) || "요청을 보내지 못했습니다. 다시 눌러 주세요."; render(); return; }
      s.review.st = "pending"; ui.rvMsg = "요청을 보냈습니다."; queueSave(); render();
    }).catch(function () { ui.busy = false; ui.rvMsg = "요청을 보내지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요."; render(); });
  }
  /* 오답을 인정: 설정에 따라 이전 캠프 구간부터, 또는 이 문제만 다시 */
  function rvAccept() {
    var p = BYID[S.cur], s = st(p.id), stg = stageOf(p), required = !CAMPS[p.camp].bonus && stg && !stageDone(stg);
    delete s.review;
    if (CFG.back !== "prob" && required) {
      var from = fallBack(p);
      queueSave({ camp: CAMPS[p.camp].name, id: p.id, road: ROAD[p.pts], result: "오답 인정 · " + CAMPS[from].name + " 구간부터 다시", score: 0, miss: s.miss, work: "" });
      ui = freshUi(); render(); showFallback(p.camp, from, CFG.limE); return;
    }
    restart();
  }
  var rvBusy = false;
  function rvPoll(manual) {
    var ids = pendingIds(); if (!ids.length || rvBusy || !HAS) return;
    rvBusy = true; if (manual) { ui.busy = true; ui.rvMsg = ""; render(); }
    call("apiReviewStatus", { name: S.name, ids: ids }).then(function (r) {
      rvBusy = false; if (manual) ui.busy = false;
      var stt = (r && r.ok && r.st) || {}, changed = false;
      ids.forEach(function (id) {
        var s = S.probs[id]; if (!s || !s.review) return;
        if (stt[id] === "ok") { changed = true; approved(id); }
        else if (stt[id] === "no") { changed = true; s.review.st = "no"; }
      });
      if (manual && !changed) ui.rvMsg = "아직 확인 전입니다. 잠시 뒤 다시 눌러 주세요.";
      if (changed) queueSave();
      if (manual || changed) render();
    }).catch(function () { rvBusy = false; if (manual) { ui.busy = false; ui.rvMsg = "확인하지 못했습니다. 인터넷 연결을 확인하세요."; render(); } });
  }
  /* 선생님이 정답으로 인정: 그 풀이로 완등 처리 */
  function approved(id) {
    var p = BYID[id], s = S.probs[id], text = s.review.text;
    delete s.review;
    var keepView = S.view, keepCur = S.cur, keepUi = ui;
    advance(p, s, { k: "e", v: text + "\n(선생님이 정답으로 인정했습니다)" });
    if (!(keepView === "prob" && keepCur === id)) ui = keepUi;          /* 다른 화면에서 쓰던 입력은 건드리지 않는다 */
  }
  setInterval(function () { if ((S.view === "map" || S.view === "prob") && !document.querySelector(".cele, .note, .tour")) rvPoll(false); }, 15000);

  function restart() {
    var s = st(S.cur);
    s.step = 0; s.log = []; s.tries = 0; s.wrong = []; s.hint = false; s.hintOpen = false; s.fail = false; s.ai = ""; s.why = ""; s.resets = (s.resets || 0) + 1;
    ui = freshUi(); dirty = true; save(); render(); window.scrollTo(0, 0);
  }
  function pickOpt(i) {
    if (lockLeft()) return;
    var p = BYID[S.cur], s = st(p.id), step = p.steps[s.step], o = step.o[0];
    if (i === 0) advance(p, s, o.indexOf("T:") === 0 ? { k: "t", v: o.slice(2) } : { k: "m", v: o });
    else {
      s.wrong.push(i); s.why = (step.w && step.w[i]) || "";
      s.wo = s.wo || {}; s.wo[s.step + ":" + i] = (s.wo[s.step + ":" + i] || 0) + 1;   /* 선택지별 오답 수 */
      missed("틀렸습니다. 왜 틀렸는지 먼저 스스로 확인해 보세요.");
    }
  }
  function checkNums() {
    if (lockLeft()) return;
    var p = BYID[S.cur], s = st(p.id), step = p.steps[s.step], empty = false, bad = false;
    step.f.forEach(function (f, i) { if (!ui.ok[i] && !ui.vals[i]) empty = true; });
    if (empty) { ui.fb = ["no", "빈칸을 모두 채운 뒤 확인을 누르세요."]; render(); return; }
    step.f.forEach(function (f, i) {
      if (ui.ok[i]) return;
      if (same(ui.vals[i], f[1])) { ui.ok[i] = true; ui.no[i] = false; } else { ui.no[i] = true; bad = true; }
    });
    if (bad) {
      ui.active = ui.no.indexOf(true);
      if (!parse(ui.vals[ui.active])) { ui.fb = ["no", "입력 형식을 확인하세요. 예: 4/3, -4"]; render(); return; }
      missed("틀렸습니다. 빨간 칸을 다시 계산해 보세요."); return;
    }
    advance(p, s, { k: "m", v: step.full || step.f.map(function (f) { return f[0] + " = " + texNum(f[1]); }).join(",\\quad ") });
  }
  function pressKey(k) {
    var p = BYID[S.cur]; if (!p) return; var s = st(p.id); if (s.done || s.fail) return;
    var step = p.steps[s.step]; if (step.t !== "nums") return;
    if (k === "go") return checkNums();
    var i = ui.active;
    if (ui.ok[i]) { i = -1; step.f.forEach(function (_, j) { if (i < 0 && !ui.ok[j]) i = j; }); if (i < 0) return; ui.active = i; }
    var v = ui.vals[i] || "";
    if (ui.no[i]) { ui.no[i] = false; if (k !== "⌫") v = ""; }
    if (k === "⌫") v = v.slice(0, -1);
    else if (k === "-") v = v.charAt(0) === "-" ? v.slice(1) : "-" + v;
    else if (k === "/") { if (v && v !== "-" && v.indexOf("/") < 0) v += "/"; }
    else if (v.length < 8) v += k;
    ui.vals[i] = v; ui.fb = null; render();
  }
  function submitEssay() {
    if (lockLeft()) return;
    var p = BYID[S.cur], s = st(p.id), step = p.steps[s.step], d = step.f.map(function (_, i) { return String(s.draft[i] || "").trim(); });
    if (d.some(function (x) { return !x; })) { ui.fb = ["no", "모든 칸에 풀이를 써 주세요. 빈칸이 있으면 채점받을 수 없습니다."]; render(); return; }
    var text = d.map(function (x, i) { return MARK[i] + " [" + step.f[i][0] + "] " + x; }).join("\n"), id = p.id;
    ui.busy = true; ui.fb = null; render();
    call("apiGrade", { name: S.name, id: id, text: text }).then(function (r) {
      if (S.cur !== id || S.view !== "prob") { ui.busy = false; return; }
      ui.busy = false;
      if (!r || !r.ok) { ui.fb = ["no", "채점하지 못했습니다(기회는 줄지 않습니다). " + esc((r && r.error) || "") + " 선생님께 알려 주세요."]; render(); return; }
      if (r.correct) advance(p, s, { k: "e", v: text });
      else { s.ai = String(r.hint || ""); s.sub = text; missed("아직 정답으로 인정되지 않았습니다. 아래 도움말을 읽고 풀이를 고쳐 다시 제출하세요."); }
    }).catch(function () {
      ui.busy = false; ui.fb = ["no", "채점하지 못했습니다(기회는 줄지 않습니다). 인터넷 연결을 확인하고 다시 눌러 주세요."]; render();
    });
  }

  /* ---------- 입장 ---------- */
  function join() {
    var sid = document.getElementById("idInput").value.replace(/\D/g, ""), sname = document.getElementById("nameInput").value.replace(/\s+/g, " ").trim();
    S.sid = sid; S.sname = sname;
    if (!sid) { joinErr = "학번을 숫자로 입력하세요."; render(); return; }
    if (sname.length < 2) { joinErr = "이름을 입력하세요."; render(); return; }
    var name = sid + " " + sname;
    joining = true; joinErr = ""; if (S.name !== name) { S = fresh(name); S.sid = sid; S.sname = sname; } render();
    var req = HAS ? call("apiJoin", name) : Promise.resolve({ ok: true, name: name, demo: true, state: null, cfg: CFG });
    req.then(function (r) {
      if (!r || !r.ok) throw new Error("join");
      CFG = withDefaults(r.cfg);
      var server = null; try { server = r.state ? JSON.parse(r.state) : null; } catch (e) {}
      var local = S, push = false;
      if (!r.demo) {
        if (server && (server.rev || 0) >= (local.rev || 0)) S = server;          /* 다른 기기에서 이어 하기 */
        else if (!server && local.synced) S = fresh(r.name);                      /* 선생님이 기록을 지운 경우 */
        else push = local.rev > 0;                                                /* 이 기기의 기록이 더 새로움 */
      }
      S.name = r.name; S.sid = sid; S.sname = sname; norm(); joining = false;
      var first = !S.start; if (first) S.start = Date.now();
      S.view = "map"; save(); ui = freshUi(); render(); window.scrollTo(0, 0);
      if (first) { queueSave(); celebrate("start"); } else if (push || S.outbox.length) queueSave();
      else { var el = app.querySelector(".camp.open"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" }); }
      if (!first) { checkNote(); maybeTour(); rvPoll(false); }            /* 밀린 핵심 정리와 아직 못 본 안내를 차례로 */
    }).catch(function () { joining = false; joinErr = "접속하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요."; render(); });
  }

  /* ---------- 입력 ---------- */
  app.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b || b.disabled) return;
    var d = b.dataset;
    if (d.act === "start") join();
    else if (d.act === "admin") { adm.err = ""; S.view = "admin"; render(); window.scrollTo(0, 0); }
    else if (d.act === "adminExit") { adm = freshAdm(); S.view = "intro"; render(); }
    else if (d.stu) { adm.stu = adm.stu === d.stu ? null : d.stu; render(); var ep = document.getElementById("essayPanel"); if (ep && ep.scrollIntoView) ep.scrollIntoView({ block: "nearest" }); }
    else if (d.act === "adminLogin") { var pw = document.getElementById("adminPw").value; if (!pw) { adm.err = "비밀번호를 입력하세요."; render(); } else adminLoad(pw); }
    else if (d.act === "adminRefresh") adminLoad(adm.pw);
    else if (d.act === "adminSort") { adm.byBad = !adm.byBad; render(); }
    else if (d.rvid) adminReview(d.rvwho, d.rvid, d.rvok === "1");
    else if (d.act === "adminDelAll") confirmDelete([], true);
    else if (d.act === "adminDelSel") { var picked = Object.keys(adm.sel).filter(function (k) { return adm.sel[k] && adm.data.some(function (x) { return x.sid + " " + x.name === k; }); }); if (picked.length) confirmDelete(picked, false); }
    else if (d.cls) { adm.open = adm.open === d.cls ? null : d.cls; adm.stu = null; adm.sel = {}; adm.msg = ""; render(); }
    else if (d.act === "final") go("final");
    else if (d.gate) checkGate(d.gate);
    else if (d.act === "map") go("map");
    else if (d.act === "record") go("record");
    else if (d.act === "restart") restart();
    else if (d.act === "rvAsk") rvAsk();
    else if (d.act === "rvAccept") rvAccept();
    else if (d.act === "rvPoll") rvPoll(true);
    else if (d.act === "hint") { var hs = st(S.cur); hs.hintOpen = true; hs.hints = (hs.hints || 0) + 1; dirty = true; save(); render(); }
    else if (d.ex != null) { exOpen[d.ex] = true; render(); }
    else if (d.act === "grade") submitEssay();
    else if (d.sym) {
      var ta = document.getElementById("essay" + ui.focus), a = ta.selectionStart, z = ta.selectionEnd, ins = d.sym.replace(" ", "");
      ta.value = ta.value.slice(0, a) + ins + ta.value.slice(z); st(S.cur).draft[ui.focus] = ta.value; save();
      ta.focus(); ta.selectionStart = ta.selectionEnd = a + (ins.length === 2 ? 1 : ins.length);
    }
    else if (d.prob) {
      var np = BYID[d.prob]; if (!np || (!probOpen(np) && !isDone(np))) return;
      st(d.prob); go("prob", d.prob);
      if (np.essay && !S.tipEssay && !isDone(np)) showEssayTip();
    }
    else if (d.opt != null) pickOpt(+d.opt);
    else if (d.field != null) { if (!ui.ok[+d.field]) { ui.active = +d.field; render(); } }
    else if (d.key) pressKey(d.key);
  });
  app.addEventListener("change", function (e) {
    var w = e.target.dataset && e.target.dataset.sel; if (!w) return;
    adm.sel[w] = e.target.checked; adm.msg = ""; render();
  });
  app.addEventListener("input", function (e) {
    var i = e.target.dataset.essay; if (i != null) { st(S.cur).draft[+i] = e.target.value; save(); }
    var b = e.target.dataset.blank; if (b) { var kv = b.split(":"); (S.final.vals[kv[0]] = S.final.vals[kv[0]] || [])[+kv[1]] = e.target.value; e.target.classList.remove("no"); save(); }
  });
  app.addEventListener("focusin", function (e) {
    var i = e.target.dataset && e.target.dataset.essay; if (i == null) return;
    ui.focus = +i;
    setTimeout(function () { if (e.target.isConnected && e.target.scrollIntoView) e.target.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" }); }, 350);   /* 화면 키보드가 올라온 뒤 */
  });
  document.addEventListener("keydown", function (e) {
    if (document.querySelector(".cele, .note, .tour")) return;
    if (e.target.tagName === "TEXTAREA") return;
    if (S.view === "admin") { if (e.key === "Enter" && e.target.id === "adminPw") { var lb = app.querySelector("[data-act=adminLogin]"); if (lb) lb.click(); } return; }
    if (S.view === "final") { if (e.key === "Enter" && e.target.dataset.blank) checkGate(e.target.dataset.blank.split(":")[0]); return; }
    if (S.view === "intro") { if (e.key === "Enter" && !joining) join(); return; }
    if (S.view !== "prob" || e.target.tagName === "INPUT") return;
    if (/^[0-9]$/.test(e.key) || e.key === "-" || e.key === "/") { pressKey(e.key); e.preventDefault(); }
    else if (e.key === "Backspace") { pressKey("⌫"); e.preventDefault(); }
    else if (e.key === "Enter" && !e.target.closest("button")) pressKey("go");
  });
  window.addEventListener("pagehide", function () { if (dirty) queueSave(); });

  render();
})();
