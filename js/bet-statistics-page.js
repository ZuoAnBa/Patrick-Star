(() => {
    'use strict';
    const $ = id => document.getElementById(id);
    const money = value => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    const read = (key, fallback = {}) => JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    const example = '大双各10\n合数大的大双各10\n\n老\n小各10\n小单各10\n\n香\n06-30-42-12-24-14-20-40特码各10\n\n特120+80+240+120+80=640';
    const comboExample = '香\n龙--拖--马鸡兔羊牛五肖各10四肖各10\n龙马--拖--鸡兔羊牛猪三肖各20四肖各10五肖各10\n03-27-37-10-16-42-49复三中三各2二中二各4，碰06-30-42-12-24-14特碰各2\n\n7尾100\n龙一肖100\n\n三70+84+84=238\n连150+300=450\n肖100\n尾100';
    const dragExample = '特31，43，26，38各5\n特07，19，02，14各10\n特碰19拖4尾各2\n特碰19拖24.40各5\n复三中三04.06.24.40.44各3\n鼠复特碰各5\n\n特20+40=60\n三10+10+30+30=80';
    const parseOptions = () => ({zodiacYear: Number($('zodiacYear').value)});
    let ledgerBusy = false;
    const el = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    function groupList(type, groups) {
        const holder = el('div', undefined, 'groupList');
        const more = el('button', '显示更多组合');
        let offset = 0;
        function appendBatch() {
            more.remove();
            const batch = groups.slice(offset, offset + 100);
            for (const group of batch) {
                const size = type === 'zodiacLink' ? `${group.values.length}连肖 · ` : '';
                const status = group.hit === undefined ? '' : group.hit === null ? ' · 待结果' : group.hit ? ' · 命中' : ' · 未中';
                const rule = group.rule ? ` · 赔率${group.rule.odds} · 返水${group.rule.rebatePercent}%` : '';
                holder.append(el('div', `${size}${BetSlip.groupLabel(type, group.values)} · ${money(group.amount)}元${status}${rule}`, group.hit ? 'groupItem hitGroup' : 'groupItem'));
            }
            offset += batch.length;
            if (offset < groups.length) { more.textContent = `再显示100组（已显示${offset}/${groups.length}）`; holder.append(more); }
        }
        more.addEventListener('click', appendBatch);
        appendBatch();
        return holder;
    }
    function ensureLedger() {
        if (localStorage.getItem(BetStats.ledgerKey) === null) {
            localStorage.setItem(BetStats.ledgerKey, JSON.stringify(BetStats.migrate(read('BetPanelData'))));
        }
        return read(BetStats.ledgerKey);
    }
    function renderCategoryOverview(report) {
        const table = el('table', undefined, 'categoryTable');
        table.append(el('caption','所选日期 · 玩法分类汇总'));
        const head = el('thead'), header = el('tr');
        for (const label of ['玩法','新澳','老澳','香港','合计 / 计费注数','命中下注额','应赔（含本金）','返水','收单净盈亏']) {
            const th = el('th',label); th.scope = 'col'; header.append(th);
        }
        head.append(header); table.append(head);
        const body = el('tbody');
        const renderRow = (row, total = false) => {
            const tr = el('tr',undefined,total ? 'categoryTotal' : row.child ? 'categoryChild' : '');
            const label = el('th',row.label); label.scope = 'row'; tr.append(label);
            for (const pool of Object.keys(BetStats.pools)) tr.append(el('td',money(row.byPool[pool] || 0)));
            const amount = el('td'); amount.append(el('strong',money(row.total)),el('small',`${row.billedCount}注`)); tr.append(amount);
            const hit = el('td');
            hit.append(el('strong',money(row.hitAmount),row.hitAmount > 0 ? 'hitText' : ''));
            if (row.pendingAmount > 0) hit.append(el('small',`另${money(row.pendingAmount)}元待结果`,'pendingText'));
            tr.append(hit);
            for (const field of ['payout','rebate','bankerProfit']) {
                const cell = el('td',row[field] === null ? '待核算' : money(row[field]),field === 'bankerProfit' && row[field] !== null ? (row[field] < 0 ? 'lossText' : 'hitText') : '');
                if (field === 'payout' && row.payout === null) cell.append(el('small',`已知${money(row.knownPayout)}`));
                if (field === 'rebate' && row.rebate === null) cell.append(el('small',`已知${money(row.knownRebate)}`));
                tr.append(cell);
            }
            if (row.unpricedAmount > 0) label.append(el('small',`${money(row.unpricedAmount)}元规则未设`,'pendingText'));
            return tr;
        };
        for (const row of report.rows) body.append(renderRow(row));
        table.append(body);
        const main = report.rows.filter(row => !row.child);
        const total = {label:'全部玩法',byPool:{},total:0,billedCount:0,hitAmount:0,pendingAmount:0,...report.finance};
        for (const pool of Object.keys(BetStats.pools)) total.byPool[pool] = main.reduce((sum,row)=>sum+Math.round((row.byPool[pool] || 0)*100),0)/100;
        for (const key of ['total','hitAmount','pendingAmount']) total[key] = main.reduce((sum,row)=>sum+Math.round(row[key]*100),0)/100;
        total.billedCount = main.reduce((sum,row)=>sum+row.billedCount,0);
        const foot = el('tfoot'); foot.append(renderRow(total,true)); table.append(foot);
        $('categorySummary').replaceChildren(table);
    }
    function financeMetrics(finance) {
        const holder = el('div',undefined,'metrics financeMetrics');
        for (const [label,field] of [['应赔给别人（含本金）','payout'],['应返给别人（返水）','rebate'],['收单净盈亏','bankerProfit']]) {
            const metric = el('div',label,'metric');
            const value = finance[field];
            metric.append(el('strong',value === null ? '待核算' : `${money(value)} 元`,field === 'bankerProfit' && value !== null ? value < 0 ? 'lossText' : 'hitText' : ''));
            if (value === null && field !== 'bankerProfit') metric.append(el('small',`已知部分 ${money(finance[field === 'payout' ? 'knownPayout' : 'knownRebate'])} 元`));
            holder.append(metric);
        }
        return holder;
    }
    function profitLabel(value) {
        return `收单盈亏 ${value === null ? '待核算' : (value > 0 ? '+' : '') + money(value) + '元'}`;
    }
    function playDetail(play, poolCategories) {
        const type = play.type;
        const detail = el('details', undefined, 'playResult');
        const countLabel = `计费${play.billedCount}组 · 有效${play.groups.length}种`;
        const outcome = play.hitCount === null ? '待完整结果' : `命中${play.hitCount}种 · 命中下注额${money(play.hitAmount)}元`;
        const summary = el('summary', `${play.label} · ${countLabel} · 下注${money(play.total)}元 · ${outcome} · `);
        summary.append(el('span',profitLabel(play.bankerProfit),play.bankerProfit === null ? 'pendingText' : play.bankerProfit < 0 ? 'lossText' : 'hitText'));
        detail.append(summary,financeMetrics(play));
        if (play.key === 'combo') {
            detail.append(el('p','特碰、三中三、二中二分别按各自赔率计算后相加；分项已包含在本合计内，不重复计入总账。','muted'));
            for (const child of Object.values(poolCategories).filter(c => c.parent === 'combo')) detail.append(playDetail(child,poolCategories));
            return detail;
        }
        detail.append(el('p', '相同组合合并金额，重复录入增加计费组数，不重复增加组合种数。', 'muted'));
        if (play.key === 'pair') detail.append(el('p','特碰与复式特碰合并；一特一平、不分方向。','muted'));
        if (type === 'regular') detail.append(el('p','仅6个平码参与；特码不算平码命中。每个号码分别计费。','muted'));
        if (type === 'zodiacLink') {
            const sizes = el('div',undefined,'linkBreakdown');
            for (const child of Object.values(poolCategories).filter(c => c.parent === 'zodiacLink')) sizes.append(el('span',`${child.label} · ${money(child.total)}元 · ${profitLabel(child.bankerProfit)}`));
            detail.append(sizes);
        }
        if (play.extraCharge > 0) detail.append(el('p', `计费额含交叉重号部分${money(play.extraCharge)}元，同号不列为有效组合。`, 'muted'));
        detail.append(groupList(type, play.groups.slice().sort((a, b) => Number(b.hit) - Number(a.hit))));
        return detail;
    }
    function preview() {
        const parsed = BetSlip.parse($('betSlipText').value, parseOptions());
        $('preview').replaceChildren();
        for (const row of parsed.rows) {
            const details = el('details');
            const groups = BetSlip.groupsFor(row);
            const billed = row.billedGroupCount ?? groups.length;
            const count = row.type === 'special' ? `${billed}码` : `计费${billed}组`;
            details.append(el('summary', `${BetStats.pools[row.pool]} · ${row.label}：${count} × ${money(row.unitCents / 100)} = ${money(row.subtotalCents / 100)}`));
            if (row.type === 'specialPair') details.append(el('p', `计费${billed}组，有效${groups.length}组。${billed > groups.length ? '交叉重号不列为组合，收费仍按两批数量相乘。' : ''}`, 'muted'));
            if (row.zodiacYear) details.append(el('p', `${row.zodiacYear}年展开号码：${row.expandedNumbers.map(n => String(n).padStart(2, '0')).join('、')}；保存后固定这些号码。`, 'muted'));
            details.append(groupList(row.type, groups.map(values => ({values, amount:row.unitCents / 100}))));
            $('preview').append(details);
        }
        $('previewTotal').textContent = parsed.rows.length ? `本单合计 ${money(parsed.totals.total)} 元` : '';
        $('previewMessage').textContent = parsed.errors.length ? parsed.errors.join('\n') : parsed.valid
            ? `${parsed.checked ? '手写合计核对一致。' : ''}请核对奖池、组合和金额，展开查看明细，确认后才记账。` : '未写奖池默认新澳。';
        $('previewMessage').className = parsed.errors.length ? 'error' : '';
        $('saveSlip').disabled = !parsed.valid;
        return parsed;
    }
    function render() {
        try {
            const ledger = ensureLedger();
            const cache = read(BetStats.drawKey);
            const date = $('ledgerDate').value;
            const zodiacYear = Number($('zodiacYear').value);
            const totals = BetStats.summarize(ledger, date, cache, zodiacYear);
            const categories = BetStats.categoryOverview(totals);
            renderCategoryOverview(categories);
            $('zodiacHint').textContent = `${zodiacYear}年：01对应${BetStats.zodiac(1, zodiacYear)}。用于生肖判中及未保存生肖选号的展开；已保存的号码组合不会改变。`;
            $('dateTitle').textContent = `${date} · 三个奖池独立记账`;
            $('dayTotal').textContent = money(Object.values(totals).reduce((a, item) => a + item.total, 0));
            const settled = Object.values(totals).filter(item => item.draw && item.total > 0);
            const pending = Object.values(totals).filter(item => !item.draw && item.total > 0);
            $('settlementSummary').textContent = `按最近一期对照：${settled.length} 个有注单奖池已有完整结果 · ${pending.length} 个暂无结果；已知命中下注额 ${money(settled.reduce((a, b) => a + b.allHit, 0))} 元。${categories.finance.unpricedAmount > 0 ? `另有${money(categories.finance.unpricedAmount)}元玩法规则未设置，总应赔和净盈亏暂不计算。` : ''}`;
            $('financeSummary').replaceChildren(financeMetrics(categories.finance));
            $('poolCards').replaceChildren();
            for (const [pool, item] of Object.entries(totals)) {
                const card = el('section', undefined, 'pool card');
                card.append(el('h2', BetStats.pools[pool]));
                const latest = cache.latest?.[pool];
                if (item.draw) {
                    card.append(el('div', `最近一期 · 第${item.draw.issue}期（对照 ${date} 的注单）`, 'drawNote'));
                    const balls = el('div', undefined, 'draw');
                    item.draw.numbers.forEach((n, i) => {
                        if (i === 6) balls.append(el('span', '+ 特码'));
                        balls.append(el('span', String(n).padStart(2, '0'), i === 6 ? 'ball special' : 'ball'));
                    });
                    card.append(balls, el('div', `生肖（${zodiacYear}年）：${item.draw.numbers.slice(0, 6).map(n => BetStats.zodiac(n, zodiacYear)).join('、')} ＋ ${BetStats.zodiac(item.special, zodiacYear)}`, 'drawNote'), el('div', `开奖缓存获取于 ${new Date(item.draw.fetchedAt).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'})}（北京时间）`, 'drawNote'));
                    if (latest && !latest.complete) card.append(el('p', '本次接口号码不完整，仍显示上次获取的完整一期。', 'drawNote'));
                } else {
                    card.append(el('p', '暂无最近一期完整号码，请获取最新开奖；占位或不完整号码不参与计算。', 'drawNote'));
                }
                const metrics = el('div', undefined, 'metrics');
                for (const [label, value] of [['所选日期收单额', item.total], ['全部玩法命中下注额', item.allHit]]) {
                    const metric = el('div', label, 'metric');
                    metric.append(el('strong', value === null ? '暂无结果' : `${money(value)} 元`));
                    metrics.append(metric);
                }
                card.append(metrics);
                card.append(financeMetrics(categories.financeByPool[pool]));
                if (categories.financeByPool[pool].unpricedAmount > 0) card.append(el('p', `有${money(categories.financeByPool[pool].unpricedAmount)}元玩法规则未设置，保留已知应赔和返水，不计算完整净盈亏。`, 'muted'));
                const playHolder = el('div', undefined, 'playResults');
                for (const play of Object.values(categories.perPool[pool])) {
                    const type = play.type;
                    if (type === 'special' || play.child || play.total === 0) continue;
                    playHolder.append(playDetail(play,categories.perPool[pool]));
                }
                card.append(playHolder);
                const specialDetails = el('details', undefined, 'specialNumbers');
                specialDetails.open = item.specialTotal > 0;
                specialDetails.append(el('summary', `普通特码逐号金额 · 下注${money(item.specialTotal)}元 · 命中下注额${item.hit === null ? '待结果' : money(item.hit) + '元'} · ${profitLabel(categories.perPool[pool].special.bankerProfit)}`), el('p', `号码圆球颜色表示红、绿、蓝波，生肖按${zodiacYear}年显示；绿色外框及“命中／特码·未下注”标签标示开出特码。这里只显示普通特码金额，组合玩法不拆成单号下注。`, 'numbersCaption'));
                const grid = el('div', undefined, 'numbers');
                const numbersScroll = el('div', undefined, 'numbersScroll');
                numbersScroll.tabIndex = 0;
                numbersScroll.setAttribute('role', 'region');
                numbersScroll.setAttribute('aria-label', `${BetStats.pools[pool]}特码金额，每行12个号码，可左右滑动`);
                for (let n = 1; n <= 49; n++) {
                    const cell = el('div', undefined, `number${item.amounts[n] > 0 ? ' staked' : ''}${n === item.special ? ' hit' : ''}`);
                    const wave = BetStats.wave(n), animal = BetStats.zodiac(n, zodiacYear);
                    const waveName = {red:'红波',green:'绿波',blue:'蓝波'}[wave];
                    const number = el('b', String(n).padStart(2, '0'), `numberBall wave-${wave}`);
                    number.title = `${waveName} · ${animal}（${zodiacYear}年）`;
                    number.setAttribute('aria-label', `${String(n).padStart(2, '0')} ${waveName}`);
                    cell.append(number, el('span', animal, 'numberZodiac'), el('strong', `${money(item.amounts[n])}元`));
                    if (n === item.special) cell.append(el('span', item.amounts[n] > 0 ? '命中' : '特码·未下注'));
                    grid.append(cell);
                }
                numbersScroll.append(grid);
                specialDetails.append(el('p', '每行12个：01–12、13–24、25–36、37–48，49单独一行。窄屏可左右滑动查看。', 'muted'), numbersScroll);
                card.append(specialDetails);
                $('poolCards').append(card);
            }
            $('savedSlips').replaceChildren();
            const slips = (ledger.textBetSlips || []).map((slip,index)=>({slip,index})).filter(({slip}) => slip.date === date && BetSlip.activeRows(slip).length).reverse();
            if (!slips.length) $('savedSlips').textContent = '所选日期暂无有效文字注单。';
            const deletion = BetSlip.lastDeletion(ledger,date);
            $('undoDelete').disabled = ledgerBusy || !deletion;
            $('undoDelete').dataset.eventId = deletion ? String(deletion.id) : '';
            $('undoDelete').textContent = deletion ? `撤销最近删除（${money(deletion.amount)}元）` : '撤销最近删除';
            for (const {slip,index} of slips) {
                const details = el('details');
                const rows = BetSlip.activeRows(slip), totals = BetSlip.totalsForRows(rows);
                details.append(el('summary', `${slip.date} · ${money(totals.total)}元 · ${rows.length}条明细`));
                const deleteSlip = el('button','删除整张注单','dangerButton');
                deleteSlip.disabled = ledgerBusy;
                deleteSlip.addEventListener('click',()=>deleteSavedEntry(index,null,slip));
                details.append(deleteSlip,el('p','删除一条指删除下方一条解析明细（可能包含多个号码或组合），不是删除其中一个号码。','muted'));
                const original = el('details');
                original.append(el('summary','查看原始文字（保留原文，可能包含已删除明细）'),el('pre',slip.text));
                details.append(original);
                (slip.rows || []).forEach((row,rowIndex)=>{
                    if (row.deletedAt) return;
                    const line = el('div',undefined,'savedRow');
                    const amount = BetSlip.totalsForRows([row]).total;
                    const label = `明细${rowIndex+1} · ${BetStats.pools[row.pool]} · ${row.label} · ${money(amount)}元`;
                    const description = el('div',label);
                    if (row.zodiacYear) description.append(el('p', `按${row.zodiacYear}年保存：${row.expandedNumbers.map(n=>String(n).padStart(2,'0')).join('、')}`,'muted'));
                    const remove = el('button','删除此条','dangerButton');
                    remove.setAttribute('aria-label','删除'+label);
                    remove.disabled = ledgerBusy;
                    remove.addEventListener('click',()=>deleteSavedEntry(index,rowIndex,slip));
                    line.append(description,remove); details.append(line);
                });
                $('savedSlips').append(details);
            }
        } catch (error) {
            $('fetchStatus').className = 'error';
            $('fetchStatus').textContent = `读取记录失败，未覆盖原数据：${error.message}`;
        }
    }
    async function changeLedger(change, message) {
        if (ledgerBusy) return;
        ledgerBusy = true;
        $('ledgerActionMessage').textContent = '';
        try {
            const commit = () => {
                const next = change(ensureLedger());
                if (!next) return;
                localStorage.setItem(BetStats.ledgerKey,JSON.stringify(next));
                $('ledgerActionMessage').className = 'ok';
                $('ledgerActionMessage').textContent = message;
            };
            if (navigator.locks) await navigator.locks.request(BetStats.ledgerKey,commit);
            else commit();
        } catch (error) {
            $('ledgerActionMessage').className = 'error';
            $('ledgerActionMessage').textContent = `操作未保存，原记录未改动：${error.message}`;
        } finally { ledgerBusy = false; render(); }
    }
    async function deleteSavedEntry(slipIndex,rowIndex,slip) {
        const rows = rowIndex === null ? BetSlip.activeRows(slip) : [slip.rows[rowIndex]];
        const amount = BetSlip.totalsForRows(rows).total;
        const description = rows.map(row=>`${BetStats.pools[row.pool]} · ${row.label} · ${money(BetSlip.totalsForRows([row]).total)}元`).join('\n');
        await changeLedger(ledger=>{
            const next = BetSlip.deleteLedgerEntry(ledger,{slipIndex,rowIndex,expected:JSON.stringify(slip)},new Date().toISOString());
            if (!confirm(`确认删除${rowIndex === null ? '这张注单' : '这条明细'}？\n日期：${slip.date}\n金额：${money(amount)}元\n${description.slice(0,500)}${description.length>500 ? '\n……' : ''}\n\n删除后统计会重算，可通过“撤销最近删除”恢复。`)) return null;
            return next;
        },`已删除${rowIndex === null ? '整张注单' : '一条明细'}，共${money(amount)}元。统计已重算，可撤销恢复。`);
    }
    async function save() {
        const text = $('betSlipText').value;
        const parsed = preview();
        const options = parseOptions();
        const date = $('ledgerDate').value;
        if (!parsed.valid) return;
        if (!BetStats.validDate(date) || date > BetStats.today()) { alert('请选择有效的今日或过去日期。'); return; }
        const commit = () => {
            const ledger = ensureLedger();
            if ((ledger.textBetSlips || []).some(slip => slip.date === date && !slip.deletedAt && (slip.rows ? BetSlip.fingerprintForRows(BetSlip.activeRows(slip)) : slip.fingerprint) === parsed.fingerprint)
                && !confirm('该日期已经有相同奖池、号码和金额的注单，确实要再记一笔吗？')) return;
            const next = BetSlip.appendToLedger(ledger, text, date, new Date().toISOString(), options);
            localStorage.setItem(BetStats.ledgerKey, JSON.stringify(next));
            $('betSlipText').value = '';
            preview(); render();
            $('previewMessage').className = 'ok';
            $('previewMessage').textContent = `已录入 ${date}：${money(parsed.totals.total)} 元。各玩法组合及累计金额已更新。`;
        };
        $('saveSlip').disabled = true;
        try {
            if (navigator.locks) await navigator.locks.request(BetStats.ledgerKey, commit);
            else commit();
        } catch (error) {
            $('previewMessage').className = 'error';
            $('previewMessage').textContent = `保存失败，文字已保留：${error.message}`;
        } finally { $('saveSlip').disabled = !BetSlip.parse($('betSlipText').value, parseOptions()).valid; }
    }
    const games = { newao: 'am', oldao: 'oldam', xianggang: 'xg' };
    const sourceFiles = { am: 'v_am', oldam: 'v_oldam', xg: 'v_xg' };
    const proxies = {
        mirror: target => 'https://corsmirror.onrender.com/v1/cors?url=' + encodeURIComponent(target),
        render: target => 'https://corsproxy-8uo5.onrender.com/?url=' + encodeURIComponent(target),
        bridge: target => 'https://api.cors.syrins.tech/?url=' + encodeURIComponent(target)
    };
    async function fetchCurrent(game) {
        const route = localStorage.getItem('numToNum-data-route-v2') || 'local-first';
        const remote = `https://kj6.kkj.app:1888/data/${sourceFiles[game]}.json?t=${Date.now()}`;
        const proxyIds = ['mirror', 'render'].includes(route) ? [route] : Object.keys(proxies);
        const urls = proxyIds.map(id => proxies[id](remote));
        if (route === 'local-first' && /^https?:$/.test(location.protocol)) urls.unshift(`/api/lottery/current?g=${game}&t=${Date.now()}`);
        for (const url of urls) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
                const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const json = await response.json();
                if (!json || !json.Data || !json.Qi) throw new Error('开奖格式不正确');
                return json;
            } catch { /* 按主页选择的线路依次重试。 */ }
            finally { clearTimeout(timer); }
        }
        throw new Error('所选线路均失败，可在首页切换数据线路后重试');
    }
    async function refreshDraws() {
        $('refreshDraws').disabled = true;
        $('fetchStatus').className = '';
        $('fetchStatus').textContent = '正在获取三个奖池，沿用首页数据线路…';
        const messages = await Promise.all(Object.entries(games).map(async ([pool, game]) => {
            try {
                const json = await fetchCurrent(game);
                const next = BetStats.storeDraw(read(BetStats.drawKey), pool, json);
                localStorage.setItem(BetStats.drawKey, JSON.stringify(next));
                const draw = next.latest[pool];
                return `${BetStats.pools[pool]}：${draw.complete ? `最近一期 第${draw.issue}期 · 特码${String(draw.numbers[6]).padStart(2, '0')}` : '本次数据不完整，保留已有完整结果'}`;
            } catch (error) { return `${BetStats.pools[pool]}：获取失败，保留原有缓存。${error.message}`; }
        }));
        render();
        $('fetchStatus').textContent = messages.join('\n');
        $('fetchStatus').className = messages.some(message => message.includes('失败')) ? 'error' : '';
        $('refreshDraws').disabled = false;
    }
    $('ledgerDate').value = BetStats.today();
    const currentYear = Number(BetStats.today().slice(0, 4));
    for (let year = currentYear + 1; year >= 2023; year--) {
        const option = el('option', `${year}年`); option.value = year; $('zodiacYear').append(option);
    }
    $('zodiacYear').value = currentYear;
    $('zodiacYear').addEventListener('change', () => { preview(); render(); });
    $('ledgerDate').max = BetStats.today();
    $('ledgerDate').addEventListener('change', render);
    $('todayButton').addEventListener('click', () => { $('ledgerDate').max = BetStats.today(); $('ledgerDate').value = BetStats.today(); render(); });
    $('betSlipText').addEventListener('input', preview);
    $('fillExample').addEventListener('click', () => {
        if ($('betSlipText').value.trim() && !confirm('用示例替换未保存的文字？')) return;
        $('betSlipText').value = example; preview();
    });
    $('fillComboExample').addEventListener('click', () => {
        if ($('betSlipText').value.trim() && !confirm('用组合示例替换未保存的文字？')) return;
        $('betSlipText').value = comboExample; preview();
    });
    $('fillDragExample').addEventListener('click', () => {
        if ($('betSlipText').value.trim() && !confirm('用拖尾示例替换未保存的文字？')) return;
        $('betSlipText').value = dragExample; preview();
    });
    $('saveSlip').addEventListener('click', save);
    $('undoDelete').addEventListener('click',()=>{
        const date = $('ledgerDate').value;
        const expectedId = Number($('undoDelete').dataset.eventId);
        if (!expectedId) return;
        changeLedger(ledger=>BetSlip.restoreLastDeletion(ledger,date,expectedId,new Date().toISOString()),'已恢复最近删除的记录，原号码、金额和生肖年份均保留，统计已重算。');
    });
    $('refreshDraws').addEventListener('click', refreshDraws);
    $('exportLedger').addEventListener('click', () => {
        try {
            const data = { exportedAt: new Date().toISOString(), ledger: ensureLedger(), draws: read(BetStats.drawKey) };
            const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            const a = el('a'); a.href = url; a.download = `注单备份_${BetStats.today()}.json`; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { alert('备份失败：' + error.message); }
    });
    window.addEventListener('storage', event => { if ([BetStats.ledgerKey, BetStats.drawKey].includes(event.key)) render(); });
    window.addEventListener('focus', render);
    preview(); render(); refreshDraws();
})();
