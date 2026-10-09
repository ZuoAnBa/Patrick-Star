(function (root) {
    'use strict';
    const pools = { newao: '新澳', oldao: '老澳', xianggang: '香港' };
    const ledgerKey = 'numToNum-text-ledger-v2';
    const drawKey = 'numToNum-draws-v1';
    const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    function validDate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    }
    function normalizeDraw(json) {
        const date = `${json.Year}-${String(json.Moon).padStart(2, '0')}-${String(json.Day).padStart(2, '0')}`;
        const raw = Object.values(json.Data || {}).map(item => item.number);
        const numbers = raw.map(value => /^(?:0?[1-9]|[1-4][0-9])$/.test(String(value)) ? Number(value) : NaN);
        // Qi/Data 是最近一期；Year/Moon/Day/Time 是下一期预告，不能作为号码的开奖日期。
        const complete = /^\d+$/.test(String(json.Qi || '')) && numbers.length === 7 && numbers.every(Number.isInteger) && new Set(numbers).size === 7;
        return { nextDate: validDate(date) ? date : '', nextIssue: String(json.Nq || ''), issue: String(json.Qi || ''),
            nextTime: String(json.Time || ''), numbers: complete ? numbers : [], complete, fetchedAt: new Date().toISOString() };
    }
    function latestDraw(cache, pool) {
        if (cache.latest?.[pool]?.complete) return cache.latest[pool];
        if (cache.latestComplete?.[pool]?.complete) return cache.latestComplete[pool];
        // 兼容旧缓存：只读取最近一次完整号码，不再沿用错误的日期归属。
        return Object.values(cache.days || {}).map(day => day[pool]).filter(draw => draw?.complete)
            .sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)))[0] || null;
    }
    function storeDraw(cache, pool, json) {
        if (!pools[pool]) throw new Error('不支持的奖池');
        const next = JSON.parse(JSON.stringify(cache));
        const previous = latestDraw(next, pool);
        next.latest = next.latest || {};
        next.latestComplete = next.latestComplete || {};
        const draw = normalizeDraw(json);
        next.latest[pool] = draw;
        if (draw.complete || previous) next.latestComplete[pool] = draw.complete ? draw : previous;
        return next;
    }
    function migrate(legacy) {
        // 单独保存逐号码账本，避免主页关闭时用旧内存覆盖新页面记录。
        return { textBetSlips: Array.isArray(legacy.textBetSlips) ? legacy.textBetSlips : [], migratedAt: new Date().toISOString() };
    }
    function zodiac(number, year) {
        // 沿用用户指定年份映射：2026年01马，2025年01蛇，2024年01龙。
        const animals = ['马','蛇','龙','兔','虎','牛','鼠','猪','狗','鸡','猴','羊'];
        return animals[((number - 1 + 2026 - year) % 12 + 12) % 12];
    }
    function wave(number) {
        if (!Number.isInteger(number) || number < 1 || number > 49) return null;
        // 与首页波色表保持一致；波色不随生肖年份变化。
        if ([1,2,7,8,12,13,18,19,23,24,29,30,34,35,40,45,46].includes(number)) return 'red';
        if ([5,6,11,16,17,21,22,27,28,32,33,38,39,43,44,49].includes(number)) return 'green';
        return 'blue';
    }
    function groupHits(type, group, draw, year) {
        if (!draw) return null;
        const regular = draw.numbers.slice(0, 6);
        const special = draw.numbers[6];
        if (type === 'special') return group[0] === special;
        if (type === 'regular') return regular.includes(group[0]);
        if (type === 'triple' || type === 'double') return group.every(n => regular.includes(n));
        if (type === 'specialPair' || type === 'specialPairAny') return group[0] !== group[1] && ((regular.includes(group[0]) && special === group[1]) || (regular.includes(group[1]) && special === group[0]));
        if (type === 'tail') return draw.numbers.some(n => n % 10 === group[0]);
        if (type === 'singleZodiac' || type === 'zodiacLink') {
            const animals = new Set(draw.numbers.map(n => zodiac(n, year)));
            return group.every(animal => animals.has(animal));
        }
        return null;
    }
    function summarize(ledger, date, cache, zodiacYear = Number(today().slice(0, 4))) {
        const result = {};
        for (const pool of Object.keys(pools)) {
            const cents = Array(50).fill(0);
            const grouped = new Map();
            const billing = {};
            for (const slip of ledger.textBetSlips || []) {
                if (slip.date !== date || slip.deletedAt) continue;
                for (const row of slip.rows || []) {
                    if (row.pool !== pool || row.deletedAt) continue;
                    const type = row.type || 'special';
                    const rawGroups = row.groups || row.numbers.map(n => [n]);
                    // 包括已有记录：反向配对视为同一种组合，金额仍按原条目累加。
                    const groups = type === 'specialPair' || type === 'specialPairAny'
                        ? rawGroups.filter(([p, t]) => p !== t).map(group => group.slice().sort((a, b) => a - b)) : rawGroups;
                    const charge = billing[type] || { totalCents:0, billedCount:0, extraCents:0 };
                    const subtotal = row.subtotalCents ?? rawGroups.length * row.unitCents;
                    charge.totalCents += subtotal;
                    charge.billedCount += row.billedGroupCount ?? rawGroups.length;
                    charge.extraCents += subtotal - groups.length * row.unitCents;
                    billing[type] = charge;
                    for (const values of groups) {
                        if (type === 'special') cents[values[0]] += row.unitCents;
                        const key = type + ':' + values.join(',');
                        const group = grouped.get(key) || {type, values, cents:0, entries:0};
                        group.cents += row.unitCents;
                        group.entries++;
                        grouped.set(key, group);
                    }
                }
            }
            const specialCents = cents.reduce((a, b) => a + b, 0);
            const totalCents = Object.values(billing).reduce((sum, charge) => sum + charge.totalCents, 0);
            // 仅将所选日期注单与最近一期对照，不写入历史结算，也不累计返还。
            const draw = latestDraw(cache, pool);
            const settled = !!draw;
            const special = settled ? draw.numbers[6] : null;
            const hitCents = settled ? cents[special] : null;
            const plays = Object.fromEntries(Object.entries(billing).map(([type, charge]) => [type, {
                ...charge, groups:[], hitCents:0, hitCount:0, entryCount:0
            }]));
            for (const group of grouped.values()) {
                const play = plays[group.type];
                const hit = groupHits(group.type, group.values, draw, zodiacYear);
                play.groups.push({ values:group.values, amount:group.cents / 100, hit, entries:group.entries });
                play.entryCount += group.entries;
                if (hit) { play.hitCents += group.cents; play.hitCount++; }
                plays[group.type] = play;
            }
            for (const play of Object.values(plays)) {
                play.total = play.totalCents / 100;
                play.extraCharge = play.extraCents / 100;
                play.hitAmount = settled ? play.hitCents / 100 : null;
                play.hitCount = settled ? play.hitCount : null;
            }
            const allHit = settled ? Object.values(plays).reduce((sum, play) => sum + play.hitCents, 0) / 100 : null;
            result[pool] = { amounts: cents.map(n => n / 100), total: totalCents / 100, draw: settled ? draw : null,
                plays, allHit, specialTotal: specialCents / 100, otherTotal: (totalCents - specialCents) / 100,
                special, hit: settled ? hitCents / 100 : null,
                specialReturned: settled ? hitCents * 47 / 100 : null,
                specialProfit: settled ? (hitCents * 47 - specialCents) / 100 : null,
                returned: settled && totalCents === specialCents ? hitCents * 47 / 100 : null,
                profit: settled && totalCents === specialCents ? (hitCents * 47 - totalCents) / 100 : null };
        }
        return result;
    }
    const categoryDefinitions = [
        ['special','特码','special'], ['combo','三项合计（特碰／三中三／二中二）','combo'],
        ['pair','特串（特碰）','specialPair','combo'],
        ['triple','三中三','triple','combo'], ['double','二中二','double','combo'],
        ['zodiacLink','连肖合计','zodiacLink'],
        ...[2,3,4,5].map(size => ['link'+size, size+'连肖','zodiacLink','zodiacLink']),
        ['singleZodiac','平特肖（一肖）','singleZodiac'], ['tail','尾数','tail'], ['regular','平码','regular']
    ];
    // 用户确认：所有赔率含本金；返水不论输赢；盈亏为收单方视角。
    // 连肖返水以最后确认的10%为准，6连及以上尚未提供规则。
    function payoutRule(type, values, pool) {
        const fixed = {special:[47,4],regular:[7,15],double:[65,15],specialPair:[160,15],specialPairAny:[160,15]};
        if (fixed[type]) return {odds:fixed[type][0],rebatePercent:fixed[type][1]};
        if (type === 'triple') return {odds:pool === 'xianggang' ? 720 : 750,rebatePercent:15};
        if (type === 'singleZodiac') return {odds:values.includes('马') ? 1.8 : 2,rebatePercent:6};
        if (type === 'tail') return {odds:values[0] === 0 ? 2 : 1.8,rebatePercent:values[0] === 0 ? 2 : 1};
        if (type === 'zodiacLink') {
            const rates = {2:[4,3.8],3:[10,9],4:[30,28],5:[100,90]}[values.length];
            if (rates) return {odds:rates[values.includes('马') ? 1 : 0],rebatePercent:10};
        }
        return null;
    }
    function roundedProduct(cents, hundredths) {
        // 用整数算至分，避免1.8、3.8等浮点乘法及大金额失真。
        if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(hundredths)) throw new Error('计算金额过大，无法精确计算');
        const value = (BigInt(cents) * BigInt(hundredths) + 50n) / 100n;
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('应赔金额过大，无法精确计算，请拆分账本');
        return Number(value);
    }
    function bankerProfit(total, payout, rebate) {
        const value = BigInt(Math.round(total*100))-BigInt(Math.round(payout*100))-BigInt(Math.round(rebate*100));
        if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('净盈亏金额过大，无法精确计算');
        return Number(value)/100;
    }
    function sumMoney(items, field) {
        const cents = items.reduce((sum,item) => sum + Math.round(item[field] * 100),0);
        if (!Number.isSafeInteger(cents)) throw new Error('汇总金额过大，无法精确计算');
        return cents / 100;
    }
    function combineFinance(items) {
        const knownPayout = sumMoney(items,'knownPayout'), knownRebate = sumMoney(items,'knownRebate');
        const payout = items.some(item => item.payout === null) ? null : knownPayout;
        const rebate = items.some(item => item.rebate === null) ? null : knownRebate;
        const total = sumMoney(items,'total');
        return {knownPayout,knownRebate,payout,rebate,
            bankerProfit:payout === null || rebate === null ? null : bankerProfit(total,payout,rebate),
            unpricedAmount:sumMoney(items,'unpricedAmount')};
    }
    function settleCategory(category, pool) {
        const buckets = new Map();
        let unpricedCents = 0;
        function add(values, cents, hit) {
            const rule = payoutRule(category.type,values,pool);
            if (!rule) { unpricedCents += cents; return; }
            const key = rule.odds + ':' + rule.rebatePercent;
            const bucket = buckets.get(key) || {...rule,stake:0,hitStake:0};
            bucket.stake += cents;
            if (hit) bucket.hitStake += cents;
            buckets.set(key,bucket);
        }
        for (const group of category.groups) {
            group.rule = payoutRule(category.type,group.values,pool);
            add(group.values,Math.round(group.amount*100),group.hit);
        }
        // 已收费的交叉同号部分也要返水，但不能命中。
        if (category.extraCents > 0) add([],category.extraCents,false);
        let payoutCents = 0, rebateCents = 0;
        for (const bucket of buckets.values()) {
            payoutCents += roundedProduct(bucket.hitStake,Math.round(bucket.odds*100));
            rebateCents += roundedProduct(bucket.stake,bucket.rebatePercent);
        }
        if (![payoutCents,rebateCents].every(Number.isSafeInteger)) throw new Error('结算金额过大，无法精确计算');
        category.knownPayout = payoutCents/100;
        category.knownRebate = rebateCents/100;
        category.unpricedAmount = unpricedCents/100;
        category.payout = category.pending || unpricedCents > 0 ? null : category.knownPayout;
        category.rebate = unpricedCents > 0 ? null : category.knownRebate;
        category.bankerProfit = category.payout === null || category.rebate === null ? null : bankerProfit(category.total,category.payout,category.rebate);
    }
    function categoriesForPool(item, pool = 'newao') {
        const categories = Object.fromEntries(categoryDefinitions.map(([key,label,type,parent]) => [key,
            {key,label,type,parent:parent || null,child:!!parent,totalCents:0,billedCount:0,extraCents:0,pending:false,groups:[]} ]));
        const merged = new Map();
        function ensure(key, type) {
            if (!categories[key]) categories[key] = {key,label:key.startsWith('link') ? key.slice(4)+'连肖' : type,
                type,parent:key.startsWith('link') ? 'zodiacLink' : null,child:key.startsWith('link'),totalCents:0,billedCount:0,extraCents:0,pending:false,groups:[]};
            return categories[key];
        }
        function addGroup(category, group) {
            const values = group.values.slice().sort((a,b) => typeof a === 'number' ? a-b : a.localeCompare(b));
            const key = category.key + ':' + values.join(',');
            const current = merged.get(key) || {category:category.key,values,cents:0,entries:0,hit:group.hit};
            current.cents += Math.round(group.amount * 100);
            current.entries += group.entries;
            merged.set(key,current);
        }
        for (const [type,play] of Object.entries(item.plays || {})) {
            const key = type === 'specialPair' || type === 'specialPairAny' ? 'pair' : type;
            const category = ensure(key,type);
            category.totalCents += play.totalCents;
            category.billedCount += play.billedCount;
            category.extraCents += play.extraCents;
            category.pending ||= play.hitCount === null && play.totalCents > 0;
            for (const group of play.groups) {
                addGroup(category,group);
                if (type === 'zodiacLink') {
                    const child = ensure('link'+group.values.length,type);
                    child.totalCents += Math.round(group.amount * 100);
                    child.billedCount += group.entries;
                    child.pending ||= group.hit === null;
                    addGroup(child,group);
                }
            }
        }
        for (const group of merged.values()) categories[group.category].groups.push({values:group.values,amount:group.cents/100,entries:group.entries,hit:group.hit});
        for (const category of Object.values(categories)) {
            category.total = category.totalCents / 100;
            category.extraCharge = category.extraCents / 100;
            category.hitCount = category.pending ? null : category.groups.filter(group => group.hit).length;
            category.hitAmount = category.pending ? null : category.groups.reduce((sum,group) => sum + (group.hit ? Math.round(group.amount*100) : 0),0)/100;
            settleCategory(category,pool);
        }
        // 父项只相加各子项的既有结果，不统一赔率、不重新四舍五入。
        // 分组必须按parent区分，避免将三项子项误加进连肖或总额重复计费。
        for (const key of ['combo','zodiacLink']) {
            const children = Object.values(categories).filter(category => category.parent === key);
            const parent = categories[key];
            parent.totalCents = children.reduce((sum,c) => sum+c.totalCents,0);
            parent.total = parent.totalCents/100;
            parent.billedCount = children.reduce((sum,c) => sum+c.billedCount,0);
            parent.extraCents = children.reduce((sum,c) => sum+c.extraCents,0);
            parent.extraCharge = parent.extraCents/100;
            parent.pending = children.some(c => c.pending);
            // 各玩法中的同号组合仍是不同玩法，不跨玩法合并。
            parent.groups = children.flatMap(c => c.groups.map(group => ({...group,type:c.type})));
            parent.hitCount = parent.pending ? null : children.reduce((sum,c) => sum+c.hitCount,0);
            parent.hitAmount = parent.pending ? null : sumMoney(children,'hitAmount');
            Object.assign(parent,combineFinance(children));
        }
        return categories;
    }
    function categoryOverview(totals) {
        const perPool = Object.fromEntries(Object.entries(totals).map(([pool,item]) => [pool,categoriesForPool(item,pool)]));
        const keys = [...new Set(Object.values(perPool).flatMap(categories => Object.keys(categories)))];
        const rows = keys.map(key => {
            const entries = Object.entries(perPool).filter(([,categories]) => categories[key]);
            const prototype = entries[0][1][key];
            const values = entries.map(([,categories]) => categories[key]);
            return {key,label:prototype.label,parent:prototype.parent,child:prototype.child,
                ...combineFinance(values),
                byPool:Object.fromEntries(entries.map(([pool,categories]) => [pool,categories[key].total])),
                total:values.reduce((sum,c) => sum+c.totalCents,0)/100,
                billedCount:values.reduce((sum,c) => sum+c.billedCount,0),
                hitAmount:values.reduce((sum,c) => sum+Math.round((c.hitAmount || 0)*100),0)/100,
                pendingAmount:values.reduce((sum,c) => sum+(c.pending ? c.totalCents : 0),0)/100};
        });
        const financeByPool = Object.fromEntries(Object.entries(perPool).map(([pool,categories]) => [pool,combineFinance(Object.values(categories).filter(category => !category.child))]));
        return {perPool,rows,financeByPool,finance:combineFinance(rows.filter(row => !row.child))};
    }
    const api = { pools, ledgerKey, drawKey, today, validDate, normalizeDraw, latestDraw, storeDraw, migrate, summarize, zodiac, wave, groupHits, categoriesForPool, categoryOverview, payoutRule };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BetStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
