/* 旅平險三方案報價 — 共用函式（計算、格式化、分享連結編解碼、方案卡片渲染）
 * 純前端、無需建置。index.html 與 editor.html 共用。
 */
(function (global) {
  'use strict';

  /* ---------- 品牌（客戶頁頁首、總表圖）：南方通訊處 logo＋兩行標題；不含「內部使用」標記 ---------- */
  var ASSET_V = (function () {
    try { var m = /[?&]v=([^&#]+)/.exec((document.currentScript && document.currentScript.src) || ''); return m ? m[1] : ''; } catch (e) { return ''; }
  })();
  var BRAND = {
    slogan: '富邦人壽 南方通訊處',
    title: '旅平險組合方案試算報價系統',
    logo: 'img/logo.png' + (ASSET_V ? '?v=' + ASSET_V : ''),
    logoAlt: '富邦人壽 南方通訊處'
  };
  // 預先載入 logo（總表圖下載時不會出現空白 logo）
  var brandLogoReady = (typeof Image === 'undefined') ? Promise.resolve() : new Promise(function (resolve) {
    var im = new Image();
    im.onload = im.onerror = function () { resolve(); };
    im.src = BRAND.logo;
  });
  function renderBrand(prefix) {
    prefix = prefix || 'brand';
    return '<div class="' + prefix + '-bar"><img class="' + prefix + '-logo" src="' + BRAND.logo + '" alt="' + BRAND.logoAlt + '" width="48" height="48">' +
      '<div class="' + prefix + '-text"><div class="' + prefix + '-slogan">' + BRAND.slogan + '</div>' +
      '<div class="' + prefix + '-title">' + BRAND.title + '</div></div></div>';
  }

  // 簽名：品牌固定「富邦人壽 南方通訊處」；姓名／職級／電話由業務員在編輯器「業務員資料」填寫（隨分享連結帶給客戶）
  // 沒有業務員資料的舊連結 → 只顯示「富邦人壽 南方通訊處」，不帶任何人名／電話
  var DEFAULT_AGENT = { unit: '南方通訊處', name: '', title: '', phone: '' };
  function agentStr(v, max) { return (v === undefined || v === null) ? '' : String(v).replace(/[\u0000-\u001f]/g, '').trim().slice(0, max); }
  function agentOf(quote) {
    var a = (quote && quote.agent && typeof quote.agent === 'object') ? quote.agent : {};
    return { unit: DEFAULT_AGENT.unit, name: agentStr(a.name, 20), title: agentStr(a.title, 20), phone: agentStr(a.phone, 24) };
  }
  function telHref(phone) { return 'tel:' + String(phone || '').replace(/[^\d+]/g, ''); }

  var LIFE_PRODUCT = '富邦人壽 Go安行旅平險';
  var PROPERTY_PRODUCT = '富邦產險 新快樂旅綜+';
  // 人壽 OH1 各項比例（Go安行 DM）：住院 100%、門診每日 3%、急診每日 6%（再乘以地區調整比例）
  var LIFE_OH1_RATIO = { hospital: 1, outpatient: 0.03, er: 0.06 };
  // 產險 新快樂旅綜+：門診 = 住院保額 2%、急診 = 5%
  var PROP_RATIO = { outpatient: 0.02, er: 0.05 };
  var REGION_OPTIONS = [
    { pct: 100, label: '其他地區（100%）' },
    { pct: 200, label: '日本、歐洲、紐澳、南韓（200%）' },
    { pct: 350, label: '美國、加拿大（350%）' }
  ];

  /** 中文地名先排除易誤判的外國同字詞（例：「突尼斯」含「尼斯」） */
  var KW_EXCLUDE_ZH = ['突尼斯', '突尼西亞', '突尼西亚'];
  function kwPrep(dest) {
    var t = String(dest || '').trim();
    for (var e = 0; e < KW_EXCLUDE_ZH.length; e++) t = t.split(KW_EXCLUDE_ZH[e]).join(' ');
    return { t: t, low: t.toLowerCase() };
  }
  /** 單一關鍵字：英文用單字邊界（避免 uk 誤中 Phuket、america 誤中 South America），中文用子字串 */
  function kwHit(pp, k) {
    if (!k) return false;
    k = String(k).trim();
    if (/[a-z]/i.test(k)) {
      var esc = k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|[^a-z\u00c0-\u024f])' + esc + '($|[^a-z\u00c0-\u024f])').test(pp.low);
    }
    return pp.t.indexOf(k) >= 0;
  }
  /** 目的地關鍵字比對 */
  function textHasKeyword(dest, list) {
    var pp = kwPrep(dest);
    if (!pp.t) return false;
    for (var i = 0; i < list.length; i++) if (kwHit(pp, list[i])) return true;
    return false;
  }
  function keywordHits(dest, list) {
    var pp = kwPrep(dest), out = [];
    if (!pp.t) return out;
    for (var i = 0; i < list.length; i++) if (kwHit(pp, list[i]) && out.indexOf(list[i]) < 0) out.push(list[i]);
    return out;
  }

  // Go安行 DM（1150731）第2頁 註3／OH1 條款第十一條＋附表二：「美國、加拿大」350%；「日本、歐洲、紐澳、南韓」200%；其他 100%。
  // 只調整 住院（第五條）、門診（第八條）、急診（第九條）之限額；依「就醫所在地區」適用。
  var REGION_LABEL = { 350: '美國、加拿大', 200: '日本、歐洲、紐澳、南韓', 100: '其他地區' };
  var REGION_350 = [
    '美國', '美国', 'usa', 'u.s.a', 'u.s.', 'united states',
    '加拿大', 'canada', '美加',
    '夏威夷', 'hawaii', '阿拉斯加', 'alaska',
    '黃石', '黄石', 'yellowstone', '大峽谷', '大峡谷', 'grand canyon', '波特蘭', 'portland', '鳳凰城', 'phoenix',
    '亞特蘭大', 'atlanta', '費城', 'philadelphia', '丹佛', 'denver', '鹽湖城', 'salt lake',
    '班夫', 'banff', '洛磯山', 'rockies', '卡加利', 'calgary', '魁北克', 'quebec', '黃刀', '黄刀', 'yellowknife', '尼加拉', 'niagara',
    '紐約', '纽约', 'new york', '洛杉磯', '洛杉矶', 'los angeles',
    '舊金山', '旧金山', 'san francisco', '拉斯維加斯', '拉斯维加斯', 'las vegas',
    '西雅圖', '西雅图', 'seattle', '芝加哥', 'chicago', '波士頓', '波士顿', 'boston',
    '邁阿密', '迈阿密', 'miami', '奧蘭多', '奥兰多', 'orlando',
    '華盛頓', '华盛顿', 'washington dc', 'washington, d.c',
    '聖地牙哥', '圣地亚哥', 'san diego', '休士頓', '休斯顿', 'houston', '達拉斯', 'dallas',
    '溫哥華', '温哥华', 'vancouver', '多倫多', 'toronto', '蒙特婁', '蒙特利尔', 'montreal', 'ottawa', '渥太華', '渥太华'
  ];
  // DM／條款未明列是否屬上述地區（美國屬地、跨歐亞國家、歐洲國家的海外領地）→ 不自動加倍，提醒業務員確認
  var REGION_AMBIG = [
    '關島', '关岛', 'guam', '塞班', 'saipan', '北馬利安納', '北马里亚纳', '波多黎各', 'puerto rico', '美屬薩摩亞',
    '俄羅斯', '俄罗斯', 'russia', '莫斯科', 'moscow', '聖彼得堡', '圣彼得堡',
    '土耳其', 'turkey', 'türkiye', '伊斯坦堡', '伊斯坦布尔', 'istanbul', '卡帕多奇亞', 'cappadocia',
    '喬治亞', '格鲁吉亚', '亞美尼亞', '亚美尼亚', 'armenia', '亞塞拜然', '阿塞拜疆', 'azerbaijan', '哈薩克', '哈萨克', 'kazakhstan',
    '格陵蘭', '格陵兰', 'greenland', '大溪地', 'tahiti', '新喀里多尼亞', 'new caledonia', '加那利', 'canary islands'
  ];
  var REGION_200 = [
    // 泛稱
    '日本', 'japan', '歐洲', '欧洲', 'europe', '歐陸', '申根', 'schengen', '北歐', '北欧', 'nordic', 'scandinavia',
    '紐澳', '大洋洲', 'oceania',
    // 日本城市
    '東京', '东京', 'tokyo', '大阪', 'osaka', '京都', 'kyoto', '北海道', 'hokkaido',
    '沖繩', '冲绳', 'okinawa', '名古屋', 'nagoya', '福岡', '福冈', 'fukuoka',
    '札幌', 'sapporo', '神戶', '神戸', 'kobe', '橫濱', '横滨', 'yokohama', '奈良', 'nara',
    // 南韓
    '韓國', '韩国', '南韓', '南韩', 'korea', '首爾', '首尔', 'seoul', '釜山', 'busan', '濟州', '济州', 'jeju',
    // 紐澳
    '紐西蘭', '新西兰', 'new zealand', '澳洲', '澳大利亞', '澳大利亚', 'australia',
    '奧克蘭', '奥克兰', 'auckland', '基督城', 'christchurch', '惠靈頓', '惠灵顿', 'wellington',
    '雪梨', '悉尼', 'sydney', '墨爾本', '墨尔本', 'melbourne', '布里斯本', 'brisbane',
    '柏斯', 'perth', '黃金海岸', 'gold coast', '坎培拉', 'canberra',
    '凱恩斯', '凯恩斯', 'cairns', '塔斯馬尼亞', '塔斯马尼亚', 'tasmania', '阿德雷德', '阿德莱德', 'adelaide', '皇后鎮', '皇后镇', 'queenstown',
    // 日本／南韓 其他熱門地
    '箱根', 'hakone', '輕井澤', '轻井泽', 'karuizawa', '金澤', '金泽', 'kanazawa', '廣島', '广岛', 'hiroshima', '仙台', 'sendai',
    '九州', 'kyushu', '四國', '四国', 'shikoku', '長崎', '长崎', 'nagasaki', '熊本', 'kumamoto', '鹿兒島', '鹿儿岛', 'kagoshima',
    '函館', '函馆', 'hakodate', '小樽', 'otaru', '富士山', 'mt fuji', '石垣', 'ishigaki', '宮古島', '宫古岛', 'takayama', '飛驒高山', '飛騨高山',
    '仁川', 'incheon', '大邱', 'daegu', '慶州', '庆州', 'gyeongju', '江原', 'gangwon',
    // 歐洲國家（申根＋非申根英國／愛爾蘭／賽普勒斯 — DM「歐洲」皆 200%）
    '法國', '法国', '法蘭西', 'france',
    '德國', '德国', 'germany', 'deutschland',
    '義大利', '意大利', 'italy', 'italia',
    '西班牙', 'spain', 'espana', 'españa',
    '葡萄牙', 'portugal',
    '荷蘭', '荷兰', 'netherlands', 'holland',
    '比利時', '比利时', 'belgium',
    '盧森堡', '卢森堡', 'luxembourg',
    '瑞士', 'switzerland', 'swiss',
    '奧地利', '奥地利', 'austria',
    '捷克', 'czech',
    '匈牙利', 'hungary',
    '波蘭', '波兰', 'poland',
    '斯洛伐克', 'slovakia',
    '斯洛維尼亞', '斯洛文尼亞', 'slovenia',
    '克羅埃西亞', '克羅地亞', '克罗地亚', 'croatia',
    '希臘', '希腊', 'greece',
    '丹麥', '丹麦', 'denmark',
    '瑞典', 'sweden',
    '挪威', 'norway',
    '芬蘭', '芬兰', 'finland',
    '冰島', '冰岛', 'iceland',
    '愛沙尼亞', '爱沙尼亚', 'estonia',
    '拉脫維亞', '拉脱维亚', 'latvia',
    '立陶宛', 'lithuania',
    '馬爾他', '马耳他', 'malta',
    '列支敦斯登', '列支敦士登', 'liechtenstein',
    '保加利亞', '保加利亚', 'bulgaria',
    '羅馬尼亞', '罗马尼亚', 'romania',
    '安道爾', '安道尔', 'andorra',
    '摩納哥', '摩纳哥', 'monaco',
    '聖馬利諾', '圣马力诺', 'san marino',
    '教廷', '梵蒂岡', '梵蒂冈', 'vatican', 'holy see',
    '英國', '英国', '英格蘭', '英格兰', '蘇格蘭', '苏格兰', '威爾士', '威爾斯',
    'uk', 'u.k.', 'united kingdom', 'england', 'scotland', 'wales', 'britain', 'british',
    '愛爾蘭', '爱尔兰', 'ireland',
    '賽普勒斯', '塞浦路斯', 'cyprus',
    // 歐洲熱門城市
    '巴黎', 'paris', '羅馬', '罗马', 'rome', '米蘭', '米兰', 'milan',
    '威尼斯', 'venice', '佛羅倫斯', '佛罗伦萨', 'florence', 'firenze',
    '巴塞隆納', '巴塞罗那', 'barcelona', '馬德里', '马德里', 'madrid',
    '阿姆斯特丹', 'amsterdam', '布拉格', 'prague',
    '維也納', '维也纳', 'vienna', '慕尼黑', 'munich', 'münchen',
    '柏林', 'berlin', '蘇黎世', '苏黎世', 'zurich', 'zürich',
    '日內瓦', '日内瓦', 'geneva', '布達佩斯', '布达佩斯', 'budapest',
    '里斯本', 'lisbon', '雅典', 'athens',
    '斯德哥爾摩', '斯德哥尔摩', 'stockholm', '奧斯陸', '奥斯陆', 'oslo',
    '赫爾辛基', 'helsinki', '哥本哈根', 'copenhagen',
    '布魯塞爾', '布鲁塞尔', 'brussels', '法蘭克福', '法兰克福', 'frankfurt',
    '漢堡', 'hamburg', '科隆', 'cologne', 'köln', '尼斯', 'nice', '里昂', 'lyon',
    '塞維亞', '塞维利亚', 'seville', '瓦倫西亞', 'valencia', '波爾圖', 'porto',
    '札格雷布', '萨格勒布', 'zagreb', '盧布爾雅那', 'ljubljana',
    '塔林', 'tallinn', '里加', 'riga', '維爾紐斯', 'vilnius',
    '倫敦', '伦敦', 'london', '都柏林', 'dublin', '愛丁堡', '爱丁堡', 'edinburgh',
    '曼徹斯特', '曼彻斯特', 'manchester', '雷克雅維克', '雷克雅未克', 'reykjavik',
    '尼古西亞', '尼科西亞', 'nicosia',
    // 其他歐洲國家（非申根，DM「歐洲」）
    '塞爾維亞', '塞尔维亚', 'serbia', '貝爾格勒', 'belgrade', '波士尼亞', '波斯尼亚', 'bosnia', '蒙特內哥羅', '黑山', 'montenegro',
    '阿爾巴尼亞', '阿尔巴尼亚', 'albania', '北馬其頓', '北马其顿', '馬其頓', 'macedonia', '科索沃', 'kosovo',
    '摩爾多瓦', '摩尔多瓦', 'moldova', '烏克蘭', '乌克兰', 'ukraine', '白俄羅斯', '白俄罗斯', 'belarus'
  ];

  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    var n = Number(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  }
  function isSet(v) { return v !== null && v !== undefined && v !== ''; }
  function comma(n) { return Math.round(n).toLocaleString('en-US'); }

  /** 金額格式：≥10萬且整萬 → 「X萬」，其餘 → 「X,XXX元」 */
  function fmtYuan(y) {
    y = Math.round(num(y));
    if (y >= 100000 && y % 10000 === 0) return comma(y / 10000) + '萬';
    return comma(y) + '元';
  }
  /** 括號內簡式（不帶「元」） */
  function fmtShort(y) {
    y = Math.round(num(y));
    if (y >= 100000 && y % 10000 === 0) return comma(y / 10000) + '萬';
    return comma(y);
  }

  /** 人壽 OH1 住院／門診／急診地區限額比例（DM 註3） */
  function guessRegionPct(dest) {
    if (textHasKeyword(dest, REGION_350)) return 350;
    if (textHasKeyword(dest, REGION_200)) return 200;
    return 100;
  }
  /** 目的地 → 地區係數明細：{pct(最高), has350, has200, multi, ambiguous:[命中的未明列地名]} */
  function regionInfo(dest) {
    var h350 = textHasKeyword(dest, REGION_350), h200 = textHasKeyword(dest, REGION_200);
    var amb = keywordHits(dest, REGION_AMBIG);
    return { pct: h350 ? 350 : (h200 ? 200 : 100), has350: h350, has200: h200, multi: h350 && h200, ambiguous: amb };
  }
  function regionLabel(pct) { return REGION_LABEL[num(pct)] || ''; }

  /* ---------- 年齡（足歲）→ GPTA 年齡帶／人壽 AT1 上限（Go安行 DM：(Q)AT1保險金額與年齡限制） ---------- */
  // 66 歲以上保費與 18～65 相同（原版工具 2026-10-06 GPTA 確認），僅 AT1 上限不同
  var AGE_BANDS = [
    { band: 'under15', min: 0, max: 14, label: '未滿15足歲', at1Max: 0, child: true, lifeRates: 'u15' },
    { band: '15-17', min: 15, max: 17, label: '15足歲～17歲', at1Max: 600, lifeRates: 'adult' },
    { band: '18-65', min: 18, max: 65, label: '18～65歲', at1Max: 2000, lifeRates: 'adult' },
    { band: '66-70', min: 66, max: 70, label: '66～70歲', at1Max: 1000, lifeRates: 'adult' },
    { band: '71-75', min: 71, max: 75, label: '71～75歲', at1Max: 500, lifeRates: 'adult' },
    { band: '76-80', min: 76, max: 80, label: '76～80歲', at1Max: 300, lifeRates: 'adult' },
    { band: '81-100', min: 81, max: 100, label: '81～100歲', at1Max: 100, lifeRates: 'adult' }
  ];
  var CHILD_MRC_WAN = 60;          // 未滿15足歲 國外套裝：(Q)MRC 定額 60萬（兒童主約・傷害醫療每一事故最高）
  var CHILD_OH1_OPTIONS = [60, 120]; // 未滿15足歲 OH1：60萬（國外旅遊適用）或 120萬（醫療加值）
  /** 年齡（足歲）→ {set, valid, age, band, label, at1Max, child, lifeRates, error} */
  function ageInfo(age) {
    if (age === null || age === undefined || String(age).trim() === '') {
      return { set: false, valid: false, error: '請先輸入被保險人年齡（足歲），才能產生報價' };
    }
    var n = Number(age);
    if (!isFinite(n) || n < 0 || Math.floor(n) !== n) {
      return { set: true, valid: false, error: '年齡請輸入 0～100 的整數（足歲）' };
    }
    if (n > 100) return { set: true, valid: false, error: '年齡超過 100 歲，人壽（Go安行最高 100 歲）無法投保，請確認年齡' };
    for (var i = 0; i < AGE_BANDS.length; i++) {
      var b = AGE_BANDS[i];
      if (n >= b.min && n <= b.max) {
        return { set: true, valid: true, age: n, band: b.band, label: b.label, at1Max: b.at1Max, child: !!b.child, lifeRates: b.lifeRates };
      }
    }
    return { set: true, valid: false, error: '年齡無效' };
  }
  /** 是否未滿15足歲（優先看 age；舊稿無 age 時才看 ageBand） */
  function isChildQuote(q) {
    var a = ageInfo(q && q.age);
    if (a.valid) return a.child;
    return !!(q && q.ageBand === 'under15');
  }
  function childOh1Wan(life) {
    return Number(life && life.childOh1Wan) === 120 ? 120 : 60;
  }

  /* ---------- 人壽國外商品組合（DM 第2頁 註1／註2） ----------
   * 國外旅遊適用：(Q)TA-MR、(Q)OH1 保額為 AT1 之 10%
   * 國外旅遊醫療加值：(Q)TA-MR、(Q)OH1 保額為 AT1 之 20%，最高 250萬；但 91～100 歲為 10% */
  var LIFE_COMBOS = {
    basic: { label: '國外旅遊適用', short: 'OH1／MR＝AT1×10%' },
    plus: { label: '國外旅遊醫療加值', short: 'OH1／MR＝AT1×20%（上限250萬）' }
  };
  function lifeCombo(life) { return (life && life.combo === 'plus') ? 'plus' : 'basic'; }
  /** 預設 OH1／MR（萬）：依組合、年齡 */
  function defaultOh1MrWan(life, quote) {
    var at1 = num(life && life.at1Wan);
    if (!(at1 > 0)) return 0;
    if (lifeCombo(life) === 'plus') {
      var a = ageInfo(quote && quote.age);
      if (a.valid && a.age >= 91) return at1 * 0.1;
      return Math.min(at1 * 0.2, 250);
    }
    return at1 * 0.1;
  }

  /** 計算單一方案所有顯示用數值（單位：元） */
  function computePlan(plan, quote) {
    var life = plan.life || {};
    var prop = plan.property || {};
    var region = num(quote.lifeRegionPct || 100) / 100;
    var child = isChildQuote(quote);
    var L = { enabled: !!life.enabled, child: false, mrc: 0 };
    if (L.enabled && child) {
      // 未滿15足歲：無 AT1、無 MR；主約 MRC 60萬（傷害醫療）＋OH1 60/120萬＋OAA
      L.child = true;
      L.at1 = 0; L.mr = 0;
      L.mrc = CHILD_MRC_WAN * 10000;
      L.oh1 = childOh1Wan(life) * 10000;
      L.hospital = isSet(life.hospitalYuan) ? num(life.hospitalYuan) : L.oh1 * LIFE_OH1_RATIO.hospital * region;
      L.outpatient = isSet(life.outpatientYuan) ? num(life.outpatientYuan) : L.oh1 * LIFE_OH1_RATIO.outpatient * region;
      L.er = isSet(life.erYuan) ? num(life.erYuan) : L.oh1 * LIFE_OH1_RATIO.er * region;
      L.oaa = !!life.oaa;
      L.premium = num(life.premium);
    } else if (L.enabled) {
      L.at1 = num(life.at1Wan) * 10000;
      L.combo = lifeCombo(life);
      var defWan = defaultOh1MrWan(life, quote);
      L.oh1 = (isSet(life.oh1Wan) ? num(life.oh1Wan) : defWan) * 10000;
      L.mr = (isSet(life.mrWan) ? num(life.mrWan) : defWan) * 10000;
      L.hospital = isSet(life.hospitalYuan) ? num(life.hospitalYuan) : L.oh1 * LIFE_OH1_RATIO.hospital * region;
      L.outpatient = isSet(life.outpatientYuan) ? num(life.outpatientYuan) : L.oh1 * LIFE_OH1_RATIO.outpatient * region;
      L.er = isSet(life.erYuan) ? num(life.erYuan) : L.oh1 * LIFE_OH1_RATIO.er * region;
      L.oaa = !!life.oaa;
      L.premium = num(life.premium);
    } else {
      L.at1 = L.oh1 = L.mr = L.hospital = L.outpatient = L.er = L.premium = 0; L.oaa = false;
    }
    // 人壽其他保障（DM 第2頁；AT1 條款第六～八條、OH1 條款第六、七、十條）
    L.regionPct = num(quote.lifeRegionPct || 100);
    L.transportExtra = L.enabled && !L.child ? L.at1 : 0;           // 大眾運輸／自行車／汽車：另按保額加給一倍
    L.burnAt1 = L.enabled && !L.child ? L.at1 * 0.2 : 0;             // AT1 重大燒燙傷 20%
    L.burnOh1 = L.enabled ? L.oh1 : 0;                                // OH1 重大燒燙傷 100%（海外，不做地區調整）
    L.returnHosp = L.enabled ? L.oh1 * 0.3 : 0;                       // 返國住院 30%（不做地區調整）
    var P = { enabled: prop.enabled !== false };
    // 產險 DM：「※針對未滿15足歲之被保險人，本保險契約無提供意外死亡之喪葬費用保險金。」兒童方案身故及失能為「-」
    P.death = child ? 0 : num(prop.deathWan) * 10000;
    P.hospital = num(prop.hospitalWan) * 10000;
    P.outpatient = isSet(prop.outpatientYuan) ? num(prop.outpatientYuan) : P.hospital * PROP_RATIO.outpatient;
    P.er = isSet(prop.erYuan) ? num(prop.erYuan) : P.hospital * PROP_RATIO.er;
    P.accidentMedical = num(prop.accidentMedicalWan) * 10000;
    P.premium = num(prop.premium);
    if (!P.enabled) {
      // 純人壽方案：不含產險
      P.death = P.hospital = P.outpatient = P.er = P.accidentMedical = P.premium = 0;
    }
    return {
      life: L, prop: P, child: child,
      lifePremiumMissing: L.enabled && !isSet(life.premium),
      propPremiumMissing: P.enabled && !isSet(prop.premium),
      propTooShort: P.enabled && !isSet(prop.premium) && num(quote.days) === 1, // 富邦產險系統：國外旅遊保險期間至少 2 日
      lifeOverCap: L.enabled && !child && (function () { var a = ageInfo(quote.age); return a.valid && num(life.at1Wan) > a.at1Max; })(),
      death: L.at1 + P.death,
      transportDeath: L.at1 + L.transportExtra + P.death,
      hospital: L.hospital + P.hospital,
      outpatient: L.outpatient + P.outpatient,
      er: L.er + P.er,
      accidentMedical: L.mr + L.mrc + P.accidentMedical,
      premium: L.premium + P.premium
    };
  }

  /* ---------- 日期（只用年月日，避免時區／UTC 字串解析造成少算一天） ---------- */
  var WD = ['日', '一', '二', '三', '四', '五', '六'];
  /** 解析 YYYY-MM-DD → {y,m,d}；不使用 new Date('YYYY-MM-DD')（那會當 UTC 午夜） */
  function parseDateParts(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '').trim());
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, m: mo, d: d };
  }
  /** 供顯示用的本地 Date（僅取年月日欄位） */
  function parseDate(s) {
    var p = parseDateParts(s);
    if (!p) return null;
    return new Date(p.y, p.m - 1, p.d);
  }
  function fmtDate(s, mode) {
    var p = parseDateParts(s);
    if (!p) return s || '';
    var dt = new Date(p.y, p.m - 1, p.d);
    var y = mode === 'ad' ? p.y : p.y - 1911;
    return y + '/' + p.m + '/' + p.d + '（' + WD[dt.getDay()] + '）';
  }
  /**
   * 投保／旅遊天數：算頭算尾（出發日、回程日都算）。
   * 例：10/13～10/19 = 7；同一天 = 1。
   * 用 Date.UTC(y,m-1,d) 做日差，不受瀏覽器時區／DST 影響。
   */
  function daysInclusive(a, b) {
    var p1 = parseDateParts(a), p2 = parseDateParts(b);
    if (!p1 || !p2) return null;
    var t1 = Date.UTC(p1.y, p1.m - 1, p1.d);
    var t2 = Date.UTC(p2.y, p2.m - 1, p2.d);
    if (t2 < t1) return null;
    return Math.floor((t2 - t1) / 86400000) + 1;
  }

  /* ---------- 保險期間（fr6）：依起訖「日時」每滿 24 小時算一天，未滿 24 小時以一天計 ----------
   * 同富邦產險 B2B／富邦人壽系統：115/11/10 10:00～115/11/15 10:00＝5 天；～11/15 10:01＝6 天。
   * 時間未填：視為出發、回程同一時刻（只填一邊 → 另一邊比照同一時刻）→ 天數＝日期相減（不再算頭算尾）。
   * 同一天來回＝1 天（最少 1 天）。
   */
  var DAY_RULE = 'start24';     // fr7：結束時間＝出發時間，天數＝日數差（或直接填天數）
  var DAY_RULE_FR6 = 'h24';      // fr6：另有回程時間
  /** 'YYYY-MM-DD' + n 天 */
  function addDays(s, n) {
    var p = parseDateParts(s);
    if (!p || !isFinite(Number(n))) return '';
    var d = new Date(Date.UTC(p.y, p.m - 1, p.d) + Number(n) * 86400000);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }
  function parseTime(s) {
    var m = /^\s*(\d{1,2}):(\d{2})/.exec(String(s == null ? '' : s));
    if (!m) return null;
    var h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }
  function hhmm(t) {
    if (t == null) return '';
    var h = Math.floor(t / 60), mi = t % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
  }
  function fmtTime(s) { return hhmm(parseTime(s)); }
  /** 回傳 { days, error, minutes, timesMissing: 'both'|'start'|'end'|'', startTime, endTime（實際採用） } */
  function periodDays(startDate, startTime, endDate, endTime) {
    var p1 = parseDateParts(startDate), p2 = parseDateParts(endDate);
    if (!p1 || !p2) return { days: null, missing: true };
    var t1 = parseTime(startTime), t2 = parseTime(endTime);
    var miss = (t1 == null && t2 == null) ? 'both' : (t1 == null ? 'start' : (t2 == null ? 'end' : ''));
    if (t1 == null && t2 == null) { t1 = 0; t2 = 0; }
    else if (t1 == null) t1 = t2;
    else if (t2 == null) t2 = t1;
    var a = Date.UTC(p1.y, p1.m - 1, p1.d) + t1 * 60000;
    var b = Date.UTC(p2.y, p2.m - 1, p2.d) + t2 * 60000;
    if (b < a) {
      var sameDay = Date.UTC(p1.y, p1.m - 1, p1.d) === Date.UTC(p2.y, p2.m - 1, p2.d);
      return { days: null, error: sameDay ? '⚠ 回程時間早於出發時間，請確認時間' : '⚠ 回程日早於出發日，請確認日期', timesMissing: miss };
    }
    var mins = Math.round((b - a) / 60000);
    var days = Math.max(1, Math.ceil(mins / 1440));
    return { days: days, minutes: mins, timesMissing: miss, startTime: hhmm(t1), endTime: hhmm(t2) };
  }
  function quotePeriodDays(q) {
    q = q || {};
    return periodDays(q.startDate, q.startTime, q.endDate, q.endTime);
  }
  /** 日期＋時間（時間未填只顯示日期）；short＝11/10 10:00 */
  function fmtDateTime(d, t, mode) {
    var tt = fmtTime(t);
    if (mode === 'short') {
      var p = parseDateParts(d);
      if (!p) return d || '';
      return p.m + '/' + p.d + (tt ? ' ' + tt : '');
    }
    return fmtDate(d, mode) + tt;
  }
  /** 客戶頁／總表圖：保險期間文字（起訖日時） */
  function periodText(quote) {
    var mode = quote.dateFormat === 'ad' ? 'ad' : 'roc';
    if (!quote.startDate && !quote.endDate) return '';
    return fmtDateTime(quote.startDate, quote.startTime, mode) + ' ～ ' + fmtDateTime(quote.endDate, quote.endTime, mode);
  }

  /* ---------- 分享連結編解碼（JSON → deflate → base64url，放在 #q=） ---------- */
  function b64urlFromBytes(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function bytesFromB64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function stripForShare(q) {
    var c = JSON.parse(JSON.stringify(q));
    delete c._sampleSource;
    return c;
  }
  function encodeQuote(q) {
    var json = JSON.stringify(stripForShare(q));
    var bytes = new TextEncoder().encode(json);
    if (global.pako) return 'q=' + b64urlFromBytes(global.pako.deflateRaw(bytes, { level: 9 }));
    return 'j=' + b64urlFromBytes(bytes);
  }
  function decodeHash(hash) {
    hash = String(hash || '').replace(/^#/, '');
    var params = {};
    hash.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) params[kv.slice(0, i)] = kv.slice(i + 1);
    });
    var bytes;
    if (params.q) {
      if (!global.pako) throw new Error('缺少解壓縮元件（js/vendor/pako.min.js）');
      bytes = global.pako.inflateRaw(bytesFromB64url(params.q));
    } else if (params.j) {
      bytes = bytesFromB64url(params.j);
    } else {
      return null;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function shareUrl(q, base) {
    // 以目前頁面所在資料夾為基準（線上編輯器 → 線上 index.html），不寫死網域
    var u = new URL(base || 'index.html', location.href);
    u.search = ''; u.hash = '';
    return u.href + '#' + encodeQuote(q);
  }

  /* ---------- 渲染 ---------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /** 括號拆分：（人壽 X＋產險 Y）／（人壽 X）／（產險 Y） */
  function bracket(lifeOn, lifeTxt, propTxt, propOn) {
    if (propOn === undefined) propOn = true;
    var parts = [];
    if (lifeOn) parts.push('人壽 ' + lifeTxt);
    if (propOn) parts.push('產險 ' + propTxt);
    return parts.length ? '（' + parts.join('＋') + '）' : '';
  }
  /** 身故框下方拆分文字 */
  function deathSplit(L, P) {
    var parts = [];
    if (L.enabled) parts.push('人壽 ' + fmtShort(L.at1));
    if (P.enabled) parts.push('產險 ' + fmtShort(P.death));
    return parts.join('＋');
  }
  /** 保費算式 HTML（壽＋產＝合計；純壽／純產只列一項） */
  function premiumFormula(c) {
    var L = c.life, P = c.prop;
    if (!L.enabled && !P.enabled) return '<b>未選擇人壽或產險</b>';
    if (c.lifePremiumMissing || c.propPremiumMissing) {
      var lt = c.lifePremiumMissing ? (c.lifeOverCap ? 'AT1 超過年齡上限' : '需另行試算') : comma(L.premium);
      var pt = c.propPremiumMissing ? (c.propTooShort ? '最少需投保 2 天' : '需另行試算') : comma(P.premium);
      if (L.enabled && P.enabled) {
        return '壽 <b>' + lt + '</b> ＋ 產 <b>' + pt + '</b>（' +
          (c.lifePremiumMissing && c.propPremiumMissing ? '保費另計' : c.lifePremiumMissing ? '人壽保費另計' : '產險保費另計') + '）';
      }
      if (L.enabled) return '壽 <b>' + lt + '</b>（請以 GPTA 試算）';
      return '產 <b>' + pt + '</b>（請以產險系統試算）';
    }
    if (L.enabled && P.enabled) return '壽 <b>' + comma(L.premium) + '</b> ＋ 產 <b>' + comma(P.premium) + '</b> ＝ <span class="prem-total">' + comma(c.premium) + '</span> 元';
    if (L.enabled) return '純人壽 ＝ <span class="prem-total">' + comma(c.premium) + '</span> 元';
    return '純產險 ＝ <span class="prem-total">' + comma(c.premium) + '</span> 元';
  }
  function row(label, total, br, sub) {
    return '<div class="cov-row"><div class="cov-label">' + esc(label) +
      (sub ? '<span class="cov-sub">' + esc(sub) + '</span>' : '') + '</div>' +
      '<div class="cov-val"><strong>' + esc(total) + '</strong></div><div class="cov-br">' + esc(br) + '</div></div>';
  }
  function itemList(items) {
    if (!items || !items.length) return '<p class="empty">（未列項目）</p>';
    return '<ul class="items">' + items.map(function (it) {
      var amt = String(it.amount === null || it.amount === undefined ? '' : it.amount).split('，').map(function (part) {
        return '<span class="nw">' + esc(part) + '</span>';
      }).join('，<wbr>');
      return '<li><span class="it-name">' + esc(it.name) + '</span><span class="it-amt">' + (amt || '—') + '</span></li>';
    }).join('') + '</ul>';
  }

  /** 交通意外加倍（人壽 Go安行 AT1 條款第六條：除一般意外身故外，另按保額給付） */
  function transportLine(c) {
    var L = c.life, P = c.prop;
    if (!L.enabled || L.child || !(L.at1 > 0)) return null;
    var br = '人壽 ' + fmtShort(L.at1 + L.transportExtra) + '（一般 ' + fmtShort(L.at1) + '＋交通加給 ' + fmtShort(L.transportExtra) + '）' +
      (P.enabled && P.death > 0 ? '＋產險 ' + fmtShort(P.death) : '');
    return { label: '搭乘大眾運輸工具・騎乘自行車・駕駛或乘坐汽車 意外身故', total: fmtYuan(c.transportDeath), br: br };
  }
  function transportHtml(c) {
    var t = transportLine(c);
    if (!t) return '';
    return '<div class="transport-box"><div class="tr-label">🚌🚲🚗 交通意外加倍・' + esc(t.label) + '</div>' +
      '<div class="tr-val">' + esc(t.total) + '</div><div class="tr-br">' + esc(t.br) + '</div></div>';
  }
  /** 地區限額說明（人壽 OH1；DM 註3） */
  function regionChipText(c, quote) {
    var L = c.life;
    if (!L.enabled) return '';
    var pct = L.regionPct;
    if (pct === 100) return '';
    var oh1 = fmtShort(L.oh1);
    return '🌏 ' + (quote.destination ? quote.destination + '：' : '') + '人壽適用「' + regionLabel(pct) + '」地區醫療限額 ' + pct + '%' +
      '（住院・門診・急診；OH1 ' + oh1 + ' × ' + pct + '% ＝ 住院限額 ' + fmtShort(L.oh1 * pct / 100) + '）';
  }
  function lifeExtraItems(c) {
    var L = c.life, items = [];
    if (!L.child) {
      items.push({ name: '交通意外失能（大眾運輸／自行車／汽車）', amount: '一般意外失能外，另按 AT1 ' + fmtShort(L.at1) + ' × 失能比例（5%～100%）加給' });
    }
    items.push({ name: '重大燒燙傷', amount: L.child
      ? fmtYuan(L.burnOh1) + '（OH1 100%，限海外）'
      : '最高 ' + fmtYuan(L.burnAt1 + L.burnOh1) + '（AT1 20% ' + fmtShort(L.burnAt1) + '；在海外另加 OH1 100% ' + fmtShort(L.burnOh1) + '）' });
    items.push({ name: '海外突發疾病返國住院', amount: '保期內最高 ' + fmtYuan(L.returnHosp) + '（OH1 30%）' });
    items.push({ name: '海外突發疾病住院補償', amount: '實際支付住院醫療保險金之 10%／15%／20%（住院≦7天／8～14天／≧15天）' });
    return items;
  }

  /* ---------- DM 版面輔助（115/10/06 美編：同原版德國 DM） ---------- */
  var CN_NUM = '一二三四五六七八九十';
  function splitPlanName(name, idx) {
    var s = String(name || '').trim();
    var m = /^(方案\s*[一二三四五六七八九十0-9]+)[\s\u3000:：・\-]*(.*)$/.exec(s);
    if (m) return { no: m[1].replace(/\s+/g, ''), nm: m[2] || '' };
    return { no: '方案' + (CN_NUM.charAt(idx) || String(idx + 1)), nm: s };
  }
  /* ---------- 方案類型（純人壽／純產險／人壽＋產險）→ 名稱／副標一律由類型推導（115/10/06 fr3） ---------- */
  var PLAN_KINDS = ['life', 'prop', 'both'];
  var PLAN_KIND_LABEL = { life: '純人壽', prop: '純產險', both: '人壽＋產險', none: '未選擇類型' };
  var AUTO_TAGLINE = { life: '高身故・高醫療（富邦人壽）', prop: '含旅行不便險（富邦產險）', both: '壽＋產・保障最完整', none: '' };
  /** 依 life.enabled／property.enabled 判斷類型（舊稿 property 無 enabled＝含產險，同 computePlan） */
  function planKind(p) {
    var l = !!(p && p.life && p.life.enabled);
    var r = !!(p && (!p.property || p.property.enabled !== false));
    return l && r ? 'both' : l ? 'life' : r ? 'prop' : 'none';
  }
  /** 保額檔次：純人壽＝AT1；純產險＝產險身故；壽＋產＝「各500萬」或「壽500萬／產200萬」；未滿15歲（無 AT1／產險身故）不列 */
  function planTierText(p, quote) {
    var k = planKind(p);
    if (k === 'none' || (quote && isChildQuote(quote))) return '';
    var a = num(p.life && p.life.at1Wan), d = num(p.property && p.property.deathWan);
    if (k === 'life') return a > 0 ? a + '萬' : '';
    if (k === 'prop') return d > 0 ? d + '萬' : '';
    if (!(a > 0) || !(d > 0)) return '';
    return a === d ? '各' + a + '萬' : '壽' + a + '萬／產' + d + '萬';
  }
  /** 醫療加值：人壽「國外旅遊醫療加值」組合（OH1／MR＝AT1×20%）或 產險勾「醫療加值」（計畫二） */
  function isMedPlus(p) {
    if (!p) return false;
    var k = planKind(p);
    var lp = k !== 'prop' && p.life && p.life.combo === 'plus';
    var pp = k !== 'life' && p.property && !!p.property.medPlus;
    return !!(lp || pp);
  }
  function autoPlanName(p, idx, quote) {
    var t = planTierText(p, quote);
    return '方案' + (CN_NUM.charAt(idx) || String(idx + 1)) + ' ' + PLAN_KIND_LABEL[planKind(p)] + (t ? ' ' + t : '') + (isMedPlus(p) ? '・醫療加值' : '');
  }
  /** 保障高低：意外身故 → 住院 → 門診 → 意外醫療 → 保費（同保障時保費高者通常項目較多） */
  function protectionKey(p, quote) {
    var c = computePlan(p, quote);
    return [c.death || 0, c.hospital || 0, c.outpatient || 0, c.accidentMedical || 0, isMedPlus(p) ? 1 : 0, c.premium || 0];
  }
  function bestProtectionIndex(quote) {
    var best = -1, bk = null;
    (quote.plans || []).forEach(function (p, i) {
      if (planKind(p) === 'none') return;
      var k = protectionKey(p, quote);
      if (!bk) { best = i; bk = k; return; }
      for (var j = 0; j < k.length; j++) { if (k[j] > bk[j]) { best = i; bk = k; return; } if (k[j] < bk[j]) return; }
    });
    return best;
  }
  /** 舊稿／舊連結（無 nameCustom）：名稱為預設樣式（方案X＋類型＋保額）→ 視為自動，依勾選重新推導（修正名稱與勾選不一致） */
  var AUTO_NAME_RE = /^\s*(方案\s*[一二三四五六七八九十0-9]+)?[\s\u3000:：・\-]*(純人壽|純產險|人壽\s*[＋+]\s*產險|壽\s*[＋+]\s*產|未選擇類型)?\s*(各|壽)?\s*(\d+\s*萬)?\s*([／\/]\s*產?\s*\d+\s*萬)?\s*([・·]?\s*醫療加值)?\s*$/;
  function nameIsAuto(p) {
    if (!p) return true;
    if (p.nameCustom === true) return false;
    if (p.nameCustom === false) return true;
    return AUTO_NAME_RE.test(String(p.name == null ? '' : p.name));
  }
  function taglineIsAuto(p) {
    if (!p) return true;
    if (p.taglineCustom === true) return false;
    if (p.taglineCustom === false) return true;
    if (p.tagline == null) return true;
    var t = String(p.tagline).trim();
    return PLAN_KINDS.some(function (k) { return AUTO_TAGLINE[k] === t; });
  }
  function planName(p, idx, quote) {
    return (nameIsAuto(p) ? '' : String(p.name || '').trim()) || autoPlanName(p, idx, quote);
  }
  function planTagline(p) { return taglineIsAuto(p) ? AUTO_TAGLINE[planKind(p)] : String(p.tagline == null ? '' : p.tagline); }
  /** 渲染前：名稱／副標依類型解析（不改原物件；可重複呼叫） */
  function resolvePlanNames(quote) {
    if (!quote || !quote.plans || quote._namesResolved) return quote;
    var q = {};
    Object.keys(quote).forEach(function (k) { q[k] = quote[k]; });
    q.plans = quote.plans.map(function (p, i) {
      var c = {};
      Object.keys(p || {}).forEach(function (k) { c[k] = p[k]; });
      c.name = planName(p, i, quote); c.nameCustom = !nameIsAuto(p);
      c.tagline = planTagline(p); c.taglineCustom = !taglineIsAuto(p);
      return c;
    });
    Object.defineProperty(q, '_namesResolved', { value: true, enumerable: false });
    return q;
  }
  /** 各方案同類型 → 該類型；否則 null */
  function uniformKind(quote) {
    var ks = ((quote && quote.plans) || []).map(planKind);
    return ks.length && ks[0] !== 'none' && ks.every(function (k) { return k === ks[0]; }) ? ks[0] : null;
  }
  function quoteKinds(quote) {
    var plans = (quote && quote.plans) || [];
    return {
      life: plans.some(function (p) { return p.life && p.life.enabled; }),
      prop: plans.some(function (p) { return !p.property || p.property.enabled !== false; })
    };
  }
  function companiesText(quote, sep) {
    var k = quoteKinds(quote), a = [];
    if (k.life) a.push('富邦人壽');
    if (k.prop) a.push('富邦產險');
    return a.join(sep || '、');
  }
  function heroTagText(quote) {
    var n = ((quote && quote.plans) || []).length;
    var co = companiesText(quote, ' ／ ');
    var uk = n > 1 ? uniformKind(quote) : null;
    return (co ? co + '｜' : '') + (uk ? PLAN_KIND_LABEL[uk] + ' ' : '') + (n > 0 && n <= 10 ? CN_NUM.charAt(n - 1) : n) + '方案比較';
  }
  function heroBadgesHtml(quote, cls) {
    cls = cls || 'hero-badge';
    var h = '';
    if (quote.schengen) h += '<span class="' + cls + '">申根／計畫二</span>';
    var pct = num(quote.lifeRegionPct || 100);
    if (quote.plans && quoteKinds(quote).life && pct !== 100) {
      h += '<span class="' + cls + ' gold">人壽醫療限額 ' + pct + '%・' + esc(regionLabel(pct)) + '</span>';
    }
    return h;
  }
  function agentParts(a) {
    // 通訊處／單位鎖定：一律「富邦人壽 南方通訊處」，忽略連結／草稿中的 unit
    var segs = String(DEFAULT_AGENT.unit).split(/[・·]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var team = segs.length > 1 ? segs[segs.length - 1] : '';
    var org = segs.length > 1 ? segs.slice(0, -1).join('・') : String(DEFAULT_AGENT.unit);
    var name = String(a.name || '').trim();
    return {
      // 「王小明 業務員」；未填姓名 → 「南方通訊處」
      line: name ? [team, name, String(a.title || '').trim()].filter(Boolean).join(' ') : (team || '南方通訊處'),
      hasPerson: !!name,
      org: '富邦人壽' + (org ? ' ' + org : '')
    };
  }
  function disclaimerText(quote) {
    var co = companiesText(quote, '、') || '保險公司';
    return '以上保費為試算結果，實際以' + co + '核保為準；保障內容以保單條款為準。';
  }
  /** 卡片大字保費 */
  function priceInfo(c) {
    var L = c.life, P = c.prop;
    if (!L.enabled && !P.enabled) return { amount: null, miss: '未選擇人壽或產險', sub: '' };
    if (c.lifePremiumMissing || c.propPremiumMissing) {
      var who = (c.lifePremiumMissing && c.propPremiumMissing) ? '人壽、產險' : c.lifePremiumMissing ? '人壽' : '產險';
      var miss = (c.lifePremiumMissing && c.lifeOverCap) ? 'AT1 超過年齡上限' : (c.propTooShort && !c.lifePremiumMissing) ? '產險最少需投保 2 天' : who + '保費需另行試算';
      var sub = '';
      if (L.enabled && P.enabled) {
        if (!c.lifePremiumMissing) sub = '人壽 ' + comma(L.premium) + '＋產險另計（請以產險系統試算）';
        else if (!c.propPremiumMissing) sub = '產險 ' + comma(P.premium) + '＋人壽另計（請以 GPTA 試算）';
        else sub = '人壽請以 GPTA、產險請以產險系統試算';
      } else sub = L.enabled ? '請以 GPTA 試算' : '請以產險系統試算';
      return { amount: null, miss: miss, sub: sub };
    }
    if (L.enabled && P.enabled) return { amount: comma(c.premium), sub: '合計＝人壽 ' + comma(L.premium) + '＋產險 ' + comma(P.premium) };
    return { amount: comma(c.premium), sub: '總保費（' + (L.enabled ? '純人壽' : '純產險') + '）' };
  }
  function priceHtml(c, pre) {
    pre = pre || 'price';
    var p = priceInfo(c);
    return '<div class="' + pre + '-box">' + (p.amount !== null
      ? '<div class="' + pre + '"><span class="c">NT$</span><span class="n">' + p.amount + '</span></div>'
      : '<div class="' + pre + ' miss">' + esc(p.miss) + '</div>') +
      (p.sub ? '<div class="' + pre + '-sub">' + esc(p.sub) + '</div>' : '') + '</div>';
  }
  /** 主要保障比較表資料（全部由 computePlan 計算，不另行推算） */
  function cmpCell(v, sub, na, cls) { return { v: v, sub: sub || '', na: !!na, cls: cls || '' }; }
  var NA = function () { return cmpCell('—', '', true); };
  function compareData(quote, opt) {
    opt = opt || {};
    quote = resolvePlanNames(quote);
    var plans = quote.plans || [];
    var cs = plans.map(function (p) { return computePlan(p, quote); });
    var rows = [];
    function both(c, lt, pt) { return (c.life.enabled && c.prop.enabled) ? lt + '＋' + pt : ''; }
    function amtRow(k, ksub, get, lt, pt) {
      rows.push({ k: k, ksub: ksub || '', cells: cs.map(function (c) {
        var v = get(c);
        return v > 0 ? cmpCell(fmtYuan(v), both(c, lt(c), pt(c))) : NA();
      }) });
    }
    rows.push({ k: '總保費', cls: 'prem', cells: cs.map(function (c) {
      var p = priceInfo(c);
      if (p.amount === null) return cmpCell(p.miss, '', false, 'miss');
      return cmpCell('NT$ ' + p.amount, (c.life.enabled && c.prop.enabled) ? '人壽 ' + comma(c.life.premium) + '＋產險 ' + comma(c.prop.premium) : '');
    }) });
    var anyChild = cs.some(function (c) { return c.child; });
    amtRow('意外身故・失能', '', function (c) { return c.death; }, function (c) { return fmtShort(c.life.at1); }, function (c) { return fmtShort(c.prop.death); });
    if (!anyChild && cs.some(function (c) { return transportLine(c); })) {
      rows.push({ k: '交通意外身故', ksub: '大眾運輸・自行車・汽車', cells: cs.map(function (c) {
        var t = transportLine(c);
        if (t) return cmpCell(t.total, '含人壽交通加給 ' + fmtShort(c.life.transportExtra));
        return c.death > 0 ? cmpCell(fmtYuan(c.transportDeath), '同一般意外身故') : NA();
      }) });
    }
    if (anyChild && cs.some(function (c) { return c.life.enabled; })) {
      rows.push({ k: '兒童傷害醫療 MRC', ksub: '每一事故最高', cells: cs.map(function (c) {
        return (c.life.enabled && c.child) ? cmpCell(fmtYuan(c.life.mrc)) : NA();
      }) });
    }
    amtRow('海外突發疾病 住院', '保期內最高', function (c) { return c.hospital; }, function (c) { return fmtShort(c.life.hospital); }, function (c) { return fmtShort(c.prop.hospital); });
    amtRow('海外突發疾病 門診', '人壽為每日最高', function (c) { return c.outpatient; }, function (c) { return fmtShort(c.life.outpatient); }, function (c) { return fmtShort(c.prop.outpatient); });
    amtRow('海外突發疾病 急診', '人壽為每日最高', function (c) { return c.er; }, function (c) { return fmtShort(c.life.er); }, function (c) { return fmtShort(c.prop.er); });
    amtRow('意外醫療', '每一事故最高', function (c) { return c.accidentMedical; },
      function (c) { return c.life.child ? 'MRC ' + fmtShort(c.life.mrc) : fmtShort(c.life.mr); }, function (c) { return fmtShort(c.prop.accidentMedical); });
    if (cs.some(function (c) { return c.life.enabled && c.life.regionPct !== 100; })) {
      var rp = 100;
      cs.forEach(function (c) { if (c.life.enabled && c.life.regionPct !== 100) rp = c.life.regionPct; });
      rows.push({ k: '人壽醫療地區限額', ksub: regionLabel(rp), cells: cs.map(function (c) {
        if (!c.life.enabled) return NA();
        return cmpCell(c.life.regionPct + '%', c.life.regionPct !== 100 ? 'OH1 ' + fmtShort(c.life.oh1) + ' × ' + c.life.regionPct + '%' : '');
      }) });
    }
    rows.push({ k: '旅遊不便險', ksub: '', cells: cs.map(function (c) { return c.prop.enabled ? cmpCell('✓ 含', '', false, 'yes') : NA(); }) });
    var more = 0;
    if (opt.inconv) {
      var names = [];
      plans.forEach(function (p, i) {
        if (!cs[i].prop.enabled) return;
        (p.inconvenience || []).forEach(function (it) { if (it && it.name && names.indexOf(it.name) < 0) names.push(it.name); });
      });
      more = Math.max(0, names.length - opt.inconv);
      names.slice(0, opt.inconv).forEach(function (n) {
        rows.push({ k: n, ksub: '', cls: 'inc', cells: plans.map(function (p, i) {
          if (!cs[i].prop.enabled) return NA();
          var hit = null;
          (p.inconvenience || []).forEach(function (it) { if (!hit && it && it.name === n) hit = it; });
          return (hit && isSet(hit.amount) && String(hit.amount) !== '') ? cmpCell(String(hit.amount), '', false, 'txt') : NA();
        }) });
      });
    }
    return { plans: plans, cs: cs, rows: rows, more: more };
  }
  function compareTableHtml(quote, opt) {
    var d = compareData(quote, opt);
    if (!d.plans.length) return '';
    var h = '<table class="cmp"><thead><tr><th class="k">保障項目</th>';
    d.plans.forEach(function (p, i) {
      var nm = splitPlanName(p.name, i);
      h += '<th class="pc' + (i % 3 + 1) + (p.recommended ? ' reco' : '') + '">' + esc(nm.no) + (nm.nm ? '<small>' + esc(nm.nm) + '</small>' : '') + '</th>';
    });
    h += '</tr></thead><tbody>';
    d.rows.forEach(function (r) {
      h += '<tr' + (r.cls ? ' class="' + r.cls + '"' : '') + '><td class="k">' + esc(r.k) + (r.ksub ? '<small>' + esc(r.ksub) + '</small>' : '') + '</td>';
      r.cells.forEach(function (c, i) {
        var cls = [];
        if (d.plans[i].recommended) cls.push('reco');
        if (c.na) cls.push('na');
        if (c.cls) cls.push(c.cls);
        h += '<td' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' + esc(c.v) + (c.sub ? '<small>' + esc(c.sub) + '</small>' : '') + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table>';
    if (d.more > 0) h += '<p class="cmp-more">…另有 ' + d.more + ' 項不便險／其他保障，詳見完整報價</p>';
    return h;
  }

  function renderPlanCard(plan, quote, idx) {
    if (quote && !quote._namesResolved && quote.plans && quote.plans[idx] === plan) plan = resolvePlanNames(quote).plans[idx];
    var c = computePlan(plan, quote);
    var L = c.life, P = c.prop, on = L.enabled, pon = P.enabled;
    var nm = splitPlanName(plan.name, idx);
    var h = '';
    h += '<article class="plan-card pc' + (idx % 3 + 1) + (plan.recommended ? ' is-reco' : '') + '" id="plan-' + (idx + 1) + '">';
    if (quote.sample) h += '<div class="card-sample">範例</div>';
    h += '<header class="plan-head"><div class="plan-title"><span class="plan-no">' + esc(nm.no) + '</span>' +
      (plan.recommended ? '<span class="reco-badge">推薦</span>' : '') + '</div>' +
      (nm.nm ? '<div class="plan-nm">' + esc(nm.nm) + '</div>' : '') + '</header>';
    if (plan.tagline) h += '<div class="plan-tagline">' + (plan.recommended ? '♛ ' : '') + esc(plan.tagline) + '</div>';
    h += priceHtml(c);

    if (c.child) {
      // 未滿15足歲：人壽無 AT1、產險兒童方案無身故失能 → 主框改顯示兒童主約
      h += '<section class="death-box child"><div class="death-label">' + (on ? '人壽兒童主約 MRC（傷害醫療）' : '意外身故・失能 保額') + '</div>' +
        '<div class="death-val">' + (on ? esc(fmtYuan(L.mrc)) : '—') + '</div>' +
        '<div class="death-br">' + esc(on
          ? '富邦人壽兒童傷害醫療旅行平安保險（未滿15足歲不提供 AT1 意外身故）'
          : (pon ? '未滿15足歲：產險兒童方案無意外身故・失能保障' : '')) + '</div></section>';
    } else {
      h += '<section class="death-box"><div class="death-label">意外身故・失能 保額</div>' +
        '<div class="death-val">' + esc(fmtYuan(c.death)) + '</div>' +
        '<div class="death-br">' + esc(deathSplit(L, P)) + '</div>' + transportHtml(c) + '</section>';
    }

    h += '<section class="cov"><h3 class="sec-title">醫療保障</h3>';
    h += row('海外突發疾病 住院', fmtYuan(c.hospital), bracket(on, fmtShort(L.hospital), fmtShort(P.hospital), pon),
      on ? (L.child ? '人壽突發疾病 OH1 ' + fmtShort(L.oh1) + '・保期內最高' : '人壽保期內最高') : '');
    h += row('海外突發疾病 門診', fmtYuan(c.outpatient), bracket(on, '每日最高 ' + fmtShort(L.outpatient), fmtShort(P.outpatient), pon));
    h += row('海外突發疾病 急診', fmtYuan(c.er), bracket(on, '每日最高 ' + fmtShort(L.er), fmtShort(P.er), pon));
    h += row('意外醫療', fmtYuan(c.accidentMedical), bracket(on, L.child ? 'MRC ' + fmtShort(L.mrc) : fmtShort(L.mr), fmtShort(P.accidentMedical), pon),
      on ? (L.child ? '人壽兒童傷害醫療 MRC・每一事故最高' : '人壽每一事故最高') : '');
    var rc = regionChipText(c, quote);
    if (rc) h += '<div class="region-chip">' + esc(rc) + '</div>';
    if (on && L.oaa) h += '<div class="oaa-chip">✈ 人壽另含 OAA 海外醫療專機運送（實物給付）</div>';
    h += '</section>';
    if (on) {
      h += '<section class="life-extra"><h3 class="sec-title">人壽其他保障</h3><ul class="extra-list">' +
        lifeExtraItems(c).map(function (it) { return '<li><b>' + esc(it.name) + '</b><span>' + esc(it.amount) + '</span></li>'; }).join('') + '</ul></section>';
    }

    if (pon) {
      h += '<section class="inconv"><h3 class="sec-title">不便險（產險）</h3>' + itemList(plan.inconvenience) + '</section>';
      h += '<section class="others"><h3 class="sec-title">其他產險保障</h3>' + itemList(plan.others) + '</section>';
    } else {
      h += '<section class="inconv"><h3 class="sec-title">不便險・其他產險保障</h3><p class="empty">不含（本方案為純人壽，無旅行不便險）</p></section>';
    }

    h += '<footer class="premium"><div class="prem-label">保費</div><div class="prem-formula">' + premiumFormula(c) + '</div></footer>';
    h += '</article>';
    return h;
  }

  function renderNotes(quote) {
    var notes = [];
    var anyLife = (quote.plans || []).some(function (p) { return p.life && p.life.enabled; });
    var anyProp = (quote.plans || []).some(function (p) { return !p.property || p.property.enabled !== false; });
    var prodBits = [];
    if (anyLife) prodBits.push('人壽＝' + LIFE_PRODUCT);
    if (anyProp) prodBits.push('產險＝' + PROPERTY_PRODUCT +
      (quote.schengen ? '【計畫二・醫療加值／申根適用，海外突發疾病住院 150萬】'
        : (quote.plans || []).some(function (p) { return p.property && p.property.enabled !== false && p.property.medPlus; })
          ? '【計畫一・國外旅遊適用；標示「醫療加值」之方案產險為計畫二・醫療加值，海外突發疾病住院 150萬（含法定傳染病）】'
          : '【計畫一・國外旅遊適用】'));
    if (prodBits.length) notes.push(prodBits.join('；') + '。');
    if (quote.dayRule === DAY_RULE && quote.startDate && quote.endDate) {
      notes.push('保險期間自出發日時起算，每 24 小時為一天（本報價共 ' + (quote.days || '—') + ' 天，結束時間同出發時間）；實際以保險單所載日時為準。');
    } else if (quote.dayRule === DAY_RULE_FR6 && quote.startDate && quote.endDate) {
      notes.push('保險期間依出發／回程日期與時間計算：每滿 24 小時為一天，未滿 24 小時以一天計（本報價共 ' + (quote.days || '—') + ' 天）；實際以保險單所載日時為準。');
    }
    if (quote.schengen) {
      notes.push('申根行程：' + (anyProp ? '產險已套用計畫二；' : '') + '請隨身攜帶申根地區醫療旅遊保險英文投保憑證。' +
        (anyLife ? '人壽為國外其他地區（OAA 不適用），保費請以 GPTA 試算為準。' : ''));
    }
    var childQ = isChildQuote(quote);
    if (childQ) {
      if (anyLife) notes.push('未滿15足歲：人壽主約為富邦人壽兒童傷害醫療旅行平安保險 MRC 60萬（傷害醫療每一事故最高），不提供 AT1 意外身故；另含海外突發疾病 OH1 及 OAA。');
      if (anyProp) notes.push('產險：未滿15足歲適用新快樂旅綜+ 兒童方案；依 DM「針對未滿15足歲之被保險人，本保險契約無提供意外死亡之喪葬費用保險金」。');
    }
    if (anyLife) {
      var pct = num(quote.lifeRegionPct || 100);
      var lifePlans = (quote.plans || []).filter(function (p) { return p.life && p.life.enabled; });
      var lifeDefault = lifePlans.every(function (p) { return !isSet(p.life.oh1Wan) && !isSet(p.life.mrWan); });
      var combos = lifePlans.map(function (p) { return lifeCombo(p.life); });
      var allBasic = combos.every(function (x) { return x === 'basic'; }), allPlus = combos.every(function (x) { return x === 'plus'; });
      notes.push((childQ ? '人壽海外突發疾病（OH1）依所選保額'
        : !lifeDefault ? '人壽海外突發疾病（OH1）與意外醫療（MR）依各方案所列保額'
        : allBasic ? '人壽為「國外旅遊適用」組合：海外突發疾病（OH1）與意外醫療（MR）各為 AT1 保額之 10%'
        : allPlus ? '人壽為「國外旅遊醫療加值」組合：海外突發疾病（OH1）與意外醫療（MR）各為 AT1 保額之 20%（最高 250萬；91～100歲為 10%）'
        : '人壽 OH1／MR：國外旅遊適用＝AT1×10%；國外旅遊醫療加值＝AT1×20%（最高 250萬）') +
        '；人壽門診、急診每日最高分別為 OH1 之 3%、6%。');
      notes.push('人壽海外突發疾病限額依就醫地區調整（DM 註3）：美國、加拿大 350%；日本、歐洲、紐澳、南韓 200%；其他地區 100%；適用住院、門診、急診（返國住院、住院補償、重大燒燙傷不調整）' +
        (pct !== 100 ? '。本報價依 ' + esc(quote.destination || '') + ' 以 ' + pct + '% 顯示' : '') + '。');
      if (!childQ) notes.push('人壽 Go安行：以乘客身分搭乘大眾運輸工具、騎乘自行車、駕駛或乘坐汽車發生意外身故（或失能）時，除一般意外身故（失能）保險金外，另按保額（×失能比例）加給一倍。');
    }
    if (anyProp) notes.push('產險門診為住院額度 2%、急診為 5%（保期內最高）。');
    (quote.extraNotes || []).forEach(function (n) { if (n) notes.push(n); });
    notes.push('本頁為保障內容與保費試算摘要，實際以保單條款、投保規定及核保結果為準。');
    return '<ul class="notes">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
  }

  /** 保險期間 HTML（起訖各自不換行）；cls＝外層 span class */
  function periodHtml(quote, cls) {
    var mode = quote.dateFormat === 'ad' ? 'ad' : 'roc';
    if (!quote.startDate && !quote.endDate) return '';
    return '<span class="' + cls + '">📅 <small class="pd-lbl">保險期間</small> <em class="pd-t">' + esc(fmtDateTime(quote.startDate, quote.startTime, mode)) +
      '</em> ～ <em class="pd-t">' + esc(fmtDateTime(quote.endDate, quote.endTime, mode)) + '</em></span>';
  }
  function renderHeader(quote) {
    var dates = periodHtml(quote, 'hero-dates');
    var a = agentParts(agentOf(quote));
    var dest = quote.destination || '—';
    return '<div class="hero-tags"><span class="hero-tag">' + esc(heroTagText(quote)) + '</span>' + heroBadgesHtml(quote) + '</div>' +
      '<h1 class="hero-title"><span class="dest">' + esc(dest) + '</span><span class="ttl">旅遊保障方案</span></h1>' +
      '<div class="hero-sub">旅平險組合方案試算　<span class="nw"><b>' + esc(a.line) + '</b> 為您規劃</span></div>' +
      '<div class="hero-trip"><span>✈ ' + esc(dest) + '</span>' +
      dates +
      '<span class="days">共 <b>' + esc(quote.days || '—') + '</b> 天</span></div>';
  }

  function renderFooter(quote) {
    var a = agentOf(quote), ap = agentParts(a);
    return '<div class="sig-wrap"><img class="sig-logo" src="' + BRAND.logo + '" alt="' + esc(BRAND.logoAlt) + '" width="88" height="88">' +
      '<div class="sig-text"><div class="sig-kicker">您的專屬保險顧問</div>' +
      '<div class="sig-name">' + esc(ap.line) + '</div>' +
      '<div class="sig-unit">' + esc(ap.org) + '</div></div>' +
      (a.phone ? '<a class="sig-phone" href="' + esc(telHref(a.phone)) + '">☎ ' + esc(a.phone) + '</a>' : '') +
      '</div><div class="sig-disc">' + esc(disclaimerText(quote)) + '</div>';
  }

  function renderQuote(quote, root) {
    quote = resolvePlanNames(quote);
    var plans = quote.plans || [];
    var html = '';
    if (quote.sample) html += '<div class="sample-banner" role="note">⚠ 範例資料・非正式報價（僅供版面示意）</div>';
    html += '<header class="hero">' + renderHeader(quote) + '</header>';
    var ukNav = plans.length > 1 ? uniformKind(quote) : null;
    html += '<nav class="plan-nav">' + plans.map(function (p, i) {
      var nm = splitPlanName(p.name, i);
      // 三方案同類型：手機導覽列（隱藏名稱時）仍顯示保額檔次，方便客戶分辨
      var tier = (ukNav && !p.nameCustom) ? planTierText(p, quote) : '';
      return '<a href="#plan-' + (i + 1) + '" data-target="plan-' + (i + 1) + '" class="pc' + (i % 3 + 1) + '">' + esc(nm.no) +
        (tier ? '<span class="nav-tier"> ' + esc(tier) + '</span>' : '') + (nm.nm ? '<span class="nav-nm"> ' + esc(nm.nm) + '</span>' : '') + '</a>';
    }).join('') + '<a href="#plan-cmp" data-target="plan-cmp" class="nav-cmp">比較</a></nav>';
    html += '<main class="plans">' + plans.map(function (p, i) { return renderPlanCard(p, quote, i); }).join('') + '</main>';
    if (plans.length) {
      html += '<section class="cmp-card" id="plan-cmp"><h2 class="sec-title big">主要保障比較<small>— 表示不含此項保障</small></h2>' +
        '<div class="cmp-scroll">' + compareTableHtml(quote) + '</div></section>';
    }
    html += '<section class="notes-wrap"><h2 class="sec-title big">注意事項</h2>' + renderNotes(quote) + '</section>';
    html += '<footer class="site-footer">' + renderFooter(quote) + '</footer>';
    root.innerHTML = html;
    // 方案導覽：用 scrollIntoView，避免改動 #q= 分享資料
    Array.prototype.forEach.call(root.querySelectorAll('.plan-nav a'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var t = root.querySelector('#' + a.getAttribute('data-target'));
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function titleFor(q) {
    return (q.sample ? '【範例】' : '') + (q.destination || '') + ' ' + (q.days || '') + '天 旅平險三方案';
  }


  /** 產險預設方案解析：保額優先對「計畫一・一般」(P1-G*)；進階方案（計畫二／租車／兒童）以 planCode 為準 */
  function findPropertyPreset(prop) {
    var list = (global.PROPERTY_PRESETS && global.PROPERTY_PRESETS.plans) || [];
    if (!prop) return null;
    if (prop.planCode) {
      for (var i = 0; i < list.length; i++) if (list[i].code === prop.planCode) return list[i];
    }
    var death = num(prop.deathWan), hosp = num(prop.hospitalWan), acc = num(prop.accidentMedicalWan);
    var hits = list.filter(function (x) {
      return num(x.deathWan) === death
        && (hosp === 0 || num(x.hospitalWan) === hosp)
        && (acc === 0 || num(x.accidentMedicalWan) === acc);
    });
    if (hits.length === 1) return hits[0];
    var byDeath = list.filter(function (x) { return num(x.deathWan) === death && x.code.indexOf('P1-G') === 0; });
    if (byDeath.length === 1) return byDeath[0];
    return null;
  }
  function resolvePropertyPreset(prop, quote) {
    var list = (global.PROPERTY_PRESETS && global.PROPERTY_PRESETS.plans) || [];
    if (!prop) return null;
    // 計畫二（醫療加值・海突住院150萬・含法傳）：申根一律；非申根可勾「產險醫療加值」（DM：富邦產險開放非申根國亦可選擇投保醫療加值型）
    var schengen = !!(quote && quote.schengen) || !!prop.medPlus;
    var code = prop.planCode || '';
    // 未滿15足歲 → 只能投保兒童方案（DM 投保年齡「未滿15足歲」）：計畫一 P1-CHILD／申根 P2-CHILD（可進階手選 P2-CHILD 醫療加值）
    if (quote && isChildQuote(quote)) {
      var cc = (code === 'P2-CHILD' || schengen) ? 'P2-CHILD' : 'P1-CHILD';
      for (var ci = 0; ci < list.length; ci++) if (list[ci].code === cc) return list[ci];
      return null;
    }
    if (/CHILD/.test(code)) code = ''; // 15足歲以上不可用兒童方案 → 改依保額
    // 進階手選租車 → 尊守 planCode（申根模式下仍可用）
    if (code && /-R\d/.test(code)) {
      for (var i = 0; i < list.length; i++) if (list[i].code === code) return list[i];
    }
    // 主路徑：保額優先（避免舊 planCode 把使用者剛改的保額蓋回去）
    var death = num(prop.deathWan);
    if (death > 0) {
      var want = (schengen ? 'P2-G' : 'P1-G') + death;
      for (var j = 0; j < list.length; j++) if (list[j].code === want) return list[j];
    }
    // 無有效保額時，才回落既有與模式一致的 planCode
    if (code && !schengen && /^P1-G/.test(code)) {
      for (var a = 0; a < list.length; a++) if (list[a].code === code) return list[a];
    }
    if (code && schengen && /^P2-G/.test(code)) {
      for (var b = 0; b < list.length; b++) if (list[b].code === code) return list[b];
    }
    var f = findPropertyPreset(prop);
    return (f && f.child) ? null : f;
  }
  /** 產險方案是否符合 DM 投保年齡（ageMin～ageMax）；無年齡時視為未知（不擋） */
  function propertyAgeCheck(preset, quote) {
    var a = ageInfo(quote && quote.age);
    if (!preset || !a.valid) return { ok: true, unknown: !a.valid };
    var min = preset.ageMin, max = preset.ageMax;
    if (min == null || max == null) return { ok: true };
    if (a.age >= min && a.age <= max) return { ok: true };
    return { ok: false, tip: preset.label + ' 投保年齡為「' + preset.ageLabel + '」（DM），' + a.age + ' 歲不可投保' };
  }
  /** [2,3,...,10,11,12,15] → '2～12、15' */
  function dayList(keys) {
    var out = [], i = 0;
    while (i < keys.length) { var j = i; while (j + 1 < keys.length && keys[j + 1] === keys[j] + 1) j++; out.push(j > i ? keys[i] + '～' + keys[j] : String(keys[i])); i = j + 1; }
    return out.join('、');
  }
  /** 產險保費查表：僅 DM 有列的天數（通常 2～10），绝不內插；保額／方案變更時一併帶保障項目 */
  function lookupPropertyPremium(prop, days, quote) {
    var d = num(days);
    var preset = resolvePropertyPreset(prop, quote);
    if (!preset) {
      var sch = quote && quote.schengen;
      return { found: false, outOfRange: false, tip: sch
        ? '申根／計畫二尚無此產險保額（DM 有 200／300／500／1000／1500 萬，突發疾病住院皆 150萬）'
        : '尚無對應產險方案（請填保額 200／300／500／1000，或勾選申根／用進階下拉）', preset: null };
    }
    var ac = propertyAgeCheck(preset, quote);
    if (!ac.ok) return { found: false, outOfRange: false, ageBlocked: true, tip: ac.tip + '；請改選符合年齡的保額', preset: preset };
    var table = preset.premiumByDays || {};
    var keys = Object.keys(table).map(Number).filter(isFinite).sort(function (a, b) { return a - b; });
    var minD = keys[0], maxD = keys[keys.length - 1];
    if (!isFinite(d) || d <= 0) {
      return { found: false, outOfRange: false, tip: '請先填投保天數', preset: preset };
    }
    if (d < 2) {
      return { found: false, outOfRange: true, tooShort: true, tip: '產險最少需投保 2 天（富邦產險系統：國外旅遊保險期間至少需 2 日）', preset: preset, dayMin: minD, dayMax: maxD };
    }
    if (d < minD || d > maxD || table[String(d)] === undefined) {
      return {
        found: false,
        outOfRange: true,
        tip: '新快樂旅綜+ 費率（DM 2～10 天＋B2B 系統試算）此保額僅有 ' + dayList(keys) + ' 天，目前 ' + d + ' 天無資料，請向產險試算後手填（禁止推估）',
        preset: preset,
        dayMin: minD,
        dayMax: maxD
      };
    }
    var prem = table[String(d)];
    return {
      found: true,
      premium: prem,
      tip: '自動：' + comma(prem) + ' 元（' + preset.label + '／' + d + '天／' + (d <= 10 ? 'DM' : 'B2B 系統試算 2026-10-07') + '）',
      preset: preset,
      dayMin: minD,
      dayMax: maxD
    };
  }


  /**
   * 依目的地字串判斷是否申根行程（子字串比對；含繁中／常見異體／英文／城市／泛稱）。
   * 成員以歐盟官網為準（2025-01 保加利亞、羅馬尼亞已全面加入；賽普勒斯／愛爾蘭／英國非申根）。
   * 富邦 DM 另列安道爾／摩納哥／聖馬利諾／教廷等，一併視為申根行程。
   */
  function detectSchengen(dest) {
    var t = String(dest || '').trim();
    if (!t) return false;
    var low = t.toLowerCase();
    // 明確非申根（若整段只有這些、或未同時出現申根關鍵字）— 先蒐集命中
    var non = [
      '愛爾蘭', '爱尔兰', 'ireland', 'dublin', '都柏林',
      '英國', '英国', '英格蘭', '英格兰', '蘇格蘭', '苏格兰', '威爾士', '威爾斯',
      'uk', 'u.k.', 'united kingdom', 'england', 'scotland', 'wales', 'london', '倫敦', '伦敦',
      '賽普勒斯', '塞浦路斯', 'cyprus', '尼古西亞', '尼科西亞'
    ];
    var sch = [
      // 泛稱
      '申根', 'schengen', '歐洲', '欧洲', 'europe', '歐陸', 'eu ',
      // 國家（繁中＋異體＋英文）
      '法國', '法国', '法蘭西', 'france',
      '德國', '德国', 'germany', 'deutschland',
      '義大利', '意大利', 'italy', 'italia',
      '西班牙', 'spain', 'espana', 'españa',
      '葡萄牙', 'portugal',
      '荷蘭', '荷兰', 'netherlands', 'holland',
      '比利時', '比利时', 'belgium',
      '盧森堡', '卢森堡', 'luxembourg',
      '瑞士', 'switzerland', 'swiss',
      '奧地利', '奥地利', 'austria',
      '捷克', 'czech',
      '匈牙利', 'hungary',
      '波蘭', '波兰', 'poland',
      '斯洛伐克', 'slovakia',
      '斯洛維尼亞', '斯洛文尼亞', 'slovenia',
      '克羅埃西亞', '克羅地亞', '克罗地亚', 'croatia',
      '希臘', '希腊', 'greece',
      '丹麥', '丹麦', 'denmark',
      '瑞典', 'sweden',
      '挪威', 'norway',
      '芬蘭', '芬兰', 'finland',
      '冰島', '冰岛', 'iceland',
      '愛沙尼亞', '爱沙尼亚', 'estonia',
      '拉脫維亞', '拉脱维亚', 'latvia',
      '立陶宛', 'lithuania',
      '馬爾他', '马耳他', 'malta',
      '列支敦斯登', '列支敦士登', 'liechtenstein',
      '保加利亞', '保加利亚', 'bulgaria',
      '羅馬尼亞', '罗马尼亚', 'romania',
      // 微型國家／DM 常列
      '安道爾', '安道尔', 'andorra',
      '摩納哥', '摩纳哥', 'monaco',
      '聖馬利諾', '圣马力诺', 'san marino',
      '教廷', '梵蒂岡', '梵蒂冈', 'vatican', 'holy see',
      // 城市／熱門地
      '巴黎', 'paris',
      '羅馬', '罗马', 'rome',
      '米蘭', '米兰', 'milan',
      '威尼斯', 'venice',
      '佛羅倫斯', '佛罗伦萨', 'florence', 'firenze',
      '巴塞隆納', '巴塞罗那', 'barcelona',
      '馬德里', '马德里', 'madrid',
      '阿姆斯特丹', 'amsterdam',
      '布拉格', 'prague',
      '維也納', '维也纳', 'vienna',
      '慕尼黑', 'munich', 'münchen',
      '柏林', 'berlin',
      '蘇黎世', '苏黎世', 'zurich', 'zürich',
      '日內瓦', '日内瓦', 'geneva',
      '布達佩斯', '布达佩斯', 'budapest',
      '里斯本', 'lisbon',
      '雅典', 'athens',
      '斯德哥爾摩', '斯德哥尔摩', 'stockholm',
      '奧斯陸', '奥斯陆', 'oslo',
      '赫爾辛基', 'helsinki',
      '哥本哈根', 'copenhagen',
      '布魯塞爾', '布鲁塞尔', 'brussels',
      '法蘭克福', '法兰克福', 'frankfurt',
      '漢堡', 'hamburg',
      '科隆', 'cologne', 'köln',
      '尼斯', 'nice',
      '里昂', 'lyon',
      '塞維亞', '塞维利亚', 'seville',
      '瓦倫西亞', 'valencia',
      '波爾圖', 'porto',
      '札格雷布', '萨格勒布', 'zagreb',
      '盧布爾雅那', 'ljubljana',
      '塔林', 'tallinn',
      '里加', 'riga',
      '維爾紐斯', 'vilnius'
    ];
    var pp = kwPrep(dest);
    function hit(list) {
      for (var i = 0; i < list.length; i++) if (kwHit(pp, list[i])) return true;
      return false;
    }
    var hasSch = hit(sch);
    if (!hasSch) return false;
    // 若同時只有非申根字樣、沒有真正申根國（理論上 hasSch 已排除），仍回 true
    // 特殊：目的地「僅」為非申根時 hasSch 應為 false；「法國＋英國」→ true
    return true;
  }

  /**
   * 台灣國內地點偵測（國內旅遊不適用海外旅平險）。
   * 只比對完整地名（不比對單字「台」），英文用單字邊界（避免 Matsu 誤中日本 Matsumoto／Matsuyama）。
   * 先排除已知外國同名詞：東京「台東區」、舊金山「金門大橋／金門公園」。
   * 回傳命中的關鍵字（字串），沒命中回傳 ''。
   */
  var DOMESTIC_WARNING = '⚠ 台灣／金門／馬祖／澎湖等屬國內旅遊，不適用海外旅平險，請輸入正確的出國目的地國家';
  var DOMESTIC_ZH = [
    // 國名
    '台灣', '臺灣', '台湾', '臺湾', '中華民國', '中华民国',
    // 離島
    '金門', '金门', '馬祖', '马祖', '澎湖', '綠島', '绿岛', '蘭嶼', '兰屿', '小琉球',
    '連江', '连江', '東引', '东引', '南竿', '北竿',
    // 縣市（繁＋簡）
    '台北', '臺北', '新北', '桃園', '桃园', '台中', '臺中', '台南', '臺南', '高雄', '基隆',
    '新竹', '苗栗', '彰化', '南投', '雲林', '云林', '嘉義', '嘉义', '屏東', '屏东',
    '宜蘭', '宜兰', '花蓮', '花莲', '台東', '臺東', '台东'
  ];
  var DOMESTIC_EN = /\b(taiwan|taipei|new taipei|kaohsiung|taichung|tainan|taoyuan|keelung|hsinchu|miaoli|changhua|nantou|yunlin|chiayi|pingtung|yilan|hualien|taitung|kinmen|matsu|penghu|lienchiang)\b/i;
  // 外國同名詞：先移除再比對
  var DOMESTIC_EXCLUDE = [
    '台東區', '台东区', '台東区', '臺東區',           // 東京都台東區（淺草／上野）
    '金門大橋', '金门大桥', '金門大桥', '金門橋', '金门桥', '金門公園', '金门公园' // 舊金山 Golden Gate
  ];
  function detectDomestic(dest) {
    var t = String(dest || '').trim();
    if (!t) return '';
    for (var e = 0; e < DOMESTIC_EXCLUDE.length; e++) t = t.split(DOMESTIC_EXCLUDE[e]).join(' ');
    t = t.replace(/golden\s+gate/ig, ' ');
    for (var i = 0; i < DOMESTIC_ZH.length; i++) if (t.indexOf(DOMESTIC_ZH[i]) >= 0) return DOMESTIC_ZH[i];
    var m = DOMESTIC_EN.exec(t);
    return m ? m[1] : '';
  }

  global.TQ = {
    LIFE_PRODUCT: LIFE_PRODUCT, PROPERTY_PRODUCT: PROPERTY_PRODUCT,
    LIFE_OH1_RATIO: LIFE_OH1_RATIO, PROP_RATIO: PROP_RATIO, REGION_OPTIONS: REGION_OPTIONS,
    num: num, isSet: isSet, comma: comma, fmtYuan: fmtYuan, fmtShort: fmtShort,
    guessRegionPct: guessRegionPct, regionInfo: regionInfo, regionLabel: regionLabel, REGION_LABEL: REGION_LABEL,
    LIFE_COMBOS: LIFE_COMBOS, lifeCombo: lifeCombo, defaultOh1MrWan: defaultOh1MrWan,
    transportLine: transportLine, regionChipText: regionChipText, lifeExtraItems: lifeExtraItems,
    textHasKeyword: textHasKeyword, computePlan: computePlan,
    fmtDate: fmtDate, daysInclusive: daysInclusive, parseDateParts: parseDateParts,
    periodHtml: periodHtml, DAY_RULE: DAY_RULE, DAY_RULE_FR6: DAY_RULE_FR6, addDays: addDays, parseTime: parseTime, fmtTime: fmtTime, periodDays: periodDays, quotePeriodDays: quotePeriodDays, fmtDateTime: fmtDateTime, periodText: periodText,
    encodeQuote: encodeQuote, decodeHash: decodeHash, shareUrl: shareUrl,
    findPropertyPreset: findPropertyPreset, resolvePropertyPreset: resolvePropertyPreset, lookupPropertyPremium: lookupPropertyPremium,
    detectSchengen: detectSchengen,
    detectDomestic: detectDomestic, DOMESTIC_WARNING: DOMESTIC_WARNING,
    AGE_BANDS: AGE_BANDS, ageInfo: ageInfo, isChildQuote: isChildQuote, childOh1Wan: childOh1Wan,
    CHILD_MRC_WAN: CHILD_MRC_WAN, CHILD_OH1_OPTIONS: CHILD_OH1_OPTIONS, propertyAgeCheck: propertyAgeCheck,
    BRAND: BRAND, renderBrand: renderBrand, DEFAULT_AGENT: DEFAULT_AGENT, agentOf: agentOf, telHref: telHref,
    bracket: bracket, deathSplit: deathSplit, brandLogoReady: function () { return brandLogoReady; },
    renderQuote: renderQuote, renderPlanCard: renderPlanCard, titleFor: titleFor, esc: esc,
    PLAN_KINDS: PLAN_KINDS, isMedPlus: isMedPlus, protectionKey: protectionKey, bestProtectionIndex: bestProtectionIndex, PLAN_KIND_LABEL: PLAN_KIND_LABEL, AUTO_TAGLINE: AUTO_TAGLINE, planKind: planKind, planTierText: planTierText,
    autoPlanName: autoPlanName, nameIsAuto: nameIsAuto, taglineIsAuto: taglineIsAuto, planName: planName, planTagline: planTagline,
    resolvePlanNames: resolvePlanNames, uniformKind: uniformKind,
    splitPlanName: splitPlanName, priceInfo: priceInfo, priceHtml: priceHtml, compareData: compareData, compareTableHtml: compareTableHtml,
    heroTagText: heroTagText, heroBadgesHtml: heroBadgesHtml, agentParts: agentParts, disclaimerText: disclaimerText, companiesText: companiesText
  };
})(window);
