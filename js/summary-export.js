/* 三方案總表報價圖：在編輯器產生可下載 PNG（適合 LINE） */
(function (global) {
  'use strict';

  function buildSummaryHtml(quote) {
    quote = TQ.resolvePlanNames(quote);
    var mode = quote.dateFormat === 'ad' ? 'ad' : 'roc';
    var dates = TQ.periodHtml(quote, 'sum-dates');
    var a = TQ.agentOf(quote), ap = TQ.agentParts(a);
    var dest = quote.destination || '—';
    var h = '';
    h += '<div class="sum-root" id="summaryCapture">';
    if (quote.sample) h += '<div class="sum-sample">⚠ 範例資料・非正式報價</div>';
    // 頁首（同 DM：標籤＋大標＋規劃人＋行程膠囊）
    h += '<header class="sum-hero">';
    h += '<div class="sum-tags"><span class="sum-tag-pill">' + TQ.esc(TQ.heroTagText(quote)) + '</span>' + TQ.heroBadgesHtml(quote, 'sum-hbadge') + '</div>';
    h += '<div class="sum-title">' + TQ.esc(dest) + '<span class="ttl">旅遊保障方案</span></div>';
    h += '<div class="sum-sub">旅平險組合方案試算　<b>' + TQ.esc(ap.line) + '</b> 為您規劃</div>';
    h += '<div class="sum-trip"><span>✈ ' + TQ.esc(dest) + '</span>' + dates +
      '<span>共 <b>' + TQ.esc(quote.days || '—') + '</b> 天</span></div>';
    h += '</header>';
    // 方案卡（同 DM：色塊標頭＋徽章＋大字保費＋重點保障）
    h += '<div class="sum-plans">';
    (quote.plans || []).forEach(function (plan, idx) {
      var c = TQ.computePlan(plan, quote);
      var L = c.life, P = c.prop, on = L.enabled, pon = P.enabled;
      var nm = TQ.splitPlanName(plan.name, idx);
      h += '<section class="sum-card pc' + (idx % 3 + 1) + (plan.recommended ? ' reco' : '') + '">';
      h += '<div class="sum-card-h"><div class="no">' + TQ.esc(nm.no) + (plan.recommended ? '<span class="sum-badge">推薦</span>' : '') + '</div>' +
        (nm.nm ? '<div class="nm">' + TQ.esc(nm.nm) + '</div>' : '') + '</div>';
      if (plan.tagline) h += '<span class="sum-tag">' + (plan.recommended ? '♛ ' : '') + TQ.esc(plan.tagline) + '</span>';
      h += TQ.priceHtml(c, 'sum-price');
      h += '<div class="sum-kp">';
      function kp(label, val, cls) { return '<div' + (cls ? ' class="' + cls + '"' : '') + '><span>' + TQ.esc(label) + '</span><b>' + TQ.esc(val) + '</b></div>'; }
      if (c.child) {
        h += kp(on ? '兒童傷害醫療 MRC' : '意外身故・失能', on ? TQ.fmtYuan(L.mrc) : '—', on ? '' : 'no-t');
      } else {
        h += kp('意外身故・失能', TQ.fmtYuan(c.death));
        var tr = TQ.transportLine(c);
        if (tr) h += kp('交通意外身故', tr.total, 'tr');
      }
      h += kp('海外突發 住院', TQ.fmtYuan(c.hospital));
      h += kp('意外醫療', TQ.fmtYuan(c.accidentMedical));
      h += pon ? kp('旅遊不便險', '✓ 含', 'yes') : kp('旅遊不便險', '不含', 'no-t');
      h += '</div>';
      if (on && L.regionPct !== 100) {
        h += '<div class="sum-region">🌏 人壽「' + TQ.esc(TQ.regionLabel(L.regionPct)) + '」地區醫療限額 ' + L.regionPct + '%（OH1 ' + TQ.esc(TQ.fmtShort(L.oh1)) + ' × ' + L.regionPct + '%）</div>';
      }
      h += '</section>';
    });
    h += '</div>';
    // 說明條（同 DM 勾勾說明）
    var anyLife = (quote.plans || []).some(function (p) { return p.life && p.life.enabled; });
    var tips = [];
    if (anyLife && (quote.plans || []).some(function (p) { return p.life && p.life.enabled && !TQ.isChildQuote(quote) && TQ.num(p.life.at1Wan) > 0; })) {
      tips.push('人壽 Go安行：搭乘<b>大眾運輸工具、騎乘自行車、駕駛或乘坐汽車</b>意外身故，另加給<b>一倍</b>保額。');
    }
    if (quote.schengen) tips.push('申根行程：產險適用<b>計畫二（申根適用）</b>，可提供<b>英文投保證明</b>。');
    tips.forEach(function (t) { h += '<div class="sum-note"><i>✓</i><div>' + t + '</div></div>'; });
    // 主要保障比較（DM 表格樣式）
    h += '<section class="sum-cmp"><div class="sum-sec-title">主要保障比較<small>— 表示不含此項保障</small></div>' +
      TQ.compareTableHtml(quote, { inconv: 6 }) + '</section>';
    // 簽名（同 DM：深藍漸層＋金邊＋圓形 logo＋電話膠囊）
    h += '<footer class="sum-foot">';
    h += '<div class="sum-foot-row"><img class="sum-foot-logo" src="' + TQ.BRAND.logo + '" alt="" width="84" height="84">';
    h += '<div class="who"><div class="u">您的專屬保險顧問</div><div class="n">' + TQ.esc(ap.line) + '</div><div class="o">' + TQ.esc(ap.org) + '</div></div>';
    if (a.phone) h += '<div class="ph">☎ ' + TQ.esc(a.phone) + '</div>';
    h += '</div>';
    h += '<div class="note">' + TQ.esc(TQ.disclaimerText(quote)) + '</div>';
    h += '</footer></div>';
    return h;
  }

  function ensureHost() {
    var host = document.getElementById('summaryExportHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'summaryExportHost';
      host.setAttribute('aria-hidden', 'true');
      document.body.appendChild(host);
    }
    return host;
  }

  function downloadSummaryPng(quote) {
    if (!global.html2canvas) {
      alert('缺少 html2canvas，無法產生圖片');
      return Promise.reject(new Error('no html2canvas'));
    }
    var host = ensureHost();
    host.innerHTML = buildSummaryHtml(quote);
    var el = host.querySelector('#summaryCapture');
    // 等 logo（及所有圖片）載入完成再截圖，避免第一次下載 logo 空白
    var imgs = Array.prototype.slice.call(el.querySelectorAll('img'));
    var ready = Promise.all([TQ.brandLogoReady ? TQ.brandLogoReady() : Promise.resolve()].concat(imgs.map(function (img) {
      if (img.complete && img.naturalWidth) return img.decode ? img.decode().catch(function () {}) : Promise.resolve();
      return new Promise(function (res) { img.onload = img.onerror = function () { res(); }; });
    })));
    return ready.then(function () { return global.html2canvas(el, {
      scale: 2,
      backgroundColor: '#eef6f7',
      useCORS: true,
      logging: false,
      width: el.scrollWidth,
      height: el.scrollHeight
    }); }).then(function (canvas) {
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          var name = (quote.sample ? '範例_' : '') + (quote.destination || '旅平險') +
            (quote.days || '') + '天_三方案總表.png';
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
          host.innerHTML = '';
          resolve(name);
        }, 'image/png');
      });
    }).catch(function (err) {
      host.innerHTML = '';
      throw err;
    });
  }

  global.TQ_SUMMARY = { downloadSummaryPng: downloadSummaryPng, buildSummaryHtml: buildSummaryHtml };
})(window);
