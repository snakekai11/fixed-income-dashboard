// 免费公开源更新器。交易所回购实时行情：新浪优先，东方财富备用。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const latestPath = path.join(ROOT, 'data', 'latest.json');
const historyDir = path.join(ROOT, 'data', 'history');
const omoHistoryPath = path.join(ROOT, 'data', 'pbc-omo-history.json');
const payload = JSON.parse(readFileSync(latestPath, 'utf8'));
const messages = [];
const refreshed = [];
const timeoutMs = 12000;
const chinaMoneyHeaders = { Referer: 'https://www.chinamoney.com.cn/', 'User-Agent': 'Mozilla/5.0' };

const contracts = [
  { label: 'GC001', sina: 'sh204001', eastmoney: '1.204001' },
  { label: 'GC007', sina: 'sh204007', eastmoney: '1.204007' },
  { label: 'GC014', sina: 'sh204014', eastmoney: '1.204014' },
  { label: 'GC028', sina: 'sh204028', eastmoney: '1.204028' },
  { label: 'R-001', sina: 'sz131810', eastmoney: '0.131810' },
  { label: 'R-007', sina: 'sz131801', eastmoney: '0.131801' },
  { label: 'R-014', sina: 'sz131802', eastmoney: '0.131802' },
  { label: 'R-028', sina: 'sz131803', eastmoney: '0.131803' },
];

async function request(url, headers = {}) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response;
}

async function fromSina(contract) {
  const response = await request('https://hq.sinajs.cn/list=' + contract.sina, {
    Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0',
  });
  const match = (await response.text()).match(/="([^\"]*)"/);
  const fields = match?.[1]?.split(',');
  const value = Number(fields?.[3]);
  if (!Number.isFinite(value) || !fields?.[30]) throw new Error('invalid payload');
  return { value, date: fields[30], source: '新浪公开行情' };
}

async function fromEastmoney(contract) {
  const url = 'https://push2.eastmoney.com/api/qt/stock/get?secid=' + contract.eastmoney + '&fields=f43,f58,f57';
  const response = await request(url, { Referer: 'https://quote.eastmoney.com', 'User-Agent': 'Mozilla/5.0' });
  const data = (await response.json()).data;
  const value = Number(data?.f43) / 1000;
  if (!Number.isFinite(value)) throw new Error('invalid payload');
  return { value, date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }), source: '东方财富公开行情' };
}

async function updateBondMarkets() {
  const bondUrl = 'https://www.chinamoney.com.cn/ags/ms/cm-u-md-bond/CbtPri?lang=cn&flag=1&bondName=';
  const bondJson = await (await request(bondUrl, chinaMoneyHeaders)).json();
  const governmentBonds = (bondJson.records || [])
    .filter(row => /国债/.test(String(row.abdAssetEncdFullDescByRmb || row.abdAssetEncdShrtDesc || '')))
    .map(row => ({
      code: row.bondcode,
      name: row.abdAssetEncdFullDescByRmb || row.abdAssetEncdShrtDesc,
      tenor: row.termToMaturity,
      yield: Number(row.dmiLatestContraRate),
      weightedYield: Number(row.dmiWghtdContraRate),
      changeBp: Number(row.bpNum ?? row.bp),
      volume: Number(row.dmiTtlTradedAmnt),
      time: row.showDate,
    }))
    .filter(row => Number.isFinite(row.yield) && Number.isFinite(row.volume))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 12);

  const curveEnd = String(governmentBonds[0]?.time || new Date().toISOString()).slice(0, 10);
  const startDate = new Date(curveEnd + 'T00:00:00+08:00');
  startDate.setDate(startDate.getDate() - 7);
  const curveStart = startDate.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const curveUrl = 'https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/historyQuery?startDate=' + curveStart + '&endDate=' + curveEnd + '&gjqx=0&qxId=ycqx&locale=cn_ZH';
  const curveHtml = await (await request(curveUrl, { 'User-Agent': 'Mozilla/5.0' })).text();
  const curveRows = [...curveHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map(match => [...match[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(cell => cell[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())).filter(cells => cells.length >= 10 && /^20\d{2}-/.test(cells[1] || ''));
  const names = { '中债国债收益率曲线': '国债', '中债商业银行普通债收益率曲线(AAA)': '银行债 AAA', '中债中短期票据收益率曲线(AAA)': 'AAA 中票' };
  const tenors = ['3M', '6M', '1Y', '3Y', '5Y', '7Y', '10Y', '30Y'];
  const curves = [];
  for (const [fullName, label] of Object.entries(names)) {
    const rows = curveRows.filter(row => row[0] === fullName).sort((a, b) => a[1].localeCompare(b[1])).slice(-2);
    if (!rows.length) continue;
    const latest = rows.at(-1);
    const previous = rows.length > 1 ? rows.at(-2) : null;
    curves.push({ label, date: latest[1], points: tenors.map((tenor, index) => { const raw = latest[index + 2]; const prevRaw = previous?.[index + 2]; const value = raw === '' ? null : Number(raw); const prev = prevRaw === '' || prevRaw == null ? null : Number(prevRaw); return { tenor, value: Number.isFinite(value) ? value : null, changeBp: Number.isFinite(value) && Number.isFinite(prev) ? (value - prev) * 100 : null }; }) });
  }

  const futures = [];
  for (const [code, symbol, tenor] of [['TS', 'nf_TS0', '2年'], ['TF', 'nf_TF0', '5年'], ['T', 'nf_T0', '10年'], ['TL', 'nf_TL0', '30年']]) {
    const response = await request('https://hq.sinajs.cn/list=' + symbol, { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' });
    const fields = (await response.text()).match(/="([^\"]*)"/)?.[1]?.split(',') || [];
    const open = Number(fields[0]);
    const last = Number(fields[3]);
    if (!Number.isFinite(last)) continue;
    futures.push({ code, tenor, name: fields.at(-1) || tenor + '期国债期货连续', last, open, change: last - open, high: Number(fields[1]), low: Number(fields[2]), volume: Number(fields[4]), openInterest: Number(fields[6]), date: fields[36], time: fields[37] });
  }
  payload.bondMarket = { updatedAt: new Date().toISOString(), tenors, curves, secondary: governmentBonds, futures };
  if (governmentBonds.length) refreshed.push({ label: '债市二级', date: String(governmentBonds[0].time).slice(0, 10), source: '中国货币网现券成交行情' });
  if (futures.length) refreshed.push({ label: '国债期货', date: futures[0].date, source: '新浪公开行情' });
}

function classifyNews(text) {
  const overseas = /美联储|美国|美债|道指|标普|纳指|欧洲|欧元|英国|日本|韩国|印度|美元|海外|全球|俄乌|中东|关税|特朗普|Fed|ECB/i.test(text);
  const policy = /央行|人民银行|美联储|财政|国务院|利率|降息|加息|准备金|MLF|LPR|货币政策|财政政策/i.test(text);
  return policy ? (overseas ? ['海外', '央行政策'] : ['国内', '央行政策']) : [overseas ? '海外' : '国内'];
}

function scoreNews(text, timestamp) {
  const weights = [
    [/央行|美联储|人民银行|国务院|财政部|统计局|发改委/, 8],
    [/利率|降息|加息|准备金|货币政策|财政政策|国债|汇率|人民币|美元/, 6],
    [/GDP|CPI|PPI|PMI|通胀|就业|非农|社融|信贷|进出口|贸易|关税/, 5],
    [/地产|房地产|楼市|消费|投资|工业|经济|债务|地缘|冲突|制裁/, 3],
  ];
  let score = 0;
  for (const [pattern, weight] of weights) if (pattern.test(text)) score += weight;
  const ageHours = Math.max(0, (Date.now() / 1000 - timestamp) / 3600);
  return score + Math.max(0, 4 - ageHours / 12);
}

const stockNewsPattern = /个股|股票|股价|涨停|跌停|目标价|买入|增持|减持|评级|财报|中报|半年报|年报|净利润|营收|IPO|上市公司|公司公告|收购|股权|董事长|股东会|临时股东|投资者关系|机构调研|券商直面|基金经理|停牌|成交额前|收高\d|股份|控股|集团公告|公司拟|公司将/;

function cleanNewsText(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
}

function addMacroNews(all, row) {
  const title = cleanNewsText(row.title);
  const summary = cleanNewsText(row.summary);
  const text = title + ' ' + summary;
  const timestamp = Number(row.timestamp || 0);
  const score = scoreNews(text, timestamp);
  if (!title || !row.url || stockNewsPattern.test(text) || !Number.isFinite(timestamp) || score < 3) return;
  all.push({ title, summary: summary.slice(0, 150), url: row.url, source: row.source, publishedAt: new Date(timestamp * 1000).toISOString(), timestamp, tags: classifyNews(text), score });
}

function clsSign(params) {
  const input = Object.keys(params)
    .sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase()))
    .map(key => key + '=' + params[key])
    .join('&');
  const sha1 = createHash('sha1').update(input).digest('hex');
  return createHash('md5').update(sha1).digest('hex');
}

async function updateMacroNews() {
  const feeds = [
    { lid: 2516, source: '新浪财经' },
    { lid: 2517, source: '新浪财经' },
    { lid: 2518, source: '新浪财经' },
  ];
  const all = [];
  const activeSources = new Set();
  for (const feed of feeds) {
    try {
      const url = 'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=' + feed.lid + '&num=50&page=1';
      const json = await (await request(url, { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' })).json();
      for (const row of json.result?.data || []) addMacroNews(all, { title: row.title, summary: row.intro || row.summary, url: String(row.url || '').replace(/\\\//g, '/'), source: feed.source, timestamp: row.ctime || row.intime });
      activeSources.add(feed.source);
    } catch (error) {
      messages.push('新浪财经资讯更新失败：' + error.message);
    }
  }

  try {
    let lastTime = Math.floor(Date.now() / 1000);
    for (let page = 0; page < 10; page += 1) {
      const params = { refresh_type: 1, rn: 20, last_time: lastTime, os: 'web', sv: '8.7.9', app: 'CailianpressWeb' };
      const url = 'https://www.cls.cn/v1/roll/get_roll_list?' + new URLSearchParams({ ...params, sign: clsSign(params) });
      const json = await (await request(url, { Referer: 'https://www.cls.cn/telegraph', 'User-Agent': 'Mozilla/5.0' })).json();
      const rows = json.data?.roll_data || [];
      if (!rows.length) break;
      for (const row of rows) {
        if (Array.isArray(row.stock_list) && row.stock_list.length) continue;
        const content = cleanNewsText(row.content || row.brief);
        const bracketTitle = content.match(/^【([^】]+)】/)?.[1];
        const title = cleanNewsText(row.title || bracketTitle || content.slice(0, 46));
        const summary = bracketTitle ? content.replace(/^【[^】]+】/, '') : content;
        addMacroNews(all, { title, summary, url: 'https://www.cls.cn/detail/' + row.id, source: '财联社', timestamp: row.ctime });
      }
      lastTime = Number(rows.at(-1).ctime);
    }
    activeSources.add('财联社');
  } catch (error) {
    messages.push('财联社资讯更新失败：' + error.message);
  }
  for (const item of payload.macroNews || []) {
    if (!activeSources.has(item.source)) all.push(item);
  }
  const unique = new Map();
  for (const item of all) {
    const key = item.title.replace(/[，。！？：；、\s]/g, '').slice(0, 48);
    if (!unique.has(key)) unique.set(key, item);
  }
  const sourceCounts = new Map();
  payload.macroNews = [...unique.values()]
    .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
    .filter(item => { const count = sourceCounts.get(item.source) || 0; sourceCounts.set(item.source, count + 1); return count < 18; })
    .slice(0, 30);
  if (payload.macroNews.length && activeSources.size) refreshed.push({ label: '宏观资讯', date: payload.macroNews[0].publishedAt.slice(0, 10), source: [...activeSources].map(name => name + '公开资讯').join(' / ') });
}

function upsertSeries(groupId, label, points, source) {
  const series = payload.groups?.[groupId]?.series?.find(item => item.label === label);
  if (!series || !points.length) return;
  series.points = points.slice(-40);
  refreshed.push({ label, date: points.at(-1).date, source });
}

async function updateShibor() {
  const start = new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  const url = 'https://www.chinamoney.com.cn/ags/ms/cm-u-bk-shibor/ShiborHis?lang=CN&startDate=' + start + '&endDate=' + end;
  const json = await (await request(url, chinaMoneyHeaders)).json();
  const records = Array.isArray(json.records) ? json.records.slice().reverse() : [];
  const map = { 'O/N': 'ON', '1W': '1W', '2W': '2W', '1M': '1M', '3M': '3M' };
  for (const [label, field] of Object.entries(map)) {
    const points = records.map(row => ({ date: row.showDateCN, value: Number(row[field]) })).filter(point => point.date && Number.isFinite(point.value));
    upsertSeries('shibor', label, points, '中国货币网 Shibor 官方数据');
  }
}

function parseChinaMoneyCsv(text, labels) {
  const points = Object.fromEntries(labels.map(label => [label, []]));
  for (const raw of text.trim().split(/\r?\n/)) {
    const cells = raw.replace(/\r/g, '').split(',');
    const date = cells[0]?.trim();
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) continue;
    const values = cells.slice(-labels.length);
    labels.forEach((label, index) => {
      const value = Number(values[index]);
      if (Number.isFinite(value)) points[label].push({ date, value });
    });
  }
  for (const label of labels) points[label].sort((a, b) => a.date.localeCompare(b.date));
  return points;
}

async function updateChinaMoneyMarket() {
  const base = 'https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/currency/';
  const configs = [
    { group: 'repo_dr', csv: 'prr-chrt.csv', json: 'prr-md.json', labels: ['DR001', 'DR007', 'DR014'] },
    { group: 'ibo', csv: 'iblr-chrt.csv', json: 'iblr-md.json', labels: ['IBO001', 'IBO007', 'IBO014'] },
  ];
  for (const config of configs) {
    const csv = await (await request(base + config.csv, chinaMoneyHeaders)).text();
    const history = parseChinaMoneyCsv(csv, config.labels);
    for (const label of config.labels) upsertSeries(config.group, label, history[label], '中国货币网货币市场行情');
    const latest = await (await request(base + config.json, chinaMoneyHeaders)).json();
    const date = String(latest.data?.showDateCN || '').slice(0, 10);
    for (const row of latest.records || []) {
      const label = String(row.productCode || '').replace(/^D(?=IBO)/, '');
      const series = payload.groups?.[config.group]?.series?.find(item => item.label === label);
      const value = Number(row.weightedRate);
      if (!series || !date || !Number.isFinite(value)) continue;
      series.points = series.points.filter(point => point.date !== date);
      series.points.push({ date, value });
      series.points.sort((a, b) => a.date.localeCompare(b.date));
      series.points = series.points.slice(-40);
      if (!refreshed.some(item => item.label === label && item.date === date)) refreshed.push({ label, date, source: '中国货币网货币市场行情' });
    }
  }
  // These tenors are not published by the official market feed used above.
  for (const [groupId, labels] of [['repo_r', ['R001', 'R007', 'R014', 'R021', 'R1M']], ['repo_dr', ['DR1M']], ['ibo', ['IBO021']]]) {
    for (const label of labels) {
      const series = payload.groups?.[groupId]?.series?.find(item => item.label === label);
      if (series) series.points = [];
    }
  }
}

function htmlToText(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').replace(/(\d)\.\s+(\d)/g, '$1.$2');
}

async function updatePbcOmo() {
  const base = 'http://www.pbc.gov.cn';
  const listing = await (await request(base + '/zhengcehuobisi/125207/125213/125431/125475/index.html', { 'User-Agent': 'Mozilla/5.0' })).text();
  const links = [...listing.matchAll(/href="([^"]+)"[^>]+title="公开市场业务交易公告[^\"]*"/g)].map(match => match[1]);
  if (!links.length) throw new Error('announcement links not found');
  const articles = await Promise.all(links.slice(0, 20).map(async link => htmlToText(await (await request(base + link, { 'User-Agent': 'Mozilla/5.0' })).text())));
  const cachedDays = existsSync(omoHistoryPath) ? JSON.parse(readFileSync(omoHistoryPath, 'utf8')) : [];
  const operationDays = [];
  for (const article of articles) {
    const dateMatch = article.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
    if (!dateMatch) continue;
    const date = dateMatch[1] + '-' + dateMatch[2].padStart(2, '0') + '-' + dateMatch[3].padStart(2, '0');
    const rateByDays = new Map([...article.matchAll(/(\d+)\s*天\s*([\d.]+)\s*%\s*[\d,.]+\s*亿元\s*[\d,.]+\s*亿元/g)].map(match => [Number(match[1]), Number(match[2])]));
    const operations = [];
    const patterns = [
      /开展了?([\d,.]+)亿元(隔夜|\d+天期)(逆回购)操作/g,
      /开展了?([\d,.]+)亿元(\d+个月期|\d+年期)(中期借贷便利|MLF)操作/g,
      /开展了?([\d,.]+)亿元(\d+个月期|\d+天期)?(买断式逆回购)操作/g,
    ];
    for (const pattern of patterns) {
      for (const match of article.matchAll(pattern)) {
        const amount = Number(match[1].replace(/,/g, ''));
        const tenorRaw = match[2] || '';
        const instrument = match[3] === 'MLF' ? '中期借贷便利（MLF）' : match[3];
        const days = tenorRaw === '隔夜' ? 1 : Number(tenorRaw.match(/\d+/)?.[0] || 0);
        const tenorDays = tenorRaw.includes('个月') ? days * 30 : tenorRaw.includes('年') ? days * 365 : days;
        operations.push({ instrument: tenorRaw === '隔夜' ? '隔夜逆回购' : instrument, tenorLabel: tenorRaw === '隔夜' ? '隔夜' : tenorRaw, tenorDays, rate: rateByDays.get(tenorDays) ?? null, amount });
      }
    }
    operationDays.push({ date, operations });
  }
  const dayMap = new Map(cachedDays.map(day => [day.date, day]));
  for (const day of operationDays) dayMap.set(day.date, day);
  operationDays.splice(0, operationDays.length, ...[...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-400));
  writeFileSync(omoHistoryPath, JSON.stringify(operationDays, null, 2));
  const latest = operationDays.at(-1);
  if (!latest) throw new Error('announcement values not found');
  const operatingDates = operationDays.map(day => day.date);
  const maturityMap = new Map(operatingDates.map(date => [date, []]));
  for (const day of operationDays) {
    for (const operation of day.operations) {
      if (!operation.tenorDays) continue;
      const target = new Date(day.date + 'T00:00:00+08:00');
      target.setDate(target.getDate() + operation.tenorDays);
      const targetDate = target.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
      const maturityDate = operatingDates.find(date => date >= targetDate);
      if (maturityDate) maturityMap.get(maturityDate).push({ ...operation, sourceDate: day.date });
    }
  }
  const maturities = maturityMap.get(latest.date) || [];
  const operations = latest.operations.filter(operation => operation.amount > 0);
  const injection = operations.reduce((sum, operation) => sum + operation.amount, 0);
  const maturity = maturities.reduce((sum, operation) => sum + operation.amount, 0);
  const net = injection - maturity;
  const date = latest.date;
  const omo = payload.groups?.omo;
  if (omo) {
    const issue = omo.series.find(item => item.key === 'omo_issue');
    const withdraw = omo.series.find(item => item.key === 'omo_withdraw');
    const netSeries = omo.series.find(item => item.key === 'omo_net');
    const issuePoints = operationDays.map(day => ({ date: day.date, value: day.operations.reduce((sum, operation) => sum + operation.amount, 0) }));
    const maturityPoints = operationDays.map(day => ({ date: day.date, value: (maturityMap.get(day.date) || []).reduce((sum, operation) => sum + operation.amount, 0) }));
    const netPoints = issuePoints.map((point, index) => ({ date: point.date, value: point.value - maturityPoints[index].value }));
    if (issue) issue.points = issuePoints.slice(-40);
    if (withdraw) withdraw.points = maturityPoints.slice(-40);
    if (netSeries) netSeries.points = netPoints.slice(-40);
    payload.omoDetail = { date, operations, maturities, injection, maturity, net };
    const netText = net >= 0 ? '净投放' + net : '净回笼' + Math.abs(net);
    payload.omoText = date.slice(5, 7).replace(/^0/, '') + '月' + date.slice(8).replace(/^0/, '') + '日，公开市场投放' + injection + '亿元、到期' + maturity + '亿元，' + netText + '亿元。';
    refreshed.push({ label: '央行逆回购', date, source: '中国人民银行公开市场业务交易公告' });
  }
}

try { await updateShibor(); } catch (error) { messages.push('Shibor 官方数据更新失败：' + error.message); }
try { await updateChinaMoneyMarket(); } catch (error) { messages.push('银行间货币市场行情更新失败：' + error.message); }
try { await updatePbcOmo(); } catch (error) { messages.push('央行公开市场公告更新失败：' + error.message); }
try { await updateBondMarkets(); } catch (error) { messages.push('债券行情更新失败：' + error.message); }
try { await updateMacroNews(); } catch (error) { messages.push('宏观资讯更新失败：' + error.message); }

for (const contract of contracts) {
  let quote;
  try { quote = await fromSina(contract); }
  catch { try { quote = await fromEastmoney(contract); } catch { messages.push(contract.label + '公开行情暂不可用'); } }
  const series = payload.groups?.exchange?.series?.find(item => item.label === contract.label);
  if (series && quote) {
    series.points = series.points.filter(point => point.date !== quote.date);
    series.points.push({ date: quote.date, value: quote.value });
    series.points.sort((a, b) => a.date.localeCompare(b.date));
    series.points = series.points.slice(-40);
    refreshed.push({ label: contract.label, date: quote.date, source: quote.source });
  }
}

const dates = refreshed.filter(item => !['宏观资讯'].includes(item.label)).map(item => item.date).filter(Boolean).sort();
payload.site = '固收综合看板';
if (dates.length) payload.tradeDate = dates.at(-1);
payload.updatedAt = new Date().toISOString();
payload.status = messages.length ? 'partial' : 'ok';
payload.messages = messages;
payload.source = '中国货币网（Shibor、DR、IBO）· 中国人民银行（公开市场操作）· 新浪 / 东方财富（交易所回购）';
payload.refreshed = refreshed;
mkdirSync(historyDir, { recursive: true });
writeFileSync(latestPath, JSON.stringify(payload, null, 2));
writeFileSync(path.join(historyDir, payload.tradeDate + '.json'), JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ status: payload.status, tradeDate: payload.tradeDate, refreshed, messages }, null, 2));
