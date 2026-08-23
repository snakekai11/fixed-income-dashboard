/* 资金面日报前端：读取 ../data/latest.json，渲染日报表格与走势图 */
(function () {
  const $ = (s) => document.querySelector(s);
  const charts = [];
  if (window.Chart) Chart.defaults.font.family = '"Times New Roman", "KaiTi", "STKaiti", serif';

  function fmt(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '<span class="na">—</span>';
    return v.toFixed(digits === undefined ? 2 : digits);
  }
  // 负数用红色括号，与样例日报一致
  function fmtSigned(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '<span class="na">—</span>';
    if (v < 0) return `<span class="neg">(${Math.abs(v).toFixed(digits === undefined ? 2 : digits)})</span>`;
    return v.toFixed(digits === undefined ? 2 : digits);
  }
  function lastVal(points) { return points.length ? points[points.length - 1].value : null; }
  function prevVal(points) { return points.length > 1 ? points[points.length - 2].value : null; }

  function rateTable(group) {
    const sers = group.series.filter((s) => s.points.length);
    if (!sers.length) return '<p class="na" style="padding:6px 2px">暂无数据</p>';
    const head = sers.map((s) => `<th>${s.label}</th>`).join('');
    const rowLatest = sers.map((s) => `<td class="num">${fmt(lastVal(s.points))}</td>`).join('');
    const rowBp = sers.map((s) => {
      const a = lastVal(s.points), b = prevVal(s.points);
      const bp = a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) ? (a - b) * 100 : null;
      return `<td class="num">${fmtSigned(bp)}</td>`;
    }).join('');
    return `<div style="overflow-x:auto"><table class="grid">
      <thead><tr><th style="text-align:left">${group.title}</th>${head}</tr></thead>
      <tbody>
        <tr><th>加权利率(%)</th>${rowLatest}</tr>
        <tr><th>较上一交易日变化(BP)</th>${rowBp}</tr>
      </tbody></table></div>`;
  }

  function buildTables(data) {
    const g = data.groups || {};
    const repoParts = [];
    if (g.repo_r?.series.some((s) => s.points.length)) repoParts.push(rateTable(g.repo_r));
    if (g.repo_dr?.series.some((s) => s.points.length)) repoParts.push(rateTable(g.repo_dr));
    $('#repo-tables').innerHTML = repoParts.join('<div style="height:18px"></div>');
    $('#shibor-table').innerHTML = g.shibor ? rateTable(g.shibor) : '';
    $('#ibo-table').innerHTML = g.ibo ? rateTable(g.ibo) : '';
    const exParts = [];
    if (g.exchange) {
      const gc = { ...g.exchange, series: g.exchange.series.filter((s) => s.label.startsWith('GC')) };
      const rs = { ...g.exchange, series: g.exchange.series.filter((s) => !s.label.startsWith('GC')) };
      if (gc.series.length) exParts.push(rateTable(gc));
      if (rs.series.length) exParts.push(rateTable(rs));
    }
    $('#exchange-table').innerHTML = exParts.join('<div style="height:18px"></div>');
  }

  function buildBondMarket(data) {
    const market = data.bondMarket || {};
    const tenors = market.tenors || [];
    const curves = market.curves || [];
    const secondary = market.secondary || [];
    const futures = market.futures || [];
    const sign = (value, digits = 2) => value > 0 ? '<span class="market-up">+' + value.toFixed(digits) + '</span>' : value < 0 ? '<span class="market-down">' + value.toFixed(digits) + '</span>' : value.toFixed(digits);
    $('#yield-matrix').innerHTML = curves.length ? '<div class="yield-screen"><div class="yield-grid"><div class="yield-head">券种 / 期限</div>' + tenors.map((tenor) => '<div class="yield-head">' + tenor + '</div>').join('') + curves.map((curve) => '<div class="yield-label">' + curve.label + '</div>' + curve.points.map((point) => { const cls = point.changeBp > 0 ? 'up' : point.changeBp < 0 ? 'down' : ''; return '<div class="yield-cell ' + cls + '"><span class="yield-value">' + (point.value == null ? '—' : point.value.toFixed(4)) + '</span><span class="yield-change">' + (point.changeBp == null ? '—' : (point.changeBp > 0 ? '+' : '') + point.changeBp.toFixed(2) + ' BP') + '</span></div>'; }).join('')).join('') + '</div></div><p class="yield-asof">中债收益率曲线 · ' + curves[0].date + '</p>' : '';
    $('#bond-secondary').innerHTML = secondary.length ? '<div style="overflow-x:auto"><table class="grid"><thead><tr><th>债券</th><th>剩余期限</th><th>最新收益率(%)</th><th>加权收益率(%)</th><th>变化(BP)</th><th>成交额(亿元)</th></tr></thead><tbody>' + secondary.map((row) => '<tr><th>' + row.name + '<small class="bond-code">' + row.code + '</small></th><td>' + row.tenor + '</td><td class="num">' + row.yield.toFixed(4) + '</td><td class="num">' + row.weightedYield.toFixed(4) + '</td><td class="num">' + sign(row.changeBp) + '</td><td class="num">' + row.volume.toFixed(2) + '</td></tr>').join('') + '</tbody></table></div>' : '';
    $('#bond-futures').innerHTML = futures.length ? '<div style="overflow-x:auto"><table class="grid"><thead><tr><th>合约</th><th>最新价</th><th>较开盘</th><th>最高</th><th>最低</th><th>成交量</th><th>持仓量</th></tr></thead><tbody>' + futures.map((row) => '<tr><th>' + row.code + '<small class="bond-code">' + row.tenor + '期连续</small></th><td class="num">' + row.last.toFixed(3) + '</td><td class="num">' + sign(row.change, 3) + '</td><td class="num">' + row.high.toFixed(3) + '</td><td class="num">' + row.low.toFixed(3) + '</td><td class="num">' + row.volume.toLocaleString('zh-CN') + '</td><td class="num">' + row.openInterest.toLocaleString('zh-CN') + '</td></tr>').join('') + '</tbody></table></div>' : '';
  }

  function buildMacroNews(data) {
    const news = data.macroNews || [];
    const filters = ['全部', '国内', '海外', '央行政策'];
    const filtersEl = $('#news-filters');
    const listEl = $('#macro-news');
    let current = '全部';
    function render() {
      const rows = current === '全部' ? news : news.filter((item) => item.tags.includes(current));
      listEl.innerHTML = '<div class="news-list">' + rows.map((item, index) => '<article class="news-item"><div class="news-rank">' + String(index + 1).padStart(2, '0') + '</div><div><a class="news-title" href="' + item.url + '" target="_blank" rel="noopener noreferrer">' + item.title + '</a>' + (item.summary ? '<p class="news-summary">' + item.summary + '</p>' : '') + '<div class="news-tags">' + item.tags.map((tag) => '<span class="news-tag">' + tag + '</span>').join('') + '</div></div><div class="news-meta">' + item.source + '<br>' + new Date(item.publishedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + '</div></article>').join('') + '</div>';
    }
    filtersEl.innerHTML = '';
    for (const filter of filters) {
      const button = document.createElement('button');
      button.className = 'news-filter' + (filter === current ? ' active' : '');
      button.textContent = filter;
      button.onclick = () => { current = filter; filtersEl.querySelectorAll('.news-filter').forEach((el) => el.classList.toggle('active', el === button)); render(); };
      filtersEl.appendChild(button);
    }
    render();
  }

  const PALETTE = ['#2e4260', '#c00000', '#3b6ea5', '#2e8b57', '#b8860b', '#7b5ea7', '#c25e5e', '#4a7d7c'];

  function chartsAvailable() {
    if (window.Chart) return true;
    document.querySelectorAll('.chart-wrap').forEach((el) => {
      el.innerHTML = '<p class="na" style="padding:10px 2px">图表库未加载（本地 chart.umd.min.js 缺失且无法访问 CDN），表格数据不受影响。</p>';
    });
    return false;
  }
  function buildOmo(data) {
    const omo = data.groups?.omo;
    const detail = data.omoDetail;
    const textEl = $('#omo-text');
    if (data.omoText) {
      textEl.innerHTML = data.omoText.replace(/净(投放|回笼)([\d.]+)亿元/, (m, w, n) => `${w}<strong>${n}</strong>亿元`);
    } else {
      textEl.textContent = '暂无公开市场操作数据。';
    }
    const structure = $('#omo-structure');
    if (detail) {
      const rows = (items, empty) => items.length ? items.map((item) => '<div class="omo-row"><strong>' + item.instrument + (item.tenorLabel ? ' · ' + item.tenorLabel : '') + '</strong><span class="rate">' + (item.rate == null ? '利率 —' : '利率 ' + item.rate.toFixed(2) + '%') + '</span><span class="amount">' + item.amount.toLocaleString('zh-CN') + ' 亿元</span></div>').join('') : '<div class="omo-row"><span class="na">' + empty + '</span></div>';
      const netClass = detail.net > 0 ? 'net-positive' : detail.net < 0 ? 'net-negative' : '';
      structure.innerHTML = '<div class="omo-summary"><div class="omo-metric"><span>当日投放</span><strong>' + detail.injection.toLocaleString('zh-CN') + ' 亿元</strong></div><div class="omo-metric"><span>当日到期</span><strong>' + detail.maturity.toLocaleString('zh-CN') + ' 亿元</strong></div><div class="omo-metric ' + netClass + '"><span>净投放 / 净回笼</span><strong>' + (detail.net >= 0 ? '+' : '') + detail.net.toLocaleString('zh-CN') + ' 亿元</strong></div></div><div class="omo-columns"><div class="omo-column"><h3>投放结构</h3>' + rows(detail.operations, '当日无投放') + '</div><div class="omo-column"><h3>到期结构</h3>' + rows(detail.maturities, '当日无到期') + '</div></div><p class="omo-note">投放数据来自人民银行当日公告；到期数据根据人民银行历史操作公告、期限及后续操作日推算。</p>';
    } else { structure.innerHTML = ''; }
    if (!omo || !omo.series.length) { $('#omo-chart').closest('.chart-wrap').style.display = 'none'; return; }
    const labelSet = new Map();
    for (const s of omo.series) for (const p of s.points) if (!labelSet.has(p.date)) labelSet.set(p.date, true);
    const labels = [...labelSet.keys()].sort();
    const datasets = omo.series.filter((s) => s.points.length).map((s, i) => {
      const m = new Map(s.points.map((p) => [p.date, p.value]));
      return {
        label: s.label,
        data: labels.map((d) => (m.has(d) ? m.get(d) : null)),
        backgroundColor: PALETTE[i % PALETTE.length] + 'cc',
        borderColor: PALETTE[i % PALETTE.length],
        borderWidth: 1,
      };
    });
    charts.push(new Chart($('#omo-chart'), {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { x: { ticks: { maxTicksLimit: 12, autoSkip: true } }, y: { title: { display: true, text: omo.unit || '亿元' } } },
        plugins: { legend: { position: 'bottom' } },
      },
    }));
  }

  function buildTrend(data) {
    const rateGroups = ['repo_r', 'repo_dr', 'shibor', 'ibo', 'exchange'];
    const series = [];
    for (const gid of rateGroups) {
      const g = data.groups?.[gid];
      if (!g) continue;
      for (const s of g.series) if (s.points.length > 1) series.push({ gid, label: s.label, points: s.points });
    }
    const chipsEl = $('#trend-chips');
    const active = new Set();
    // 默认选 DR007、R007、Shibor O/N
    ['DR007', 'R007', 'O/N'].forEach((want) => {
      const hit = series.find((s) => s.label === want);
      if (hit) active.add(hit.gid + '|' + hit.label);
    });
    if (!active.size && series.length) active.add(series[0].gid + '|' + series[0].label);

    if (!chartsAvailable()) return;
    function render() {
      const chosen = series.filter((s) => active.has(s.gid + '|' + s.label));
      const labelSet = new Set();
      for (const s of chosen) for (const p of s.points) labelSet.add(p.date);
      const labels = [...labelSet].sort();
      const datasets = chosen.map((s, i) => {
        const m = new Map(s.points.map((p) => [p.date, p.value]));
        return {
          label: s.label,
          data: labels.map((d) => (m.has(d) ? m.get(d) : null)),
          borderColor: PALETTE[i % PALETTE.length],
          backgroundColor: PALETTE[i % PALETTE.length],
          borderWidth: 2, pointRadius: 0, tension: 0.15, spanGaps: true,
        };
      });
      const old = charts.find((c) => c.canvas && c.canvas.id === 'trend-chart');
      if (old) old.destroy();
      charts.push(new Chart($('#trend-chart'), {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: { x: { ticks: { maxTicksLimit: 10, autoSkip: true } }, y: { title: { display: true, text: '%' } } },
          plugins: { legend: { position: 'bottom' } },
        },
      }));
    }
    chipsEl.innerHTML = '';
    for (const s of series) {
      const id = s.gid + '|' + s.label;
      const b = document.createElement('button');
      b.className = 'chip' + (active.has(id) ? ' active' : '');
      b.textContent = s.label;
      b.onclick = () => {
        if (active.has(id)) active.delete(id); else active.add(id);
        b.classList.toggle('active');
        render();
      };
      chipsEl.appendChild(b);
    }
    render();
  }

  function showNotices(data) {
    const slot = $('#notice-slot');
    const parts = [];
    if (data.status === 'sample') {
      parts.push('<div class="notice info">当前展示的是<b>示例数据</b>（2026-08-21）。配置 Wind API Key 后，运行 <code>node scripts/fetch_data.mjs</code> 即可切换为每日真实数据。</div>');
    } else if (data.status === 'needs_key') {
      parts.push('<div class="notice warn"><b>WIND_API_KEY 未配置</b>，无法自动取数。请双击运行项目根目录的 <code>配置WindKey.cmd</code>，按提示粘贴 Key 完成配置。</div>');
    } else if (data.status === 'partial' || data.status === 'error') {
      parts.push(`<div class="notice warn">部分数据更新失败：${(data.messages || []).join('；')}</div>`);
    }
    slot.innerHTML = parts.join('');
  }

  async function boot() {
    while (charts.length) { try { charts.pop().destroy(); } catch {} }
    let data;
    try {
      const res = await fetch('../data/latest.json?_=' + Date.now());
      data = await res.json();
    } catch (e) {
      $('#notice-slot').innerHTML = '<div class="notice warn">未找到 <code>data/latest.json</code>。请通过 <code>启动网站.cmd</code> 访问本站，或先运行取数脚本。</div>';
      return;
    }
    $('#trade-date').textContent = data.tradeDate || '';
    const meta = [];
    if (data.updatedAt) meta.push('更新于 ' + new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }));
    if (data.status === 'ok') meta.push('每日自动更新（11:40 / 17:45）');
    $('#meta-line').innerHTML = meta.map((m) => `<span>${m}</span>`).join('');
    $('#source-badge').textContent = data.source || '公开数据源';
    $('#footer-source').textContent = `${data.source || '公开数据源'} · 页面仅作信息展示，不构成投资建议。`;
    showNotices(data);
    buildOmo(data);
    buildTables(data);
    buildBondMarket(data);
    buildMacroNews(data);
    buildTrend(data);
  }
  document.querySelectorAll('.sheet-tab').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('.sheet-tab, .sheet').forEach((el) => el.classList.remove('active'));
    tab.classList.add('active');
    document.querySelector('#sheet-' + tab.dataset.sheet).classList.add('active');
    document.querySelector('.masthead h1').textContent = tab.dataset.sheet === 'bonds' ? '债券行情综合屏' : tab.dataset.sheet === 'news' ? '近期宏观资讯' : '货币市场行情';
  }));
  document.querySelector('#refresh-btn')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = '↻ 同步中…';
    try {
      const response = await fetch('/api/refresh', { method: 'POST' });
      if (!response.ok && response.status !== 404) throw new Error('refresh unavailable');
    } catch {} finally {
      await boot();
      b.disabled = false;
      b.textContent = '↻ 同步最新数据';
    }
  });
  boot();
})();
