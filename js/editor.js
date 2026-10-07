/* 報價編輯器（南方通訊處版）：填寫 → 即時預覽 → 下載三方案總表圖／複製客戶頁連結（草稿自動存在瀏覽器）
 * 改編自同仁的旅平險三方案報價工具；費率資料沿用原版（GPTA 離線表＋新快樂旅綜+ DM），未自行新增費率。
 * 產險保費：新快樂旅綜+ DM（天數 2～10）自動帶入；人壽保費：life-rates.js 精確相符才自動帶入。
 */
(function () {
  'use strict';
  var STORE_KEY = 'nf-tq-editor-draft-v2';
  var STORE_KEY_LEGACY = 'nf-tq-editor-draft-v1';
  /** 草稿結構版：選單保額／AT1 100萬刻度；舊稿需 migrate */
  var DRAFT_VERSION = 2;
  var PRESETS = (window.PROPERTY_PRESETS && window.PROPERTY_PRESETS.plans) || [];
  var form = document.getElementById('form');
  var preview = document.getElementById('preview');
  var planTabs = document.getElementById('planTabs');
  var planForms = document.getElementById('planForms');
  var activePlan = 0;
  var Q;
  var rebuildingUI = false;
  /** 使用者剛手動改過保費時，略過一次自動覆寫 */
  var skipAutoOnce = { life: {}, prop: {} };
  /** 使用者手動改過申根勾選；目的地再變時重置，改回依目的地自動 */
  var schengenManual = false;
  /** 舊分享連結／草稿只有天數、沒有出發回程日 → 沿用其天數（直到使用者填日期） */
  var keptLinkDays = false;
  /** fr6 以前的連結／草稿（無 dayRule＝'h24'，天數是日曆日算頭算尾）：沿用原報價天數，避免開舊連結時保費默默改變；
   *  使用者改出發／回程日期或時間、或覆寫天數後，才改依 24 小時制重算 */
  var legacyDays = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) { return TQ.esc(s); }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2200);
  }

  /** AT1 以 50 萬為刻度（100～2000）；旅行社費率表列 100～500（每50）、600～2000（每100），其餘（如 1250萬）需手填保費 */
  var AT1_STEP = 50;
  function snapAt1(n) {
    n = Number(n);
    if (!isFinite(n) || n <= 0) return null;
    n = Math.round(n / AT1_STEP) * AT1_STEP;
    if (n < 100) n = 100;
    if (n > 2000) n = 2000;
    return n;
  }
  function snapDeath(n, schengen) {
    var opts = schengen ? [200, 300, 500, 1000, 1500] : [200, 300, 500, 1000];
    n = Number(n);
    if (opts.indexOf(n) >= 0) return n;
    if (!isFinite(n) || n <= 0) return null;
    var best = opts[0];
    opts.forEach(function (o) { if (Math.abs(o - n) < Math.abs(best - n)) best = o; });
    return best;
  }
  /** 舊 localStorage 草稿 → 新選單結構；丟掉會卡住 UI 的 planCode */
  function migrateDraft(q) {
    if (!q || typeof q !== 'object') return null;
    q = clone(q);
    var ver = Number(q._draftVersion || 0);
    var sch = !!q.schengen;
    if (!q.plans) q.plans = [];
    for (var i = 0; i < 3; i++) {
      if (!q.plans[i]) continue;
      var p = q.plans[i];
      p.life = p.life || {};
      p.property = p.property || {};
      // 清掉舊 planCode，改由保額對應 P1/P2，避免蓋回 select
      if (p.property.planCode) p.property.planCode = '';
      p.property._appliedCode = null;
      var defDeath = [500, 500, 200][i];
      var d = snapDeath(p.property.deathWan, sch);
      p.property.deathWan = d != null ? d : defDeath;
      if (p.life.enabled !== false) {
        var a = snapAt1(p.life.at1Wan);
        p.life.at1Wan = a != null ? a : 500;
      }
    }
    q._draftVersion = DRAFT_VERSION;
    return q;
  }
  function readStoredDraft() {
    var raw = null, fromLegacy = false;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (!raw) {
      try { raw = localStorage.getItem(STORE_KEY_LEGACY); fromLegacy = !!raw; } catch (e2) {}
    }
    if (!raw) return null;
    var q;
    try { q = JSON.parse(raw); } catch (e3) { return null; }
    if (!q || typeof q !== 'object') return null;
    var ver = Number(q._draftVersion || 0);
    if (ver < DRAFT_VERSION || fromLegacy) {
      q = migrateDraft(q);
      try {
        localStorage.removeItem(STORE_KEY_LEGACY);
        if (q) localStorage.setItem(STORE_KEY, JSON.stringify(q));
      } catch (e4) {}
    }
    return q;
  }

  /** 預設三方案：方案一 純人壽／方案二 純產險／方案三 人壽＋產險 */
  var PLAN_DEFAULTS = [
    { name: '方案一 純人壽', tagline: '高身故・高醫療（富邦人壽）', life: true, prop: false, at1: 500, death: 500 },
    { name: '方案二 純產險', tagline: '含旅行不便險（富邦產險）', life: false, prop: true, at1: 500, death: 500 },
    { name: '方案三 人壽＋產險', tagline: '壽＋產・保障最完整', life: true, prop: true, at1: 500, death: 200 }
  ];
  /** 業務員資料（AgentProfile，localStorage 共用 key）→ 報價 agent 欄位 */
  function agentForQuote() {
    var a = window.AgentProfile ? AgentProfile.load() : { name: '', title: '', phone: '' };
    return { unit: TQ.DEFAULT_AGENT.unit, name: a.name, title: a.title, phone: a.phone };
  }
  function blankPlan(i) {
    var d = PLAN_DEFAULTS[i] || PLAN_DEFAULTS[2];
    return {
      name: d.name, tagline: d.tagline, nameCustom: false, taglineCustom: false, recommended: i === 2,
      life: { enabled: d.life, at1Wan: d.at1, childOh1Wan: 60, oh1Wan: null, mrWan: null, oaa: true, hospitalYuan: null, outpatientYuan: null, erYuan: null, premium: null },
      property: { enabled: d.prop, planCode: '', label: '', deathWan: d.death, hospitalWan: null, outpatientYuan: null, erYuan: null, accidentMedicalWan: null, premium: null },
      inconvenience: [], others: []
    };
  }
  function normalize(q) {
    q = q || {};
    q.v = 1;
    q.plans = q.plans || [];
    for (var i = 0; i < 3; i++) if (!q.plans[i]) q.plans[i] = blankPlan(i);
    q.plans.forEach(function (p, idx) {
      p.life = p.life || {}; p.property = p.property || {};
      p.inconvenience = p.inconvenience || []; p.others = p.others || [];
      if (typeof p.property.enabled !== 'boolean') p.property.enabled = true; // 舊稿：一律含產險
      if (!p.property.planCode) {
        var hit = TQ.findPropertyPreset(p.property);
        if (hit) p.property.planCode = hit.code;
      }
    });
    // 簽名一律用本機「業務員資料」（兩個工具共用），不沿用草稿／連結裡別人的資料
    q.agent = agentForQuote();
    var domesticDest = !!TQ.detectDomestic(q.destination);
    if (!q.lifeRegionPct) q.lifeRegionPct = domesticDest ? 100 : TQ.guessRegionPct(q.destination);
    if (!q.dateFormat) q.dateFormat = 'roc';
    if (!q.lifeRateType) q.lifeRateType = 'agency';
    // 年齡（足歲）：舊稿沒有 → null（編輯器會要求填寫才可產生報價）；年齡帶依年齡自動
    if (q.age === undefined || q.age === '') q.age = null;
    var ai0 = TQ.ageInfo(q.age);
    if (ai0.valid) q.ageBand = ai0.band;
    if (!q.ageBand) q.ageBand = '18-65';
    if (typeof q.schengen !== 'boolean') q.schengen = false;
    if (!q.lifeRegion) {
      q.lifeRegion = q.schengen ? 'other' : (domesticDest ? 'asia14' : ((window.LIFE_RATES && LIFE_RATES.guessLifeRegion(q.destination)) || 'asia14'));
    }
    // 預設：方案一 純人壽、方案二 純產險、方案三 壽＋產
    q.plans.forEach(function (p, idx) {
      if (p.life && typeof p.life.enabled !== 'boolean') p.life.enabled = !!(PLAN_DEFAULTS[idx] || {}).life;
      if (p.life && TQ.CHILD_OH1_OPTIONS.indexOf(Number(p.life.childOh1Wan)) < 0) p.life.childOh1Wan = 60;
      if (q.schengen && p.life && p.life.enabled) p.life.oaa = false;
      if (p.life && p.life.combo !== 'plus') p.life.combo = 'basic';
      // 對齊 select 可選值
      var sd = snapDeath(p.property.deathWan, !!q.schengen);
      if (sd != null) p.property.deathWan = sd;
      else if (!TQ.num(p.property.deathWan)) p.property.deathWan = (PLAN_DEFAULTS[idx] || PLAN_DEFAULTS[2]).death;
      if (p.life && p.life.enabled) {
        var sa = snapAt1(p.life.at1Wan);
        if (sa != null) p.life.at1Wan = sa;
        else if (!TQ.num(p.life.at1Wan)) p.life.at1Wan = 500;
      }
    });
    // 名稱／副標：舊稿（無旗標）依樣式判斷是否自動；自動者一律依類型推導（避免「方案一 純人壽」卻只勾產險）
    q.plans.forEach(function (p, idx) {
      p.nameCustom = !TQ.nameIsAuto(p);
      p.taglineCustom = !TQ.taglineIsAuto(p);
      p.name = TQ.planName(p, idx, q);
      p.tagline = TQ.planTagline(p);
    });
    // 推薦：fr8 起預設「自動＝保障最高」；只有明確手動選擇（recoMode='manual'）才沿用
    if (q.recoMode !== 'manual') q.recoMode = 'auto';
    q._draftVersion = DRAFT_VERSION;
    return q;
  }

  /** 自動名稱／副標依目前類型＋保額重算，並同步分頁、方案標題、輸入框（使用者正在輸入的欄位不覆寫） */
  function syncPlanNames() {
    Q.plans.forEach(function (p, i) {
      if (!p.nameCustom) p.name = TQ.autoPlanName(p, i, Q);
      if (!p.taglineCustom) p.tagline = TQ.planTagline(p);
      var tab = planTabs.children[i];
      if (tab && tab.textContent !== p.name) tab.textContent = p.name;
      var sec = planForms.querySelector('[data-plan="' + i + '"]');
      if (!sec) return;
      var tt = sec.querySelector('.pf-title-txt');
      if (tt && tt.textContent !== p.name) tt.textContent = p.name;
      ['name', 'tagline'].forEach(function (f) {
        var el = sec.querySelector('[data-k="plans.' + i + '.' + f + '"]');
        if (el && el !== document.activeElement && el.value !== (p[f] || '')) el.value = p[f] || '';
      });
      var st = sec.querySelector('[data-name-state="' + i + '"]');
      if (st) st.textContent = p.nameCustom ? '自訂名稱（清空或按「依類型自動命名」可恢復自動）' : '自動：依方案類型＋保額產生';
    });
    syncRecoSelect();
  }
  /** 推薦方案選單（無／方案一／二／三）← 各方案 recommended */
  function syncRecoSelect() {
    var sel = document.getElementById('recoSel');
    if (!sel || !Q) return;
    if (Q.recoMode !== 'manual') {
      var mo = sel.querySelector('option[value="multi"]'); if (mo) mo.remove();
      sel.value = 'auto';
      var ai = Q.plans.map(function (p) { return !!p.recommended; }).indexOf(true);
      var ao = sel.querySelector('option[value="auto"]');
      if (ao) ao.textContent = '自動：保障最高' + (ai >= 0 ? '（目前＝方案' + '一二三'.charAt(ai) + '）' : '');
      return;
    }
    var on = [];
    Q.plans.forEach(function (p, i) { if (p.recommended) on.push(i); });
    var multi = sel.querySelector('option[value="multi"]');
    if (on.length > 1) {
      if (!multi) { multi = document.createElement('option'); multi.value = 'multi'; multi.disabled = true; sel.appendChild(multi); }
      multi.textContent = '（多個：' + on.map(function (i) { return '方案' + '一二三'.charAt(i); }).join('、') + '）';
      sel.value = 'multi';
    } else {
      if (multi) multi.remove();
      sel.value = on.length ? String(on[0]) : '';
    }
  }
  /** 推薦（fr8）：預設「自動」＝保障最高的方案（意外身故→住院→門診→意外醫療→醫療加值→保費）；手動選擇後依選擇 */
  function applyAutoReco() {
    if (!Q || Q.recoMode === 'manual') return;
    var bi = TQ.bestProtectionIndex(Q);
    Q.plans.forEach(function (p, i) { p.recommended = i === bi; });
  }
  /** 設定方案類型（純人壽／純產險／人壽＋產險）：唯一的類型來源，名稱／副標隨之推導 */
  function setPlanKind(i, kind) {
    var pe = Q.plans[i];
    if (!pe || TQ.PLAN_KINDS.indexOf(kind) < 0) return;
    var wantL = kind !== 'prop', wantP = kind !== 'life';
    if (wantL && !pe.life.enabled) {
      pe.life.enabled = true;
      if (!TQ.num(pe.life.at1Wan)) pe.life.at1Wan = 500;
      pe.life.oaa = !Q.schengen && Q.lifeRegion === 'asia14';
      pe.life.premium = null; pe.life._premAuto = false;
    } else if (!wantL && pe.life.enabled) {
      pe.life.enabled = false;
    }
    if (wantP !== propOn(pe)) {
      pe.property.enabled = wantP;
      pe.property._appliedCode = null; pe.property.planCode = '';
      if (wantP) { pe.property.premium = null; if (!TQ.num(pe.property.deathWan)) pe.property.deathWan = Q.schengen ? 500 : 200; }
    }
    delete skipAutoOnce.life[i]; delete skipAutoOnce.prop[i];
  }
  /** 快速套用：三方案同類型 200／500／1000萬（依年齡上限／DM 可選保額調整） */
  var QUICK_TIERS = [200, 500, 1000];
  function applyQuickPreset(kind) {
    var ai = TQ.ageInfo(Q.age), child = ai.valid && ai.child;
    var cap = ai.valid && !child ? ai.at1Max : 2000;
    var propOpts = propertyDeathOptionsFor(ai);
    var notes = [];
    Q.plans.forEach(function (p, i) {
      if (i > 2) return;
      var t = QUICK_TIERS[i];
      setPlanKind(i, kind);
      if (kind !== 'prop') {
        var a = Math.max(100, Math.min(t, cap));
        if (a !== t && !child) notes.push('方案' + '一二三'.charAt(i) + ' 人壽 ' + t + '萬超過「' + ai.label + '」AT1 上限，改為 ' + a + '萬');
        p.life.at1Wan = a; p.life.premium = null; p.life._premAuto = false;
        // 最高檔（1000萬）＝醫療加值（OH1／MR＝AT1×20%）；200／500萬＝國外旅遊適用
        p.life.combo = i === 2 ? 'plus' : 'basic';
      }
      if (kind !== 'life') {
        var d = null;
        propOpts.forEach(function (o) { if (o <= t) d = o; });
        if (d == null) d = propOpts[0] || t;
        if (d !== t && !child) notes.push('方案' + '一二三'.charAt(i) + ' 產險 ' + t + '萬不符 DM 投保年齡，改為 ' + d + '萬');
        p.property.deathWan = d; p.property.planCode = ''; p.property._appliedCode = null; p.property.premium = null;
        p.property.medPlus = i === 2; // 最高檔產險＝計畫二 醫療加值（海突住院150萬・含法傳）
      }
      p.nameCustom = false; p.taglineCustom = false;
    });
    if (child) notes.push('未滿15足歲：人壽為 MRC 60萬、產險為兒童方案，無 200／500／1000萬檔次，請再調整各方案');
    Q.recoMode = 'auto'; // 推薦＝保障最高（方案三 1000萬・醫療加值）
    activePlan = 0;
    buildPlanUI(); update();
    toast('已套用三方案' + TQ.PLAN_KIND_LABEL[kind] + ' 200／500／1000萬' + (notes.length ? '｜' + notes.join('；') : ''));
    return notes;
  }

  function setSchengenHint(showAuto) {
    var el = document.getElementById('schengenAutoHint');
    if (!el) return;
    if (showAuto && Q.schengen) {
      el.hidden = false;
      el.textContent = '已依目的地自動勾選申根';
    } else if (!Q.schengen && !schengenManual && Q.destination && !TQ.detectSchengen(Q.destination)) {
      el.hidden = true;
      el.textContent = '';
    } else {
      el.hidden = true;
    }
  }
  function propOn(p) { return !!(p && p.property && p.property.enabled !== false); }
  /* ---------- 國內地點（台灣／金門／馬祖／澎湖…）→ 警告＋擋報價 ---------- */
  function isDomesticDest() { return !!TQ.detectDomestic(Q && Q.destination); }
  /* ---------- 天數（fr7）：保險期間自「出發日＋出發時間」起算，每 24 小時一天；結束時間＝出發時間（不另填回程時間）；人壽、產險共用 ----------
   * 填天數（預設）：結束日＝出發日＋N 天（N＝1～180）。填回程日期：天數＝回程日－出發日（最少 1 天）。
   * 例：11/10 08:40 出發、5 天 → 11/15 08:40 結束。 */
  function modeOf() { return Q.dateMode === 'range' ? 'range' : 'days'; }
  function computeNew() {
    var s = TQ.parseDateParts(Q.startDate);
    if (modeOf() === 'days') {
      var raw = Q.tripDays, n = TQ.num(raw);
      var blank = raw === null || raw === undefined || raw === '';
      if (!s && blank) return { missing: true };
      if (!blank && !(n >= 1 && n <= 180 && Math.floor(n) === n)) return { error: '⚠ 天數請填 1～180 的整數（Go安行國外旅遊最高 180 天）' };
      if (!s || blank) return { missing: true };
      return { days: n, endDate: TQ.addDays(Q.startDate, n) };
    }
    var e = TQ.parseDateParts(Q.endDate);
    if (!s || !e) return { missing: true };
    var diff = Math.round((Date.UTC(e.y, e.m - 1, e.d) - Date.UTC(s.y, s.m - 1, s.d)) / 86400000);
    if (diff < 0) return { error: '⚠ 回程日早於出發日，請確認日期' };
    return { days: Math.max(1, diff), endDate: Q.endDate };
  }
  function dateState() {
    var r = computeNew();
    var noTime = TQ.parseTime(Q.startTime) == null;
    if (r.error) return { days: null, error: r.error };
    if (r.days) {
      var base = { newDays: r.days, endDate: r.endDate, noTime: noTime };
      // 選填覆寫：公司系統試算天數不同時手動指定
      var ov = TQ.num(Q.daysOverride);
      if (ov > 0 && Math.floor(ov) === ov) return Object.assign(base, { days: ov, override: true });
      // 舊版（fr6 以前）連結／草稿：沿用原報價天數（不默默改價），直到使用者改日期／時間／天數
      if (legacyDays != null && legacyDays !== r.days) return Object.assign(base, { days: legacyDays, legacy: true });
      return Object.assign(base, { days: r.days });
    }
    if (keptLinkDays && !TQ.parseDateParts(Q.startDate) && TQ.num(Q.days) > 0) return { days: Number(Q.days), kept: true, missing: true };
    return { days: null, missing: true };
  }
  /** 依輸入同步 Q.days／結束日時；有變動時恢復保費自動查表 */
  function syncDaysFromDates() {
    var st = dateState();
    var nd = st.days == null ? null : st.days;
    if ((Q.days == null ? null : Number(Q.days)) !== nd) {
      Q.days = nd;
      skipAutoOnce.life = {}; skipAutoOnce.prop = {};
    }
    if (st.legacy || st.kept) {
      delete Q.dayRule; // 沿用舊天數期間不標記（重新載入仍沿用）；保留原回程時間供顯示
    } else {
      Q.dayRule = TQ.DAY_RULE;
      Q.endTime = TQ.fmtTime(Q.startTime); // 結束時間＝出發時間
      if (modeOf() === 'days') Q.endDate = st.endDate || '';
      var ed = form.querySelector('[data-k="endDate"]');
      if (ed && ed !== document.activeElement && ed.value !== (Q.endDate || '')) ed.value = Q.endDate || '';
    }
    return st;
  }
  /** 「11/10 08:40～11/15 08:40」（時間未填只顯示日期） */
  function periodShort() {
    return TQ.fmtDateTime(Q.startDate, Q.startTime, 'short') + '～' + TQ.fmtDateTime(Q.endDate, Q.endTime, 'short');
  }
  function updateDaysDisplay(st) {
    st = st || dateState();
    var v = document.getElementById('daysAutoVal'), sub = document.getElementById('daysAutoSub'), w = document.getElementById('dateWarn');
    var row = form.querySelector('.date-row');
    if (row) { row.classList.toggle('mode-days', modeOf() === 'days'); row.classList.toggle('mode-range', modeOf() === 'range'); }
    var ro = document.getElementById('endTimeRO');
    if (ro) ro.value = TQ.fmtTime(st.legacy ? Q.endTime : Q.startTime);
    var txt = '', subTxt = '', warn = '', soft = false;
    if (st.error) warn = st.error;
    else if (st.days) {
      txt = st.kept ? '共 ' + st.days + ' 天' : '保險期間共 ' + st.days + ' 天（' + periodShort() + '）';
      if (st.kept) subTxt = '沿用原報價天數；請補填出發日期、出發時間與天數';
      else if (st.override) subTxt = '手動覆寫天數；依輸入計為 ' + st.newDays + ' 天';
      else if (st.legacy) subTxt = '沿用原報價天數（舊版連結）；依新制（結束時間＝出發時間）應為 ' + st.newDays + ' 天，修改日期／時間／天數即改依新制重算';
      else if (st.noTime) subTxt = '⚠ 出發時間未填：請填班機實際起飛時間（結束時間同出發時間）';
      else subTxt = '自出發時間起算，每 24 小時一天；結束時間＝出發時間 ' + TQ.fmtTime(Q.startTime);
      if (st.days > 30) { soft = true; warn = '⚠ 目前 ' + st.days + ' 天：人壽（亞洲14國）可自動算到 180 天；產險費率僅 2～20、25、30 天（部分保額）、未滿15歲人壽僅 1～30 天，其餘請以 GPTA／產險試算後手填'; }
    }
    if (v) v.textContent = txt;
    if (sub) { sub.textContent = subTxt; sub.classList.toggle('warn', !!(st.legacy || (st.noTime && !st.kept))); }
    if (w) { w.hidden = !warn; w.textContent = warn; w.classList.toggle('soft', soft); }
    ['startDate', 'endDate', 'tripDays'].forEach(function (k) {
      var el = form.querySelector('[data-k="' + k + '"]');
      if (el) el.classList.toggle('is-domestic', !!st.error);
    });
  }

  /** 擋下產生報價的問題（國內目的地、日期未填／回程早於出發、年齡未填／無效、AT1 超過年齡上限、產險方案不符 DM 投保年齡） */
  function quoteBlockers() {
    var out = [];
    if (isDomesticDest()) out.push(TQ.DOMESTIC_WARNING);
    var ds = dateState();
    if (ds.error) out.push(ds.error);
    else if (ds.missing) out.push(modeOf() === 'days' ? '⚠ 請填寫出發日與天數（1～180）' : '⚠ 請填寫出發日與回程日');
    var ai = TQ.ageInfo(Q && Q.age);
    if (!ai.valid) { out.push('⚠ ' + ai.error); return out; }
    Q.plans.forEach(function (p, i) {
      var n = p.name || ('方案' + (i + 1));
      if (!(p.life && p.life.enabled) && !propOn(p)) out.push('⚠ ' + n + '：請選擇方案類型（純人壽／純產險／人壽＋產險）');
      if (p.life && p.life.enabled && !ai.child && TQ.num(p.life.at1Wan) > ai.at1Max) {
        out.push('⚠ ' + n + '：人壽 AT1 ' + p.life.at1Wan + ' 萬超過「' + ai.label + '」上限 ' + ai.at1Max + ' 萬，請調降');
      }
      if (!propOn(p)) return;
      if (TQ.num(Q.days) === 1) out.push('⚠ ' + n + '：產險最少需投保 2 天（富邦產險系統：國外旅遊保險期間至少需 2 日）；請改天數或改純人壽');
      var pre = TQ.resolvePropertyPreset(p.property, Q);
      var ac = TQ.propertyAgeCheck(pre, Q);
      if (!ac.ok) out.push('⚠ ' + n + '：產險' + ac.tip);
    });
    return out;
  }
  /** 年齡欄提示（紅字＝必填／無效；橘字＝80歲以上無產險方案；藍字＝年齡帶與上限） */
  function updateAgeWarning() {
    var ai = TQ.ageInfo(Q.age);
    var w = document.getElementById('ageWarn'), hint = document.getElementById('ageHint');
    var inp = form.querySelector('[data-k="age"]');
    var msg = '', soft = false, note = '';
    if (!ai.valid) {
      msg = '⚠ ' + ai.error;
    } else {
      if (ai.child) {
        note = '未滿15歲人壽主約為兒童傷害醫療旅平險 MRC 60萬，不提供AT1（OH1 可選 60／120萬＋OAA）；產險改新快樂旅綜+ 兒童方案（DM：未滿15足歲無意外死亡喪葬費用保險金）';
      } else {
        note = 'GPTA 年齡帶：' + ai.label + '｜人壽 AT1 上限 ' + ai.at1Max + ' 萬' +
          '｜產險可選：' + propertyDeathOptionsFor(ai).map(function (x) { return x + '萬'; }).join('／');
      }
      if (!ai.child && ai.age >= 66) {
        note += '（66歲以上人壽保費同 18～65，僅 AT1 上限不同）';
        if (ai.age >= 80) { soft = true; msg = '⚠ ' + ai.label + '：產險新快樂旅綜+ 投保年齡最高 79 歲，無可投保方案'; }
      } else if (ai.band === '15-17') {
        note += '（15～17歲費率同 18～65；產險 1000萬以上、租車限 18 歲以上）';
      }
    }
    if (w) { w.hidden = !msg; w.textContent = msg; w.classList.toggle('soft', soft); }
    if (hint) { hint.textContent = note; hint.className = note ? 'age-note' : 'hint'; }
    if (inp) { inp.classList.toggle('is-domestic', !ai.valid); inp.setAttribute('aria-invalid', ai.valid ? 'false' : 'true'); }
  }
  /** 顯示／隱藏目的地紅字警告與年齡提示，並鎖定「下載三方案總表圖」 */
  function updateDomesticWarning() {
    var dom = isDomesticDest();
    var w = document.getElementById('destWarn');
    if (w) { w.hidden = !dom; w.textContent = dom ? TQ.DOMESTIC_WARNING : ''; }
    var inp = form.querySelector('[data-k="destination"]');
    if (inp) { inp.classList.toggle('is-domestic', dom); inp.setAttribute('aria-invalid', dom ? 'true' : 'false'); }
    updateAgeWarning();
    var bl = quoteBlockers();
    ['btnSummaryPng', 'btnCopyLink', 'btnOpenClient'].forEach(function (id) {
      var b = document.getElementById(id);
      if (!b) return;
      b.classList.toggle('is-blocked', bl.length > 0);
      b.setAttribute('aria-disabled', bl.length ? 'true' : 'false');
      if (bl.length) b.title = bl.join('\n'); else b.removeAttribute('title');
    });
    if (dom) setSchengenHint(false);
    return dom;
  }
  /** 有任何擋報價問題時擋下下載總表圖；回傳 true 表示已擋 */
  function blockIfDomestic() {
    var bl = quoteBlockers();
    if (!bl.length) return false;
    updateDomesticWarning();
    alert(bl.join('\n'));
    var focusKey = isDomesticDest() ? 'destination' : (!TQ.ageInfo(Q.age).valid ? 'age' : null);
    var inp = focusKey && form.querySelector('[data-k="' + focusKey + '"]');
    if (inp) inp.focus();
    return true;
  }

  /** 依目的地自動勾／取消申根；手動覆寫期間不改 */
  function syncSchengenFromDestination() {
    if (schengenManual) { setSchengenHint(false); return false; }
    // 國內地點：不依此文字自動分類（申根／地區）
    if (isDomesticDest()) { setSchengenHint(false); return false; }
    var want = TQ.detectSchengen(Q.destination);
    var cb = form.querySelector('[data-k="schengen"]');
    if (want === !!Q.schengen) {
      setSchengenHint(want);
      if (cb) cb.checked = !!Q.schengen;
      return false;
    }
    applySchengenMode(want);
    if (cb) cb.checked = want;
    setSchengenHint(want);
    return true; // 呼叫端應 rebuild
  }

  function applySchengenMode(on) {
    Q.schengen = !!on;
    if (on) {
      Q.lifeRegion = 'other';
      // 申根／歐洲：依目的地套 DM 註3（歐洲＝200%；若判不到則預設 200%）
      Q.lifeRegionPct = TQ.guessRegionPct(Q.destination) || 200;
      if (Number(Q.lifeRegionPct) === 100) Q.lifeRegionPct = 200;
      Q.plans.forEach(function (p) {
        if (p.life && p.life.enabled) {
          p.life.oaa = false;
          // 離線表無「國外其他」費率 → 清掉自動壽險保費，改手填
          if (p.life._premAuto || true) { p.life.premium = null; p.life._premAuto = false; }
        }
        // 對齊申根可選保額
        if ([200, 300, 500, 1000, 1500].indexOf(Number(p.property.deathWan)) < 0) p.property.deathWan = 500;
        p.property._appliedCode = null; // 強制改套 P2
        if (p.property.planCode && /^P1-G/.test(p.property.planCode)) p.property.planCode = '';
      });
    } else {
      Q.lifeRegion = (window.LIFE_RATES && LIFE_RATES.guessLifeRegion(Q.destination)) || 'asia14';
      Q.lifeRegionPct = TQ.guessRegionPct(Q.destination);
      Q.plans.forEach(function (p) {
        if (p.life && p.life.enabled) p.life.oaa = (Q.lifeRegion === 'asia14');
        // 非申根無 1500 → 對齊最近檔
        var d = Number(p.property.deathWan);
        if ([200, 300, 500, 1000].indexOf(d) < 0) {
          p.property.deathWan = (d >= 750 ? 1000 : (d >= 400 ? 500 : (d >= 250 ? 300 : 200)));
        }
        p.property._appliedCode = null;
        if (p.property.planCode && /^P2-G/.test(p.property.planCode)) p.property.planCode = '';
      });
    }
    var lr = form.querySelector('[data-k="lifeRegion"]');
    if (lr) lr.value = Q.lifeRegion;
    var lp = form.querySelector('[data-k="lifeRegionPct"]');
    if (lp) lp.value = Q.lifeRegionPct;
  }

  /* ---------- 產險整包自動帶入（保額／天數）＋人壽保費查表 ---------- */
  /** 依保額（或進階 planCode）套用不便險／其他保障／住院醫療等；回傳是否異動項目（需重建表單） */
  function applyPropertyCoverage(plan) {
    if (!propOn(plan)) { plan.property._covAuto = false; return false; }
    var preset = TQ.resolvePropertyPreset(plan.property, Q);
    if (!preset) {
      plan.property._premTip = Q.schengen
        ? '尚無對應產險方案（申根請選 200／300／500／1000／1500）'
        : '尚無對應產險方案（請選 200／300／500／1000，或用進階下拉）';
      plan.property._covAuto = false;
      return false;
    }
    var changed = plan.property._appliedCode !== preset.code
      || !plan.inconvenience || !plan.inconvenience.length
      || !plan.others || !plan.others.length;
    plan.property.planCode = preset.code;
    plan.property.label = preset.label;
    if (!preset.child) plan.property.deathWan = preset.deathWan; // 兒童方案無身故：保留成人保額以便改回年齡時還原
    plan.property.hospitalWan = preset.hospitalWan;
    plan.property.accidentMedicalWan = preset.accidentMedicalWan;
    // 門診／急診留給自動比例（null＝住院×2%／5%）
    if (!TQ.isSet(plan.property.outpatientYuan) || changed) plan.property.outpatientYuan = null;
    if (!TQ.isSet(plan.property.erYuan) || changed) plan.property.erYuan = null;
    if (changed) {
      plan.inconvenience = clone(preset.inconvenience);
      plan.others = clone(preset.others);
      plan.property._appliedCode = preset.code;
      plan.property._covAuto = true;
    }
    return changed;
  }

  function applyAutoPremiums() {
    var bannerBits = [];
    var needRebuild = false;
    Q.plans.forEach(function (p, i) {
      // 產險：先依保額套保障項目
      if (applyPropertyCoverage(p)) needRebuild = true;

      if (!propOn(p)) {
        p.property.premium = 0; p.property._premAuto = true; p.property._premTip = '未含產險（純人壽方案）';
      } else if (!skipAutoOnce.prop[i]) {
        var pr = TQ.lookupPropertyPremium(p.property, Q.days, Q);
        if (pr.preset) {
          p.property.planCode = pr.preset.code;
          if (!p.property._appliedCode) p.property._appliedCode = pr.preset.code;
        }
        if (pr.found) {
          p.property.premium = pr.premium;
          p.property._premTip = pr.tip + (p.property._covAuto ? '；不便險／其他保障已自動帶入' : '');
          p.property._premAuto = true;
        } else if (pr.ageBlocked) {
          p.property.premium = null;
          p.property._premTip = pr.tip;
          p.property._premAuto = false;
        } else if (pr.outOfRange) {
          p.property.premium = null;
          p.property._premTip = pr.tip + '（保障項目仍已依保額自動帶入）';
          p.property._premAuto = false;
        } else {
          p.property._premTip = pr.tip;
          p.property._premAuto = false;
        }
      } else {
        p.property._premAuto = false;
        p.property._premTip = '已手動修改產險保費（改天數或保額可恢復自動）';
      }

      // 人壽
      if (!p.life.enabled) {
        if (!skipAutoOnce.life[i]) { p.life.premium = 0; p.life._premAuto = true; p.life._premTip = '未含人壽'; }
      } else if (!skipAutoOnce.life[i] && window.LIFE_RATES) {
        var lr = LIFE_RATES.lookupLifePremium(Q, p);
        if (lr.found) {
          p.life.premium = lr.premium;
          p.life._premTip = lr.tip;
          p.life._premAuto = true;
        } else {
          if (p.life._premAuto || lr.overCap || lr.noRates) p.life.premium = null;
          p.life._premTip = (Q.schengen && !lr.overCap && !lr.noRates && TQ.ageInfo(Q.age).valid !== false)
            ? '申根人壽需 GPTA「國外其他」費率（OH1 官方表僅亞洲14國）；請手填保費'
            : lr.tip;
          p.life._premAuto = false;
        }
      } else if (!window.LIFE_RATES) {
        p.life._premTip = '缺少 js/life-rates.js';
        p.life._premAuto = false;
      } else {
        p.life._premAuto = false;
        p.life._premTip = '已手動修改人壽保費（改天數／AT1／OAA／年齡帶可恢復自動）';
      }

      bannerBits.push(
        (p.name || ('方案' + (i + 1))) + '：壽' + (!p.life.enabled ? '不含' : (p.life._premAuto ? '自動' : '手填／缺表')) +
        '／產' + (!propOn(p) ? '不含' : (p.property._premAuto ? '自動' : (p.property._premTip && p.property._premTip.indexOf('無資料') >= 0 ? '無費率' : '手填／未對應')))
      );
    });
    var el = document.getElementById('autoPremiumBanner');
    if (el) el.textContent = '保費狀態 — ' + bannerBits.join('；') + '｜產險：改保額或天數即自動帶不便險／保障／保費';
    return needRebuild;
  }

  /* ---------- 路徑存取 ---------- */
  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function setPath(obj, path, val) {
    var ks = path.split('.'), o = obj;
    for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; }
    o[ks[ks.length - 1]] = val;
  }

  /* ---------- 方案表單 ---------- */
  function field(label, key, opts) {
    opts = opts || {};
    var attrs = '';
    if (opts.type !== 'text') {
      attrs += ' inputmode="numeric"';
      attrs += ' min="' + (opts.min != null ? opts.min : 0) + '"';
      if (opts.max != null) attrs += ' max="' + opts.max + '"';
      attrs += ' step="' + (opts.step != null ? opts.step : 'any') + '"';
    }
    return '<label>' + esc(label) + '<input type="' + (opts.type || 'number') + '" data-k="' + key + '"' + attrs +
      (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + '>' +
      (opts.hint ? '<span class="hint' + (opts.auto ? ' auto' : '') + '" data-hint="' + key + '">' + esc(opts.hint) + '</span>' : '') + '</label>';
  }
  /** DM 固定產險保額（一般 G）；申根＝計畫二另有 1500 */
  function propertyDeathOptions() {
    return Q.schengen ? [200, 300, 500, 1000, 1500] : [200, 300, 500, 1000];
  }
  /** 依 DM 投保年齡過濾可選產險保額（一般 G 方案 ageMin～ageMax） */
  function propertyDeathOptionsFor(ai) {
    var all = propertyDeathOptions();
    if (!ai || !ai.valid || ai.child) return all;
    var pre = Q.schengen ? 'P2-G' : 'P1-G';
    return all.filter(function (d) {
      var x = PRESETS.filter(function (p) { return p.code === pre + d; })[0];
      return !x || x.ageMin == null || (ai.age >= x.ageMin && ai.age <= x.ageMax);
    });
  }
  /** 選單選項：可選者正常顯示；目前值若不符年齡則附上「超過上限」選項以便看見並警告 */
  function withCurrent(opts, cur, overLabel) {
    var out = opts.map(function (v) { return { value: v, label: v + ' 萬' }; });
    var n = Number(cur);
    if (cur != null && cur !== '' && isFinite(n) && opts.indexOf(n) < 0) out.push({ value: n, label: n + ' 萬（' + overLabel + '）' });
    return out;
  }
  function selectField(label, key, options, opts) {
    opts = opts || {};
    var h = '<label>' + esc(label) + '<select data-k="' + key + '" data-num="1">';
    if (opts.blank) h += '<option value="">—</option>';
    options.forEach(function (o) {
      var val = (o && typeof o === 'object') ? o.value : o;
      var lab = (o && typeof o === 'object') ? o.label : (o + ' 萬');
      h += '<option value="' + esc(String(val)) + '">' + esc(String(lab)) + '</option>';
    });
    h += '</select>';
    if (opts.hint) h += '<span class="hint' + (opts.auto ? ' auto' : '') + '" data-hint="' + key + '">' + esc(opts.hint) + '</span>';
    h += '</label>';
    return h;
  }
  function at1Options(cap) {
    var out = [];
    var max = Math.min(2000, cap || 2000);
    for (var n = 100; n <= max; n += AT1_STEP) out.push(n);
    return out;
  }
  function presetOptions(selected) {
    var h = '<option value="">— 選擇方案帶入（新快樂旅綜+ 115.04 DM）—</option>';
    var ai = TQ.ageInfo(Q.age);
    PRESETS.forEach(function (p) {
      var ok = !ai.valid || p.ageMin == null || (ai.age >= p.ageMin && ai.age <= p.ageMax);
      h += '<option value="' + esc(p.code) + '"' + (selected === p.code ? ' selected' : '') + (ok ? '' : ' disabled') + '>' +
        esc(p.label + '（' + p.ageLabel + '）' + (ok ? '' : '｜年齡不符')) + '</option>';
    });
    return h;
  }
  function listEditor(i, kind, title) {
    var items = Q.plans[i][kind];
    var h = '<h3>' + esc(title) + '（' + items.length + ' 項）</h3><div class="list-ed">';
    items.forEach(function (it, j) {
      var base = 'plans.' + i + '.' + kind + '.' + j;
      h += '<div class="list-row">' +
        '<input type="text" data-k="' + base + '.name" placeholder="項目名稱">' +
        '<input type="text" data-k="' + base + '.amount" placeholder="保額／給付（照條款填寫）">' +
        '<div class="row-btns">' +
        '<button type="button" class="btn btn-sm" data-act="up" data-i="' + i + '" data-kind="' + kind + '" data-j="' + j + '" title="上移">↑</button>' +
        '<button type="button" class="btn btn-sm" data-act="down" data-i="' + i + '" data-kind="' + kind + '" data-j="' + j + '" title="下移">↓</button>' +
        '<button type="button" class="btn btn-sm btn-danger" data-act="del" data-i="' + i + '" data-kind="' + kind + '" data-j="' + j + '" title="刪除">✕</button>' +
        '</div></div>';
    });
    h += '</div><button type="button" class="btn btn-sm" style="margin-top:8px" data-act="add" data-i="' + i + '" data-kind="' + kind + '">＋ 新增項目</button>';
    return h;
  }
  function planForm(i) {
    var b = 'plans.' + i + '.';
    var plan = Q.plans[i];
    var hasLife = !!(plan.life && plan.life.enabled);
    var ai = TQ.ageInfo(Q.age);
    var child = TQ.isChildQuote(Q);
    var h = '<section class="ed-card plan-form" data-plan="' + i + '"' + (i === activePlan ? '' : ' hidden') + '>';
    h += '<h2><span class="pf-title-txt">' + esc(plan.name || ('方案' + (i + 1))) + '</span>' +
      (plan.recommended ? ' <span class="reco-badge" style="font-size:13px">推薦</span>' : '') + '</h2>';
    var hasProp = propOn(plan);
    var kind = TQ.planKind(plan);
    h += '<label class="kind-sel">方案類型<select data-k="' + b + 'kind">' +
      (kind === 'none' ? '<option value="none" disabled>⚠ 請選擇方案類型</option>' : '') +
      '<option value="life">純人壽（富邦人壽 Go安行）</option>' +
      '<option value="prop">純產險（富邦產險 新快樂旅綜+）</option>' +
      '<option value="both">人壽＋產險</option>' +
      '</select></label>';
    h += '<p class="plan-simple-hint">' + (hasLife && hasProp
      ? '壽＋產：只需填人壽保額、產險保額（其餘自動）'
      : hasLife ? '純人壽：只需填人壽保額（不含產險／不便險）'
      : hasProp ? '純產險：只需填產險保額（無人壽）'
      : '⚠ 請選擇方案類型') +
      (Q.schengen ? '　｜已勾選申根→產險用計畫二（突發疾病 150萬）' : '') + '</p>';

    h += '<div class="grid g2">';
    if (hasLife && child) {
      h += selectField('人壽 OH1 海外突發疾病（萬）', b + 'life.childOh1Wan',
        TQ.CHILD_OH1_OPTIONS.map(function (v) { return { value: v, label: v + ' 萬' + (v === 60 ? '（預設）' : '（醫療加值）') }; }), {
        hint: '未滿15歲人壽主約為兒童傷害醫療旅平險 MRC 60萬，不提供AT1；無 MR；OAA 同成人', auto: true
      });
    } else if (hasLife) {
      var cap = ai.valid ? ai.at1Max : 2000;
      h += selectField('人壽保額 AT1（萬）', b + 'life.at1Wan', withCurrent(at1Options(cap), plan.life.at1Wan, '超過年齡上限 ' + cap + ' 萬'), {
        hint: (ai.valid ? ai.label + '：AT1 100～' + cap + ' 萬' : '以 50 萬為單位（100～2000）') + '；OH1／MR 依下方人壽組合自動（進階可改）' +
          '；亞洲14國保費依旅行社費率表自動加總（AT1 表列保額；兩種人壽組合；1～180天），國外其他請手填', auto: true
      });
      var cb = TQ.lifeCombo(plan.life);
      h += '<label>人壽組合（DM 註1／註2）<select data-k="' + b + 'life.combo">' +
        '<option value="basic"' + (cb === 'basic' ? ' selected' : '') + '>國外旅遊適用（OH1／MR＝AT1×10%）</option>' +
        '<option value="plus"' + (cb === 'plus' ? ' selected' : '') + '>國外旅遊醫療加值（OH1／MR＝AT1×20%，上限250萬）</option>' +
        '</select><span class="hint auto">目前 OH1／MR 預設 ' + TQ.comma(TQ.defaultOh1MrWan(plan.life, Q)) + ' 萬；醫療加值無離線費率，保費需 GPTA 手填</span></label>';
    }
    if (!hasProp) {
      // 純人壽：不顯示產險欄位
    } else if (child) {
      h += '<label>產險方案<input type="text" readonly value="' + esc(Q.schengen || plan.property.planCode === 'P2-CHILD' ? '計畫二 兒童醫療加值（P2-CHILD）' : '計畫一 兒童國外（P1-CHILD）') + '">' +
        '<span class="hint auto">未滿15足歲只能投保兒童方案；DM：無意外死亡之喪葬費用保險金（身故及失能「-」）</span></label>';
    } else {
      h += selectField('產險保額（萬）', b + 'property.deathWan', withCurrent(propertyDeathOptionsFor(ai), plan.property.deathWan, '不符 DM 投保年齡'), {
        hint: (Q.schengen || plan.property.medPlus) ? '計畫二 P2-G*（醫療加值：海外突發疾病住院 150萬・含法定傳染病）' : '計畫一 P1-G*（國外旅遊適用）',
        auto: true
      });
    }
    if (hasProp && !Q.schengen) {
      h += '<label class="check medplus-check"><input type="checkbox" data-k="' + b + 'property.medPlus"> 產險醫療加值（計畫二：海外突發疾病住院 150萬・含法定傳染病；DM 開放非申根國投保）</label>';
    }
    h += '</div>';
    // 查無費率時（申根人壽／產險超過 DM 天數）直接在這裡手填保費
    h += '<div class="grid g2 quick-prem">' +
      (hasLife ? field('人壽保費（元）', b + 'life.premium', { ph: 'GPTA 試算後填入', hint: '查表有值會自動帶入；可手改' }) : '') +
      (hasProp ? field('產險保費（元）', b + 'property.premium', { ph: '產險試算後填入', hint: '2～20、25、30 天自動（DM＋B2B 試算）；其他天數手填' }) : '') +
      '</div>';
    h += '<p class="hint" data-life-prem-tip="' + i + '"></p>';
    h += '<p class="hint" data-prop-prem-tip="' + i + '"></p>';

    h += '<details class="prop-advanced" style="margin-top:10px"><summary>進階（名稱／附約／細項／手改保費）</summary>';
    h += '<div class="grid g2" style="margin-top:8px">' +
      field('方案名稱', b + 'name', { type: 'text', ph: '空白＝依類型自動' }) +
      field('副標', b + 'tagline', { type: 'text', ph: '空白＝依類型自動' }) +
      '</div>';
    h += '<p class="hint name-state"><span data-name-state="' + i + '"></span> ' +
      '<button type="button" class="btn btn-sm" data-act="autoname" data-i="' + i + '">↺ 依類型自動命名</button>' +
      '　推薦標示請用上方「推薦方案」選單</p>';

    h += '<div class="sub-box life-box" style="margin-top:10px"><b>人壽細項</b>' + (hasLife ? '' : '<span class="hint">（未含人壽）</span>');
    h += '<div class="grid g3" style="margin-top:8px">' +
      (child ? '' : field('OH1（萬）', b + 'life.oh1Wan', { hint: '空白＝依人壽組合', auto: true }) +
        field('MR（萬）', b + 'life.mrWan', { hint: '空白＝依人壽組合', auto: true })) +
      '</div>';
    h += '<label class="check" style="margin-top:8px"><input type="checkbox" data-k="' + b + 'life.oaa"> OAA（限亞洲14國）</label>';
    h += '<div class="grid g3" style="margin-top:8px">' +
      field('人壽住院（元）', b + 'life.hospitalYuan', { hint: '空白＝自動', auto: true }) +
      field('人壽門診每日（元）', b + 'life.outpatientYuan', { hint: '空白＝自動', auto: true }) +
      field('人壽急診每日（元）', b + 'life.erYuan', { hint: '空白＝自動', auto: true }) +
      '</div></div>';

    h += '<div class="sub-box prop-box" style="margin-top:10px"><b>產險細項</b>' + (hasProp ? '' : '<span class="hint">（未含產險）</span>');
    h += '<div class="preset-row" style="margin-top:8px"><label>改選完整方案<select data-preset="' + i + '">' +
      presetOptions(plan.property.planCode) + '</select></label></div>';
    h += '<div class="grid g3">' +
      field('方案代碼', b + 'property.planCode', { type: 'text' }) +
      field('突發疾病住院（萬）', b + 'property.hospitalWan') +
      field('門診（元）', b + 'property.outpatientYuan', { hint: '空白＝自動', auto: true }) +
      field('急診（元）', b + 'property.erYuan', { hint: '空白＝自動', auto: true }) +
      field('意外醫療（萬）', b + 'property.accidentMedicalWan') +
      '</div>';
    h += listEditor(i, 'inconvenience', '不便險項目');
    h += listEditor(i, 'others', '其他產險保障');
    h += '</div></details>';

    h += '<div class="sumbar" data-sum="' + i + '"></div>';
    h += '</section>';
    return h;
  }
  function buildPlanUI() {
    rebuildingUI = true;
    Q.plans.forEach(function (p, i) {
      if (!p.nameCustom) p.name = TQ.autoPlanName(p, i, Q);
      if (!p.taglineCustom) p.tagline = TQ.planTagline(p);
    });
    planTabs.innerHTML = Q.plans.map(function (p, i) {
      return '<button type="button" data-tab="' + i + '"' + (i === activePlan ? ' class="on"' : '') + '>' + esc(p.name || ('方案' + (i + 1))) + '</button>';
    }).join('');
    // 重建時保留各方案「進階」展開狀態
    var openDet = Array.prototype.map.call(planForms.querySelectorAll('[data-plan]'), function (sec) {
      return Array.prototype.map.call(sec.querySelectorAll('details'), function (d) { return d.open; });
    });
    planForms.innerHTML = Q.plans.map(function (_, i) { return planForm(i); }).join('');
    Array.prototype.forEach.call(planForms.querySelectorAll('[data-plan]'), function (sec, si) {
      Array.prototype.forEach.call(sec.querySelectorAll('details'), function (d, di) { if (openDet[si] && openDet[si][di]) d.open = true; });
    });
    fillInputs(planForms);
    syncPlanNames();
    rebuildingUI = false;
    refreshDerived();
  }

  /* ---------- 表單 ↔ 資料 ---------- */
  function fillInputs(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll('[data-k]'), function (el) {
      var k = el.getAttribute('data-k'), v;
      var mK = /^plans\.(\d+)\.kind$/.exec(k);
      if (k === 'extraNotesText') v = (Q.extraNotes || []).join('\n');
      else if (mK) v = TQ.planKind(Q.plans[Number(mK[1])]);
      else v = getPath(Q, k);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = (v === null || v === undefined) ? '' : v;
    });
  }
  function readInput(el) {
    var k = el.getAttribute('data-k');
    if (k === 'extraNotesText') { Q.extraNotes = el.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); return; }
    var mKind = /^plans\.(\d+)\.kind$/.exec(k);
    if (mKind) { setPlanKind(Number(mKind[1]), el.value); return; }
    var mNm = /^plans\.(\d+)\.(name|tagline)$/.exec(k);
    if (mNm) {
      var pn = Q.plans[Number(mNm[1])], txt = String(el.value || '');
      pn[mNm[2] + 'Custom'] = !!txt.trim();
      pn[mNm[2]] = txt.trim() ? txt : (mNm[2] === 'name' ? TQ.autoPlanName(pn, Number(mNm[1]), Q) : TQ.planTagline(Object.assign({}, pn, { taglineCustom: false })));
      syncPlanNames();
      return;
    }
    var v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number' || (el.tagName === 'SELECT' && (k === 'lifeRegionPct' || el.getAttribute('data-num') === '1'))) {
      v = el.value === '' ? null : Number(el.value);
      if (v !== null && !isFinite(v)) v = null;
    } else v = el.value;
    // AT1：對齊 50 萬刻度（100～2000）
    if (/\.life\.at1Wan$/.test(k) && v != null) {
      v = Math.round(v / AT1_STEP) * AT1_STEP;
      if (v < 100) v = 100;
      if (v > 2000) v = 2000;
      if (el.tagName === 'SELECT' || el.type === 'number') el.value = String(v);
    }
    setPath(Q, k, v);

    // 勾選／取消 含人壽、含產險
    var mEn = /^plans\.(\d+)\.(life|property)\.enabled$/.exec(k);
    if (mEn) {
      var pe = Q.plans[Number(mEn[1])];
      if (mEn[2] === 'life' && v) {
        if (!TQ.num(pe.life.at1Wan)) pe.life.at1Wan = 500;
        pe.life.oaa = !Q.schengen && Q.lifeRegion === 'asia14';
        pe.life.premium = null; pe.life._premAuto = false;
      }
      if (mEn[2] === 'property') {
        pe.property._appliedCode = null; pe.property.planCode = '';
        if (v) { pe.property.premium = null; if (!TQ.num(pe.property.deathWan)) pe.property.deathWan = Q.schengen ? 500 : 200; }
        delete skipAutoOnce.prop[Number(mEn[1])];
      }
    }

    // 手動改保費 → 跳過自動覆寫
    var mLife = /^plans\.(\d+)\.life\.premium$/.exec(k);
    var mProp = /^plans\.(\d+)\.property\.premium$/.exec(k);
    if (mLife) { skipAutoOnce.life[Number(mLife[1])] = true; Q.plans[Number(mLife[1])].life._premAuto = false; }
    if (mProp) { skipAutoOnce.prop[Number(mProp[1])] = true; Q.plans[Number(mProp[1])].property._premAuto = false; }

    // 改關鍵欄位 → 恢復自動
    if (k === 'age') {
      var aiR = TQ.ageInfo(v);
      if (aiR.valid) {
        Q.ageBand = aiR.band;
        var abSel = form.querySelector('[data-k="ageBand"]');
        if (abSel) abSel.value = aiR.band;
      }
    }
    if (k === 'age' || k === 'startDate' || k === 'endDate' || k === 'startTime' || k === 'tripDays' || k === 'dateMode' || k === 'daysOverride' || k === 'ageBand' || k === 'lifeRegion' || k === 'lifeRateType' || k === 'destination' || k === 'schengen') {
      skipAutoOnce.life = {}; skipAutoOnce.prop = {};
    }
    if (k === 'schengen') {
      schengenManual = true;
      applySchengenMode(!!v);
      setSchengenHint(false); // 手動 → 不顯示自動提示
    }
    var mAt = /^plans\.(\d+)\.life\.(at1Wan|childOh1Wan|oh1Wan|mrWan|oaa|enabled|combo)$/.exec(k);
    if (mAt) delete skipAutoOnce.life[Number(mAt[1])];
    var mPc = /^plans\.(\d+)\.property\.(planCode|deathWan|hospitalWan|medPlus)$/.exec(k);
    if (mPc) {
      var pi = Number(mPc[1]);
      delete skipAutoOnce.prop[pi];
      // 保額或方案變了 → 強制重套不便險／保障；改保額時清掉舊 planCode 以免蓋回
      if (mPc[2] === 'deathWan' || mPc[2] === 'medPlus') {
        Q.plans[pi].property._appliedCode = null;
        Q.plans[pi].property.planCode = '';
      } else if (mPc[2] === 'planCode') {
        Q.plans[pi].property._appliedCode = null;
      }
    }

    if (k === 'dateMode') {
      // 切換輸入方式：沿用目前天數／結束日
      if (v === 'days' && TQ.num(Q.days) >= 1 && TQ.num(Q.days) <= 180) Q.tripDays = Number(Q.days);
      var td = form.querySelector('[data-k="tripDays"]'); if (td) td.value = Q.tripDays == null ? '' : Q.tripDays;
    }
    if (k === 'startDate' || k === 'endDate' || k === 'startTime' || k === 'tripDays' || k === 'dateMode' || k === 'daysOverride') {
      keptLinkDays = false; // 已開始填日期 → 天數一律依日期
      legacyDays = null;    // 改了日期／時間／天數／覆寫 → 改依新制
      syncDaysFromDates();
    }
    if (k === 'destination' && isDomesticDest()) {
      // 國內地點（台灣／金門／馬祖／澎湖…）：顯示警告，不依此文字自動判斷申根／地區
      schengenManual = false;
      updateDomesticWarning();
    } else if (k === 'destination') {
      // 目的地變更 → 重新依地名自動申根（取消先前手動覆寫）
      schengenManual = false;
      syncSchengenFromDestination();
      // 人壽 OH1 地區比例：一律依目的地重判（申根模式若仍 100% 會在 applySchengenMode 抬到 200%）
      var g = TQ.guessRegionPct(Q.destination);
      if (Q.schengen && Number(g) === 100) g = 200;
      if (g !== Q.lifeRegionPct) { Q.lifeRegionPct = g; form.querySelector('[data-k="lifeRegionPct"]').value = g; }
      else {
        var lpEl = form.querySelector('[data-k="lifeRegionPct"]');
        if (lpEl) lpEl.value = Q.lifeRegionPct;
      }
      // 人壽地區：若已（自動）申根，applySchengenMode 已設 other；否則依目的地猜
      if (!Q.schengen) {
        if (window.LIFE_RATES) {
          var lr = LIFE_RATES.guessLifeRegion(Q.destination);
          Q.lifeRegion = lr;
          var sel = form.querySelector('[data-k="lifeRegion"]');
          if (sel) sel.value = lr;
        }
      } else {
        var sel2 = form.querySelector('[data-k="lifeRegion"]');
        if (sel2) sel2.value = Q.lifeRegion;
      }
    }
  }

  function refreshDerived() {
    // 起訖日時 → 天數（每滿 24 小時一天）；必須在保費查表前更新
    var dsNow = syncDaysFromDates();
    updateDaysDisplay(dsNow);
    syncPlanNames();
    var needRebuild = applyAutoPremiums();
    var recoBefore = Q.plans.map(function (p) { return !!p.recommended; }).join();
    applyAutoReco();
    if (recoBefore !== Q.plans.map(function (p) { return !!p.recommended; }).join()) {
      Q.plans.forEach(function (p, i) { var tab = planTabs.children[i]; if (tab) tab.classList.toggle('reco', !!p.recommended); });
      Array.prototype.forEach.call(planForms.querySelectorAll('[data-plan]'), function (sec, i) {
        var h2 = sec.querySelector('h2'), bd = h2 && h2.querySelector('.reco-badge');
        if (Q.plans[i].recommended && h2 && !bd) h2.insertAdjacentHTML('beforeend', ' <span class="reco-badge" style="font-size:13px">推薦</span>');
        if (!Q.plans[i].recommended && bd) bd.remove();
      });
    }
    syncRecoSelect();
    if (needRebuild && !rebuildingUI) {
      // 保障項目列數變了，重建表單一次（_appliedCode 已寫入，不會迴圈）
      buildPlanUI();
      return;
    }
    // 把自動結果寫回 input 顯示
    Q.plans.forEach(function (p, i) {
      var sec = planForms.querySelector('[data-plan="' + i + '"]');
      if (!sec) return;
      var lifeInp = sec.querySelector('[data-k="plans.' + i + '.life.premium"]');
      var propInp = sec.querySelector('[data-k="plans.' + i + '.property.premium"]');
      if (lifeInp && !skipAutoOnce.life[i]) lifeInp.value = (p.life.premium === null || p.life.premium === undefined) ? '' : p.life.premium;
      if (propInp && !skipAutoOnce.prop[i]) propInp.value = (p.property.premium === null || p.property.premium === undefined) ? '' : p.property.premium;
      ['deathWan', 'planCode', 'label', 'hospitalWan', 'accidentMedicalWan'].forEach(function (fk) {
        var el = sec.querySelector('[data-k="plans.' + i + '.property.' + fk + '"]');
        if (el && p.property[fk] !== null && p.property[fk] !== undefined) el.value = p.property[fk];
      });
      var sel = sec.querySelector('[data-preset="' + i + '"]');
      if (sel && p.property.planCode) sel.value = p.property.planCode;
      var lt = sec.querySelector('[data-life-prem-tip="' + i + '"]');
      var pt = sec.querySelector('[data-prop-prem-tip="' + i + '"]');
      if (lt) { lt.textContent = p.life._premTip || ''; lt.className = 'hint' + (p.life._premAuto ? ' auto' : ''); }
      if (pt) { pt.textContent = p.property._premTip || ''; pt.className = 'hint' + (p.property._premAuto ? ' auto' : ''); }

      var c = TQ.computePlan(p, Q);
      function ph(key, val) {
        var el = sec.querySelector('[data-k="plans.' + i + '.' + key + '"]');
        if (el) el.placeholder = '自動：' + TQ.comma(val);
      }
      var defOM = TQ.defaultOh1MrWan(p.life, Q);
      ph('life.oh1Wan', c.life.enabled ? c.life.oh1 / 10000 : defOM);
      ph('life.mrWan', c.life.enabled ? c.life.mr / 10000 : defOM);
      var pct = TQ.num(Q.lifeRegionPct || 100) / 100, oh1 = (TQ.isSet(p.life.oh1Wan) ? TQ.num(p.life.oh1Wan) : defOM) * 10000;
      ph('life.hospitalYuan', oh1 * pct); ph('life.outpatientYuan', oh1 * 0.03 * pct); ph('life.erYuan', oh1 * 0.06 * pct);
      ph('property.outpatientYuan', c.prop.outpatient); ph('property.erYuan', c.prop.er);
      sec.querySelector('.life-box').classList.toggle('off', !p.life.enabled);
      var pbx = sec.querySelector('.prop-box'); if (pbx) pbx.classList.toggle('off', !propOn(p));
      var lifeBadge = !p.life.enabled ? '—' : (p.life._premAuto ? '🟢自動' : '✏️');
      var propBadge = !propOn(p) ? '—' : (p.property._premAuto ? '🟢自動' : '✏️');
      sec.querySelector('[data-sum="' + i + '"]').innerHTML =
        '<span>意外身故失能 <b>' + TQ.fmtYuan(c.death) + '</b></span>' +
        (c.life.transportExtra ? '<span>交通意外身故 <b>' + TQ.fmtYuan(c.transportDeath) + '</b></span>' : '') +
        '<span>住院 <b>' + TQ.fmtYuan(c.hospital) + '</b></span>' +
        '<span>門診 <b>' + TQ.fmtYuan(c.outpatient) + '</b></span>' +
        '<span>急診 <b>' + TQ.fmtYuan(c.er) + '</b></span>' +
        '<span>意外醫療 <b>' + TQ.fmtYuan(c.accidentMedical) + '</b></span>' +
        '<span>保費 ' + lifeBadge + '壽<b>' + (!c.life.enabled ? '—' : c.lifePremiumMissing ? '需試算' : TQ.comma(c.life.premium)) + '</b>＋' + propBadge + '產<b>' + (!c.prop.enabled ? '—' : c.propPremiumMissing ? '需試算' : TQ.comma(c.prop.premium)) + '</b>＝' + ((c.lifePremiumMissing || c.propPremiumMissing) ? '<b>待試算</b>' : '<b>' + TQ.comma(c.premium) + '</b>元') + '</span>';
    });
    var ri = TQ.regionInfo(Q.destination);
    document.getElementById('regionHint').textContent = isDomesticDest()
      ? '目的地為台灣國內地點，暫不自動判斷地區；請改填出國目的地'
      : (ri.ambiguous.length ? '⚠ 「' + ri.ambiguous.join('、') + '」DM 未明列，預設 100%，請確認。' : '') +
        (ri.multi ? '多地區行程：限額依就醫地區適用，報價以最高 350% 顯示；' : '') +
        'DM 註3：美國、加拿大 350%／日本、歐洲、紐澳、南韓 200%／其他 100%（住院・門診・急診）；依目的地自動判斷，可手動調整';
  }

  function checks() {
    var out = [];
    function add(cls, msg) { out.push('<li class="' + cls + '">' + esc(msg) + '</li>'); }
    if (window.AgentProfile) AgentProfile.problems(Q.agent).forEach(function (pr) { add(pr.level, pr.msg); });
    if (Q.sample) add('err', '目前標示為「範例資料」— 傳給客戶前請取消勾選並確認所有金額。');
    if (!Q.destination) add('warn', '尚未填寫目的地。');
    quoteBlockers().forEach(function (m) { add('err', m + '（目前無法下載三方案總表圖）'); });
    var aiC = TQ.ageInfo(Q.age);
    if (aiC.valid && aiC.child) add('ok', '未滿15足歲：人壽為兒童傷害醫療旅平險 MRC 60萬＋OH1＋OAA（無 AT1／MR）；產險為兒童方案。');
    var dsC = dateState();
    if (dsC.legacy) add('warn', '此報價為舊版連結／草稿：沿用原報價 ' + dsC.days + ' 天；依新制（自出發時間起算、結束時間＝出發時間）應為 ' + dsC.newDays + ' 天。修改日期／時間／天數即重新計算。');
    else if (dsC.days && !dsC.kept && dsC.noTime) add('warn', '尚未填出發時間：請填班機實際起飛時間（保險期間自出發時間起算，結束時間同出發時間）。');
    else if (dsC.days && !dsC.kept && !dsC.override) add('ok', '保險期間共 ' + dsC.days + ' 天（' + periodShort() + '；自出發時間起算，每 24 小時一天）。');
    if (dsC.days > 180 && Q.plans.some(function (p) { return p.life && p.life.enabled; })) add('err', '共 ' + dsC.days + ' 天：Go安行國外旅遊最高投保天數為 180 天（DM 第2頁）。');
    var riC = TQ.regionInfo(Q.destination);
    if (riC.ambiguous.length) add('warn', '目的地含「' + riC.ambiguous.join('、') + '」：DM 未明列是否屬「美國、加拿大」或「歐洲」，人壽 OH1 地區限額預設 100%；如確認適用請到「行程進階」手動調整。');
    if (dsC.days > 30) add('warn', '共 ' + dsC.days + ' 天：人壽亞洲14國可自動算到 180 天；產險費率僅 2～20、25、30 天（部分保額）、未滿15歲人壽僅 1～30 天，其餘請以 GPTA／產險試算後手填。');
    Q.plans.forEach(function (p) {
      var n = p.name || '';
      if (p.life && p.life.enabled) {
        if (!TQ.num(p.life.at1Wan)) add('err', n + '：人壽 AT1 未填。');
        if (!TQ.isSet(p.life.premium)) add('err', n + '：人壽保費需另行試算、尚未填入（' + (p.life._premTip || '請以 GPTA 試算') + '）；未填前客戶頁／比較表／總表圖顯示「需另行試算」。');
        else if (!p.life._premAuto) add('warn', n + '：人壽保費為手填／缺表。');
        else add('ok', n + '：人壽保費已自動帶入。');
      }
      if (!propOn(p)) return;
      if (!TQ.isSet(p.property.premium)) add('err', n + '：產險保費需另行試算、尚未填入（' + (p.property._premTip || '查無費率') + '）；未填前客戶頁／比較表／總表圖顯示「需另行試算」。');
      else if (!p.property._premAuto) add('warn', n + '：產險保費非 DM 自動（' + (p.property._premTip || '手填') + '）。');
      else add('ok', n + '：產險保費已自動帶入（DM）。');
      if (!TQ.num(p.property.deathWan)) add('warn', n + '：產險意外身故失能未填。');
      if (!p.inconvenience.length) add('warn', n + '：沒有任何不便險項目。');
      p.inconvenience.concat(p.others).forEach(function (it) {
        if (!it.amount) add('warn', n + '：「' + (it.name || '未命名') + '」保額空白。');
      });
    });
    if (!out.some(function (x) { return x.indexOf('class="err"') >= 0; }) && !out.some(function (x) { return x.indexOf('class="warn"') >= 0; })) {
      /* keep ok lines */
    }
    document.getElementById('checks').innerHTML = '<h2>送出前檢查</h2><ul>' + out.join('') + '</ul>';
  }

  function scrubForSave(q) {
    var c = clone(q);
    c._draftVersion = DRAFT_VERSION;
    (c.plans || []).forEach(function (p) {
      if (p.life) { delete p.life._premTip; delete p.life._premAuto; }
      if (p.property) {
        delete p.property._premTip; delete p.property._premAuto;
        delete p.property._covAuto; delete p.property._appliedCode;
      }
    });
    return c;
  }

  var saveTimer;
  function update() {
    Q.agent = agentForQuote();
    updateDomesticWarning();
    refreshDerived();
    TQ.renderQuote(scrubForSave(Q), preview);
    checks();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        var payload = JSON.stringify(scrubForSave(Q));
        localStorage.setItem(STORE_KEY, payload);
        localStorage.removeItem(STORE_KEY_LEGACY);
      } catch (e) {}
    }, 300);
  }

  function load(q) {
    Q = normalize(clone(q));
    // 舊連結／草稿：有天數但無出發回程日 → 沿用其天數
    keptLinkDays = !!(q && TQ.num(q.days) > 0 && !TQ.parseDateParts(q.startDate) && !TQ.parseDateParts(q.endDate));
    // fr6 以前（無 dayRule）且有天數 → 沿用原天數（舊版算頭算尾），不默默改價；與 24 小時制結果相同時自然改用新制
    legacyDays = (q && q.dayRule !== TQ.DAY_RULE && TQ.num(q.days) > 0 && Math.floor(TQ.num(q.days)) === TQ.num(q.days)) ? Number(q.days) : null;
    // 輸入方式：fr7 連結沿用；舊連結有回程日 → 填回程日期，否則填天數（新報價預設填天數）
    if (Q.dateMode !== 'days' && Q.dateMode !== 'range') Q.dateMode = (q && q.dayRule !== TQ.DAY_RULE && TQ.parseDateParts(Q.endDate)) ? 'range' : 'days';
    if ((Q.tripDays == null || Q.tripDays === '') && TQ.num(Q.days) >= 1 && TQ.num(Q.days) <= 180) Q.tripDays = Number(Q.days);
    activePlan = 0;
    skipAutoOnce = { life: {}, prop: {} };
    schengenManual = false;
    Array.prototype.forEach.call(form.querySelectorAll('.ed-card:not(.plan-form)'), function (c) { fillInputs(c); });
    // 載入時若 JSON 未顯式設 schengen，依目的地補一次；已顯式 true/false 則尊重資料
    if (q && typeof q.schengen === 'boolean') {
      setSchengenHint(false);
    } else {
      syncSchengenFromDestination();
    }
    buildPlanUI();
    update();
  }

  /* ---------- 事件 ---------- */
  form.addEventListener('input', function (e) {
    // SELECT 改由 change 處理，避免 input+change 雙觸發重建
    if (e.target.tagName === 'SELECT') return;
    if (e.target.hasAttribute('data-k')) {
      readInput(e.target);
      if (e.target.getAttribute('data-k') === 'destination' || e.target.getAttribute('data-k') === 'age') {
        // syncSchengenFromDestination 可能已改模式／年齡改變可選保額 → 重建方案表單
        buildPlanUI();
        update();
        return;
      }
      update();
    }
  });
  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-preset')) {
      var code = t.value; if (!code) return;
      var p = PRESETS.filter(function (x) { return x.code === code; })[0];
      var i = Number(t.getAttribute('data-preset'));
      var plan = Q.plans[i];
      plan.property.planCode = p.code;
      plan.property.label = p.label;
      if (!p.child) plan.property.deathWan = p.deathWan; // 兒童方案無身故：保留成人保額
      plan.property.hospitalWan = p.hospitalWan;
      plan.property.outpatientYuan = null;
      plan.property.erYuan = null;
      plan.property.accidentMedicalWan = p.accidentMedicalWan;
      plan.inconvenience = clone(p.inconvenience);
      plan.others = clone(p.others);
      plan.property._appliedCode = p.code;
      plan.property._covAuto = true;
      delete skipAutoOnce.prop[i];
      buildPlanUI(); update();
      var pr = TQ.lookupPropertyPremium(plan.property, Q.days, Q);
      toast(pr.found ? ('已帶入 ' + p.label + '，' + Q.days + ' 天保費 ' + TQ.comma(pr.premium) + ' 元') : (pr.tip || '已帶入保障'));
      return;
    }
    if (t.hasAttribute('data-k') && (t.type === 'checkbox' || t.tagName === 'SELECT')) {
      readInput(t);
      if (t.getAttribute('data-k') === 'schengen') { buildPlanUI(); return; }
      if (/^plans\.\d+\.(kind|(life|property)\.enabled|life\.combo|life\.at1Wan|property\.medPlus)$/.test(t.getAttribute('data-k'))) { buildPlanUI(); update(); return; }
      update();
    }
  });
  form.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.getAttribute('data-act') === 'autoname') {
      var pa = Q.plans[Number(b.getAttribute('data-i'))];
      pa.nameCustom = false; pa.taglineCustom = false;
      syncPlanNames(); update(); toast('已改回依類型自動命名：' + pa.name);
      return;
    }
    var i = Number(b.getAttribute('data-i')), kind = b.getAttribute('data-kind'), j = Number(b.getAttribute('data-j'));
    var arr = Q.plans[i][kind], act = b.getAttribute('data-act');
    if (act === 'add') arr.push({ name: '', amount: '' });
    if (act === 'del') arr.splice(j, 1);
    if (act === 'up' && j > 0) arr.splice(j - 1, 0, arr.splice(j, 1)[0]);
    if (act === 'down' && j < arr.length - 1) arr.splice(j + 1, 0, arr.splice(j, 1)[0]);
    buildPlanUI(); update();
    if (act === 'add') {
      var rows = planForms.querySelectorAll('[data-plan="' + i + '"] [data-k^="plans.' + i + '.' + kind + '."][data-k$=".name"]');
      if (rows.length) rows[rows.length - 1].focus();
    }
  });
  planTabs.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]'); if (!b) return;
    activePlan = Number(b.getAttribute('data-tab'));
    Array.prototype.forEach.call(planTabs.children, function (x, k) { x.classList.toggle('on', k === activePlan); });
    Array.prototype.forEach.call(planForms.children, function (x, k) { x.hidden = k !== activePlan; });
    var card = preview.querySelector('#plan-' + (activePlan + 1));
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.querySelectorAll('.pv-toggle button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.pv-toggle button').forEach(function (x) { x.classList.toggle('on', x === b); });
      document.getElementById('pvFrame').classList.toggle('full', b.getAttribute('data-w') === 'full');
    });
  });


  /** 送出（下載圖／複製連結）時提醒：業務員資料未填 */
  function agentReminder() {
    var m = window.AgentProfile ? AgentProfile.missing(Q.agent) : [];
    var smp = window.AgentProfile && AgentProfile.isSample(Q.agent);
    if (!m.length && !smp) return '';
    var card = document.getElementById('agentCard');
    if (card) { card.classList.add('flash'); setTimeout(function () { card.classList.remove('flash'); }, 1600); }
    return smp ? '⚠ 業務員資料仍是範例（' + AgentProfile.SAMPLE.name + '）' : '⚠ 尚未填寫業務員' + m.join('、') + '，客戶只會看到「富邦人壽 南方通訊處」';
  }
  document.getElementById('btnSummaryPng').addEventListener('click', function () {
    if (blockIfDomestic()) return;
    var btn = document.getElementById('btnSummaryPng');
    btn.disabled = true; btn.textContent = '產生中…';
    var clean = scrubForSave(Q);
    var remind = agentReminder();
    TQ_SUMMARY.downloadSummaryPng(clean).then(function (name) {
      toast(remind ? remind + '（已下載 ' + name + '）' : '已下載 ' + name);
    }).catch(function (err) {
      alert('產生總表圖失敗：' + (err && err.message ? err.message : err));
    }).finally(function () {
      btn.disabled = false; btn.textContent = '🖼 下載三方案總表圖';
    });
  });

  /* ---------- 客戶頁連結（資料全在網址 #q=，不經伺服器） ---------- */
  function clientUrl() { return TQ.shareUrl(scrubForSave(Q), 'index.html'); }
  function copyText(txt) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); } catch (e) { reject(e); }
      ta.remove();
    });
  }
  var btnLink = document.getElementById('btnCopyLink');
  if (btnLink) btnLink.addEventListener('click', function () {
    if (blockIfDomestic()) return;
    var url = clientUrl();
    var remind = agentReminder();
    copyText(url).then(function () {
      toast(remind ? remind + '（連結已複製）' : /^file:/.test(location.href) ? '已複製（本機檔案連結僅供自己預覽；上線後的連結才能傳給客戶）' : '已複製客戶頁連結，可貼到 LINE');
    }).catch(function () { prompt('請複製以下連結：', url); });
  });
  var btnOpen = document.getElementById('btnOpenClient');
  if (btnOpen) btnOpen.addEventListener('click', function () {
    if (blockIfDomestic()) return;
    var remind = agentReminder(); if (remind) toast(remind);
    window.open(clientUrl(), '_blank');
  });

  document.getElementById('btnSample').addEventListener('click', function () {
    if (confirm('載入範例資料會覆蓋目前內容，確定？')) { load(window.SAMPLE_QUOTE); toast('已載入範例（已標示為範例）'); }
  });
  document.getElementById('btnClear').addEventListener('click', function () {
    if (!confirm('清空所有金額與保費（保留方案名稱與項目名稱），並取消「範例」標示？')) return;
    Q.sample = false; delete Q._sampleSource;
    Q.plans.forEach(function (p) {
      ['at1Wan', 'oh1Wan', 'mrWan', 'hospitalYuan', 'outpatientYuan', 'erYuan', 'premium'].forEach(function (k) { p.life[k] = null; });
      ['deathWan', 'hospitalWan', 'outpatientYuan', 'erYuan', 'accidentMedicalWan', 'premium'].forEach(function (k) { p.property[k] = null; });
      p.property.planCode = ''; p.property._appliedCode = null;
      p.property.label = '';
      p.inconvenience.concat(p.others).forEach(function (it) { it.amount = ''; });
    });
    load(Q); toast('已清空金額');
  });

  /* ---------- 快速套用／推薦方案 ---------- */
  var btnQuick = document.getElementById('btnQuickApply');
  if (btnQuick) btnQuick.addEventListener('click', function () {
    applyQuickPreset(document.getElementById('quickKind').value);
  });
  var recoSel = document.getElementById('recoSel');
  if (recoSel) recoSel.addEventListener('change', function () {
    var v = recoSel.value;
    if (v === 'multi') return;
    if (v === 'auto') { Q.recoMode = 'auto'; applyAutoReco(); buildPlanUI(); update(); return; }
    Q.recoMode = 'manual';
    Q.plans.forEach(function (p, i) { p.recommended = v !== '' && String(i) === v; });
    buildPlanUI(); update();
  });
  window.TQ_EDITOR = { applyQuickPreset: applyQuickPreset, setPlanKind: function (i, k) { setPlanKind(i, k); buildPlanUI(); update(); }, getQuote: function () { return scrubForSave(Q); } };

  /* ---------- 業務員資料（頁首區塊；與意外險工具共用） ---------- */
  if (window.AgentProfile) AgentProfile.bind({
    name: document.getElementById('agentName'), title: document.getElementById('agentTitle'), phone: document.getElementById('agentPhone'),
    list: document.getElementById('agentTitleList'), sample: document.getElementById('agentSample'),
    status: document.getElementById('agentStatus'), card: document.getElementById('agentCard'),
    onChange: function () { if (Q) update(); }
  });

  /* ---------- 初始化 ---------- */
  var regionSel = form.querySelector('[data-k="lifeRegionPct"]');
  regionSel.innerHTML = TQ.REGION_OPTIONS.map(function (o) { return '<option value="' + o.pct + '">' + esc(o.label) + '</option>'; }).join('');

  var initial = null;
  try { initial = TQ.decodeHash(location.hash); } catch (e) { alert('網址中的報價資料無法解析：' + e.message); }
  if (!initial) initial = readStoredDraft();
  load(initial || window.SAMPLE_QUOTE);
})();
