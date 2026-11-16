(function () {
  var CAMPS = window.CAMPS, NOTES = window.NOTES, KEY = "integral-climb-v2", MARK = "①②③④";
  var API_URL = String(window.CLIMB_API_URL || "").trim();   /* config.js 에 적은 앱스크립트 웹 앱 주소 */
  var HAS = /^https:\/\/script\.google\.com\/.+\/exec$/.test(API_URL);
  var app = document.getElementById("app");
  var BYID = {};
  CAMPS.forEach(function (c, ci) { c.probs.forEach(function (p, pi) { p.camp = ci; p.idx = pi; BYID[p.id] = p; }); });
  var ROAD = { 10: "완만한 길", 20: "능선길", 30: "절벽길", 40: "서술길" };
  var SUMMIT = CAMPS.length - 2, BONUS = CAMPS.length - 1;
  var CFG = { limC: 3, limE: 5, essayOn: false };

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
  var adm = { data: null, essays: [], err: "", busy: false, open: null, stu: null, pw: "" }, gateFb = {};

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
    if (!s.draft || !s.draft.length) s.draft = ["", "", ""];
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
  function lim(step) { return step.t === "essay" ? CFG.limE : CFG.limC; }
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
    call("apiSave", { name: S.name, rev: rev, state: JSON.stringify(copy), sum: summary(), logs: logs }).then(function (r) {
      sending = false;
      if (!r || !r.ok) throw new Error("save");
      S.outbox = S.outbox.slice(logs.length); S.synced = true; save(); setSync("ok");
      if (S.rev !== rev) pump();
    }).catch(function () { sending = false; setSync("bad"); setTimeout(pump, 6000); });
  }

  /* ---------- 화면 전환 ---------- */
  function go(view, cur) {
    if (dirty && view !== "prob") queueSave();
    S.view = view; S.cur = cur || null; save();
    ui = freshUi(); render(); window.scrollTo(0, 0);
    if (view === "map") { var el = app.querySelector(".camp.open"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" }); checkNote(); }
  }

  function bar(back) {
    return '<div class="bar"><div>' + (back ? '<button class="btn small" data-act="map">← 등산로</button>' : '<span class="who">' + esc(S.name) + "</span>") +
      '</div><div class="right"><span class="sync' + (syncState === "bad" ? " bad" : "") + '">' + syncText() + '</span><span class="total">' + comma(total()) + "점</span>" +
      (S.view !== "record" ? '<button class="btn small" data-act="record">등반 기록</button>' : "") + "</div></div>";
  }

  function vIntro() {
    return '<div class="card intro"><h1>정적분 <span>등반</span></h1>' +
      "<p>등산로 입구에서 정상까지, 정적분 문제를 풀이 순서대로 풀며 혼자 오르는 산입니다.</p>" +
      "<ol><li>구간마다 <b>몸풀기 길 → 중간 길 → 서술길</b> 순서로 완등하면 다음 캠프에 도착합니다.</li>" +
      "<li>서술길에서는 풀이를 글로 씁니다. 거듭제곱은 <b>^</b>를 써서 <b>x^2</b>처럼 씁니다.</li>" +
      "<li>문제는 <b>풀이 한 줄씩</b> 입력합니다. 틀리면 힌트가 나옵니다.</li>" +
      "<li>한 줄에서 기회를 다 쓰면 그 문제를 처음부터 다시 풉니다.</li>" +
      "<li>캠프에 도착하면 <b>핵심 정리</b>가 나옵니다. <b>공책에 적어 두세요.</b> 정상 직전 마지막 관문에서 빈칸으로 다시 씁니다.</li>" +
      "<li>분수는 <b>4/3</b>, 음수는 <b>-4</b>처럼 입력합니다.</li></ol>" +
      '<div class="row"><label class="who-f" for="idInput">학번<input id="idInput" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="예: 20101" autocomplete="off" value="' + esc(S.sid || "") + '"' + (joining ? " disabled" : "") + "></label>" +
      '<label class="who-f grow" for="nameInput">이름<input id="nameInput" maxlength="12" placeholder="예: 김하늘" autocomplete="off" autocapitalize="off" value="' + esc(S.sname || "") + '"' + (joining ? " disabled" : "") + "></label>" +
      '<button class="btn primary" data-act="start"' + (joining ? " disabled" : "") + ">" + (joining ? "불러오는 중…" : S.start ? "이어서 등반" : "등반 시작") + "</button></div>" +
      '<p class="err" role="status">' + esc(joinErr) + "</p></div>" +
      '<div class="intro-foot"><button class="btn small" data-act="admin">관리자 모드</button></div>';
  }

  function routeBtn(p, locked) {
    var s = S.probs[p.id], d = s && s.done, going = s && !d && (s.step > 0 || s.miss > 0);
    return '<button class="route' + (p.essay ? " essay" : "") + (d ? " done" : going ? " going" : "") + '" data-prob="' + p.id + '"' + (locked ? " disabled" : "") + "><b>" + ROAD[p.pts] + "</b><span>" +
      (d ? "완등 " + s.score + "점" : going ? "오르는 중 · " + p.pts + "점" : p.pts + "점") + "</span></button>";
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
        h += '<p class="tip">' + c.tip + '</p><div class="ex"><b>예시</b>' + M(c.ex) + "</div>" +
          stages(c).map(function (st, k) { return tierHtml(st, stageOpen(c, k)); }).join("");
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
  var ESSAY_LABELS = ["① 부정적분 (성질을 썼다면 정리한 식부터)", "② 위끝과 아래끝을 대입한 식", "③ 계산과 답"];
  function vProb() {
    var p = BYID[S.cur], s = st(p.id), c = CAMPS[p.camp];
    var left = '<div class="card"><div class="meta"><span>' + c.name + " · " + c.topic + " · " + ROAD[p.pts] + " " + p.pts + "점</span>" +
      '<span class="miss">' + (s.miss ? "실수 " + s.miss + "회 (−" + Math.min(s.miss * 3, p.pts - minScore(p)) + "점)" : "") + "</span></div>" + qHtml(p) +
      (s.log.length ? '<div class="log"><h3>내 풀이</h3>' + logHtml(s, ui.fresh) + "</div>" : "") + "</div>";
    var right;
    if (s.done) {
      right = nextHtml(p, s);
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
          ESSAY_LABELS.map(function (lb, i) {
            return '<label class="essay-f" for="essay' + i + '">' + lb + '<textarea id="essay' + i + '" data-essay="' + i + '" rows="2" autocapitalize="off" autocomplete="off" spellcheck="false"' +
              (i === 0 ? ' placeholder="예) [x^2] 또는 ∫(4x)dx"' : i === 1 ? ' placeholder="예) (1) − (0)"' : ' placeholder="예) 1"') + (ui.busy ? " readonly" : "") + ">" + esc(s.draft[i] || "") + "</textarea></label>";
          }).join("") +
          '<p class="hint" style="text-align:left">제곱은 x^2, 분수는 1/3처럼 씁니다.</p>' +
          '<div><button class="btn primary" data-act="grade"' + (ui.busy ? " disabled" : "") + ">" + (ui.busy ? "채점 중…" : "채점 받기") + "</button></div>";
      } else if (step.t === "choice") {
        if (!ui.order) ui.order = shuffle(step.o.length);
        right += '<div class="opts">' + ui.order.map(function (i) {
          var w = s.wrong.indexOf(i) >= 0;
          return '<button class="opt' + (step.o[i].indexOf("T:") === 0 ? " t" : "") + (w ? " wrong" : "") + '" data-opt="' + i + '"' + (w ? " disabled" : "") + ">" + optHtml(step.o[i]) + "</button>";
        }).join("") + "</div>";
      } else {
        right += '<div class="fields">' + step.f.map(function (f, i) {
          var cls = ui.ok[i] ? " ok" : ui.no[i] ? " no" : i === ui.active ? " active" : "";
          return '<button class="field' + cls + '" data-field="' + i + '"><span>' + M(f[0] + " =") + '</span><span class="val">' + esc(ui.vals[i] || "") + "</span></button>";
        }).join("") + "</div>" +
          '<div class="pad">' + ["7", "8", "9", "⌫", "4", "5", "6", "-", "1", "2", "3", "/"].map(function (k) {
            return '<button class="key" data-key="' + k + '" aria-label="' + (k === "⌫" ? "지우기" : k === "-" ? "음수 부호" : k === "/" ? "분수 기호" : k) + '">' + (k === "-" ? "−" : k) + "</button>";
          }).join("") + '<button class="key" data-key="0">0</button><button class="key go" data-key="go">확인</button></div>' +
          '<p class="hint">분수는 4/3, 음수는 −4처럼 입력합니다.</p>';
      }
      right += '<p class="fb ' + (ui.fb ? ui.fb[0] : "") + '" role="status">' + (ui.fb ? ui.fb[1] : "") + "</p>";
      if (s.hint) right += '<div class="hintbox"><b>힌트</b>' + (s.ai ? "<p>" + esc(s.ai) + "</p>" : "") + "<p>" + step.h + "</p></div>";
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
        h += '<div class="rec"><div class="rec-head">' + c.name + " · " + c.topic + " · " + ROAD[p.pts] + "<span>" + s.score + " / " + p.pts + "점 · 실수 " + s.miss + "회" +
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
      for (var di = 0; di < CFG.limC; di++) dots += '<i class="' + (di < CFG.limC - tr ? "" : "used") + '"></i>';
      h += '<div class="card gate-item' + (ok ? " ok" : "") + '"><div class="gate-head"><span>' + c.name + " · " + c.topic + "</span>" +
        (ok ? '<span class="ok">✓ 통과</span>' : '<span class="tries">남은 기회 ' + dots + "</span>") + '</div><div class="formula">' +
        (ok ? n.full : n.quiz).map(function (l) { return "<div>" + l + "</div>"; }).join("") + "</div>";
      if (!ok) {
        h += '<div class="blanks">' + n.blanks.map(function (_, i) {
          var v = (f.vals[c.key] || [])[i] || "";
          return '<label for="bl' + c.key + i + '">' + BL[i] + '<input id="bl' + c.key + i + '" data-blank="' + c.key + ":" + i + '" maxlength="6" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="' + esc(v) + '"' +
            (fb && fb.bad && fb.bad[i] ? ' class="no"' : "") + "></label>";
        }).join("") + '<button class="btn primary" data-gate="' + c.key + '">확인</button></div>' +
          '<p class="fb no" role="status">' + (fb ? fb.msg : "") + "</p>";
      }
      h += "</div>";
    }
    return h + "</div>";
  }
  function normBlank(v) { return String(v || "").trim().toLowerCase().replace(/[−–—ㅡ]/g, "-").replace(/＋/g, "+").replace(/\s/g, ""); }
  function checkGate(key) {
    var f = S.final, n = NOTES[key], vals = f.vals[key] || [], bad = [], anyBad = false, empty = false;
    n.blanks.forEach(function (acc, i) { var v = normBlank(vals[i]); if (!v) empty = true; bad[i] = acc.indexOf(v) < 0; if (bad[i]) anyBad = true; });
    if (empty) { gateFb[key] = { msg: "빈칸을 모두 채운 뒤 확인을 누르세요.", bad: [] }; render(); return; }
    if (!anyBad) {
      f.ok[key] = true; delete gateFb[key]; dirty = true;
      if (Object.keys(f.ok).length >= SUMMIT + 1) {
        f.done = true; if (!S.end) S.end = Date.now(); S.cele.final = Date.now();
        queueSave({ camp: "정상", id: "개념 관문", road: "마지막 관문", result: "통과", score: 0, miss: f.miss, work: "" });
        render(); setTimeout(function () { celebrate(SUMMIT); }, calm ? 0 : 400); return;
      }
      save(); render(); return;
    }
    f.miss++; f.tries[key] = (f.tries[key] || 0) + 1; dirty = true;
    if (f.tries[key] >= CFG.limC) {
      f.tries[key] = 0; f.vals[key] = []; delete gateFb[key]; save(); render();
      showNote(CAMPS.filter(function (c) { return c.key === key; })[0].camp0, true); return;
    }
    gateFb[key] = { msg: "틀렸습니다. 공책에서 ‘" + CAMPS.filter(function (c) { return c.key === key; })[0].name + "’ 정리를 찾아 다시 써 보세요.", bad: bad };
    save(); render();
  }

  /* ---------- 개념 정리 팝업 ---------- */
  CAMPS.forEach(function (c, ci) { c.camp0 = ci; });
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
      if (!review) { S.note[ci] = Date.now(); dirty = true; save(); checkNote(); }
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
      out.push({ sid: "2" + ("0" + k).slice(-2) + ("0" + n).slice(-2), name: fam.charAt((n + k) % 10) + giv[(n * k) % 10], c: c, f: reach >= 7 ? 1 : 0, score: reach * 31 + n, pos: "" });
    }
    return out;
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
      '<div class="row"><button class="btn small" data-act="adminRefresh"' + (adm.busy ? " disabled" : "") + ">" + (adm.busy ? "불러오는 중…" : "새로 고침") + '</button><span class="err">' + esc(adm.err) + "</span></div>" +
      '<div class="tbl-wrap"><table class="rate"><thead><tr><th>학급</th><th>인원</th>' + STAGES.map(function (st) { return "<th>" + st.name + "<small>" + st.sub + "</small></th>"; }).join("") + "</tr></thead><tbody>" +
      keys.map(function (k) { var g = groups[k]; return '<tr' + (adm.open === k ? ' class="sel"' : "") + '><th><button data-cls="' + k + '">' + g.label + "</button></th><td>" + g.list.length + "</td>" + cells(g.list) + "</tr>"; }).join("") +
      '<tr class="tot"><th>전체</th><td>' + adm.data.length + "</td>" + cells(adm.data) + "</tr></tbody></table></div>";
    if (!adm.data.length) h += '<p class="note-line">아직 입장한 학생이 없습니다.</p>';
    if (adm.open && groups[adm.open]) {
      var list = groups[adm.open].list.slice().sort(function (a, b) { return String(a.sid).localeCompare(String(b.sid)); });
      h += "<h2>" + groups[adm.open].label + ' 명단</h2><div class="tbl-wrap"><table class="list"><thead><tr><th>학번</th><th>이름</th><th>통과한 단계</th><th>총점</th><th>서술길 답안</th></tr></thead><tbody>' +
        list.map(function (s) {
          var last = "아직 없음"; STAGES.forEach(function (st) { if (st.get(s)) last = st.name; });
          var cnt = STAGES.filter(function (st) { return st.get(s); }).length;
          var who = s.sid + " " + s.name, ne = essaysOf(who).length;
          return "<tr" + (adm.stu === who ? ' class="sel"' : "") + "><td>" + esc(s.sid) + "</td><td>" + esc(s.name) + "</td><td>" + cnt + " / " + STAGES.length + " · " + last + "</td><td>" + (Number(s.score) || 0) + "</td><td>" +
            (ne ? '<button class="btn small" data-stu="' + esc(who) + '">' + (adm.stu === who ? "닫기" : ne + "건 보기") + "</button>" : "없음") + "</td></tr>";
        }).join("") + "</tbody></table></div>";
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
    return h + "</div>";
  }
  function adminLoad(pw) {
    adm.busy = true; adm.err = ""; render();
    var req = HAS ? call("apiAdmin", pw) : Promise.resolve({ ok: true, students: sampleData(), essays: sampleEssays() });
    req.then(function (r) {
      adm.busy = false;
      if (!r || !r.ok) { adm.err = (r && r.error) || "불러오지 못했습니다."; if (!adm.data) adm.pw = ""; render(); return; }
      adm.pw = pw; adm.data = r.students || []; adm.essays = r.essays || []; render();
    }).catch(function () { adm.busy = false; adm.err = "접속하지 못했습니다. 인터넷 연결을 확인하세요."; render(); });
  }

  function render() {
    var wide = (S.view === "prob" && BYID[S.cur]) || S.view === "admin";
    app.className = "wrap" + (wide ? " wide" : "");
    app.innerHTML = S.view === "admin" ? vAdmin() : S.view === "map" ? vMap() : S.view === "final" ? vFinal() : S.view === "prob" && BYID[S.cur] ? vProb() : S.view === "record" ? vRecord() : vIntro();
    typeset();
  }

  /* ---------- 축하 장면 ---------- */
  var WAY = [[40, 262], [96, 228], [150, 200], [122, 164], [186, 140], [160, 104], [212, 60]];
  function mountainSvg(from) {
    var pts = WAY.map(function (w) { return w.join(","); });
    var dots = WAY.map(function (w, i) { return '<circle class="mt-dot' + (i <= from ? " on" : "") + '" data-dot="' + i + '" cx="' + w[0] + '" cy="' + w[1] + '" r="' + (i === 6 ? 7 : 5) + '"/>'; }).join("");
    return '<svg viewBox="0 0 400 284" role="img" aria-label="산과 등산로">' +
      '<polygon class="mt-back" points="170,284 292,118 338,162 400,104 400,284"/>' +
      '<polygon class="mt-front" points="0,284 60,238 122,170 166,120 212,56 262,130 312,192 400,284"/>' +
      '<polygon class="mt-snow" points="212,56 188,90 202,83 212,96 223,81 238,95"/>' +
      '<polyline class="mt-path" points="' + pts.join(" ") + '"/>' +
      '<polyline class="mt-done" id="mtDone" points="' + pts.slice(0, from + 1).join(" ") + '"/>' + dots +
      '<g class="mt-climber" id="mtClimber" style="transform:translate(' + WAY[from][0] + "px," + WAY[from][1] + 'px)">' +
      '<line class="pole" x1="0" y1="0" x2="0" y2="-24"/><polygon class="cloth" points="0,-24 18,-18 0,-12"/><circle class="ring" cx="0" cy="0" r="5"/></g></svg>';
  }
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
    var from = start ? 0 : Math.min(ci, 6), to = start ? 0 : Math.min(ci + 1, 6);
    var prevAlt = start || ci === 0 ? 0 : CAMPS[ci - 1].alt;
    var title = start ? "등반 시작!" : ci === SUMMIT ? "정상 등정!" : ci === BONUS ? "보너스 봉우리 정복!" : c.name + " 도착!";
    var sub = start ? "정상까지 " + comma(CAMPS[SUMMIT].alt) + "m. 첫 목표는 베이스캠프입니다." :
      ci === SUMMIT ? "모든 구간을 올랐습니다. 보너스 봉우리가 열렸습니다." :
      ci === BONUS ? "산 위의 산까지 올랐습니다. 대단합니다!" :
      "다음 구간은 ‘" + CAMPS[ci + 1].topic + "’입니다.";
    var d = document.createElement("div");
    d.className = "cele"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", title);
    d.innerHTML = "<canvas></canvas><div class=\"cele-in\">" + mountainSvg(from) +
      '<p class="kicker">' + esc(S.name) + "</p><h2>" + title + '</h2><p class="altnum" id="celeAlt">' + comma(prevAlt) + 'm</p><p class="sub">' + sub + "</p>" +
      '<button class="btn primary" data-act="celeClose">' + (start ? "출발" : "계속 오르기") + "</button></div>";
    document.body.appendChild(d);
    d.querySelector("[data-act=celeClose]").addEventListener("click", function () { d.remove(); if (!start) go("map"); });
    var move = function () {
      var g = d.querySelector("#mtClimber"); if (!g) return;
      g.style.transform = "translate(" + WAY[to][0] + "px," + WAY[to][1] + "px)";
      d.querySelector("#mtDone").setAttribute("points", WAY.slice(0, to + 1).map(function (w) { return w.join(","); }).join(" "));
      var dot = d.querySelector('[data-dot="' + to + '"]'); if (dot) dot.setAttribute("class", "mt-dot on");
      countUp(d.querySelector("#celeAlt"), prevAlt, start ? 0 : c.alt);
      if (!start && !calm) setTimeout(function () { if (d.isConnected) confetti(d.querySelector("canvas"), ci >= SUMMIT ? 220 : 110); }, 900);
    };
    setTimeout(move, calm ? 0 : 450);
    var b = d.querySelector(".btn"); if (b && b.focus) b.focus({ preventScroll: true });
  }

  /* ---------- 채점 ---------- */
  function workText(s) { return s.log.map(function (l, k) { return (l.k === "e" ? "" : MARK[k] + " ") + String(l.v).replace(/\\\(|\\\)|\\displaystyle ?/g, ""); }).join("\n"); }
  function advance(p, s, entry) {
    s.log.push(entry); s.step++; s.tries = 0; s.wrong = []; s.hint = false; s.ai = "";
    ui = freshUi(); ui.fresh = true; ui.fb = ["ok", "맞았습니다. 다음 줄로 갑니다."]; dirty = true;
    if (s.step >= p.steps.length) {
      s.done = true; s.score = Math.max(minScore(p), p.pts - 3 * s.miss); ui.fb = null;
      var ci = p.camp, firstPass = probsPassed(ci) && !S.cele[ci];
      if (firstPass) S.cele[ci] = Date.now();
      if (!S.end && passed(SUMMIT)) S.end = Date.now();
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
    s.miss++; s.tries++; s.hint = true; ui.fb = ["no", msg]; ui.fresh = false; dirty = true;
    if (s.tries >= lim(p.steps[s.step])) {
      s.fail = true;
      queueSave({ camp: CAMPS[p.camp].name, id: p.id, road: ROAD[p.pts], result: "기회 소진", score: 0, miss: s.miss, work: workText(s) });
    }
    save(); render();
    var el = app.querySelector(".now"); if (el) el.classList.add("shake");
  }
  function restart() {
    var s = st(S.cur);
    s.step = 0; s.log = []; s.tries = 0; s.wrong = []; s.hint = false; s.fail = false; s.ai = ""; s.resets = (s.resets || 0) + 1;
    ui = freshUi(); dirty = true; save(); render(); window.scrollTo(0, 0);
  }
  function pickOpt(i) {
    var p = BYID[S.cur], s = st(p.id), step = p.steps[s.step], o = step.o[0];
    if (i === 0) advance(p, s, o.indexOf("T:") === 0 ? { k: "t", v: o.slice(2) } : { k: "m", v: o });
    else { s.wrong.push(i); missed("틀렸습니다. 아래 힌트를 읽고 다시 골라 보세요."); }
  }
  function checkNums() {
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
      missed("틀렸습니다. 아래 힌트를 읽고 빨간 칸을 다시 계산해 보세요."); return;
    }
    advance(p, s, { k: "m", v: step.f.map(function (f) { return f[0] + " = " + texNum(f[1]); }).join(",\\quad ") });
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
    var p = BYID[S.cur], s = st(p.id), d = s.draft.map(function (x) { return String(x || "").trim(); });
    if (!d[0] || !d[2] || d.join("").replace(/\s/g, "").length < 8) { ui.fb = ["no", "세 칸에 풀이 과정을 식으로 써 주세요. ①과 ③은 비울 수 없습니다."]; render(); return; }
    var text = "① " + d[0] + "\n② " + d[1] + "\n③ " + d[2], id = p.id;
    ui.busy = true; ui.fb = null; render();
    call("apiGrade", { name: S.name, id: id, text: text }).then(function (r) {
      if (S.cur !== id || S.view !== "prob") { ui.busy = false; return; }
      ui.busy = false;
      if (!r || !r.ok) { ui.fb = ["no", "채점하지 못했습니다(기회는 줄지 않습니다). " + esc((r && r.error) || "") + " 선생님께 알려 주세요."]; render(); return; }
      if (r.correct) advance(p, s, { k: "e", v: text });
      else { s.ai = String(r.hint || ""); missed("아직 정답으로 인정되지 않았습니다. 힌트를 읽고 풀이를 고쳐 다시 제출하세요."); }
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
      CFG = r.cfg || CFG;
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
    }).catch(function () { joining = false; joinErr = "접속하지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요."; render(); });
  }

  /* ---------- 입력 ---------- */
  app.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b || b.disabled) return;
    var d = b.dataset;
    if (d.act === "start") join();
    else if (d.act === "admin") { adm.err = ""; S.view = "admin"; render(); window.scrollTo(0, 0); }
    else if (d.act === "adminExit") { adm = { data: null, essays: [], err: "", busy: false, open: null, stu: null, pw: "" }; S.view = "intro"; render(); }
    else if (d.stu) { adm.stu = adm.stu === d.stu ? null : d.stu; render(); var ep = document.getElementById("essayPanel"); if (ep && ep.scrollIntoView) ep.scrollIntoView({ block: "nearest" }); }
    else if (d.act === "adminLogin") { var pw = document.getElementById("adminPw").value; if (!pw) { adm.err = "비밀번호를 입력하세요."; render(); } else adminLoad(pw); }
    else if (d.act === "adminRefresh") adminLoad(adm.pw);
    else if (d.cls) { adm.open = adm.open === d.cls ? null : d.cls; adm.stu = null; render(); }
    else if (d.act === "final") go("final");
    else if (d.gate) checkGate(d.gate);
    else if (d.act === "map") go("map");
    else if (d.act === "record") go("record");
    else if (d.act === "restart") restart();
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
    if (document.querySelector(".cele, .note")) return;
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
