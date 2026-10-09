(function (root) {
    "use strict";

    const pools = { 新: "newao", 新澳: "newao", 新奥: "newao", 老: "oldao", 老澳: "oldao", 香: "xianggang", 港: "xianggang", 香港: "xianggang" };
    const poolNames = { newao: "新澳", oldao: "老澳", xianggang: "香港" };
    const moneyPattern = "\\d+(?:\\.\\d{1,2})?";
    const summaryPattern = new RegExp("^(特码|特|三|连|肖|尾|平码|平|合计|总计|总额|总金额|总)[:：]?((?:" + moneyPattern + ")(?:\\+(?:" + moneyPattern + "))*)(?:=(" + moneyPattern + "))?元?$");
    const amountPattern = new RegExp("^(.+?)各(" + moneyPattern + ")元?$");
    const animalChars = '鼠牛虎兔龙蛇马羊猴鸡狗猪';
    const animalSelectionPattern = '[' + animalChars + '](?:[-.,，、/\\s]*[' + animalChars + '])*';
    const typeNames = { special: '特码', regular: '平码', zodiacLink: '连肖', triple: '三中三', double: '二中二', specialPair: '特碰（不分方向）', specialPairAny: '复式特碰（不分方向）', singleZodiac: '平特肖（一肖）', tail: '尾数' };
    const summaryTypes = { 特:['special'], 特码:['special'], 三:['triple','double','specialPair','specialPairAny'], 连:['zodiacLink'], 肖:['singleZodiac'], 尾:['tail'], 平:['regular'], 平码:['regular'] };
    function defaultZodiacYear() {
        return Number(new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Shanghai',year:'numeric'}).format(new Date()));
    }
    function zodiacNumbers(animal, year) {
        if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error('请设置有效的生肖年份');
        const animals = ['马','蛇','龙','兔','虎','牛','鼠','猪','狗','鸡','猴','羊'];
        return Array.from({length:49}, (_, i) => i + 1).filter(n => animals[((n - 1 + 2026 - year) % 12 + 12) % 12] === animal);
    }
    const sizes = { 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10, 十一:11, 十二:12 };
    function combinations(values, size) {
        if (!Number.isInteger(size) || size < 0 || size > values.length) throw new Error('候选数量不足或必带数量超过组合大小');
        const result = [];
        function walk(start, chosen) {
            if (chosen.length === size) { result.push(chosen.slice()); return; }
            for (let i = start; i <= values.length - (size - chosen.length); i++) {
                chosen.push(values[i]); walk(i + 1, chosen); chosen.pop();
            }
        }
        walk(0, []);
        return result;
    }
    function numericList(text) {
        text = text.replace(/\/+$/, '');
        if (!/^\d{1,2}(?:[-.,，、/\s]+\d{1,2})*$/.test(text)) throw new Error('请填写明确的01至49号码列表');
        return expand(text);
    }
    function zodiacList(text) {
        const list = [...text.replace(/[-.,，、/\s]/g, '')];
        if (!list.length || list.some(value => !animalChars.includes(value))) throw new Error('生肖列表无法识别');
        if (new Set(list).size !== list.length) throw new Error('生肖列表存在重复，请核对');
        return list;
    }
    function groupedRow(type, label, groups, amount) {
        const unitCents = cents(amount);
        if (unitCents <= 0) throw new Error('每组金额须大于0');
        if (!groups.length || groups.length > 20000) throw new Error('组合数量须在1至20000组之间，请拆分录入');
        const subtotalCents = groups.length * unitCents;
        if (!Number.isSafeInteger(subtotalCents)) throw new Error('金额过大');
        return { type, label, groups, numbers: type === 'special' ? groups.map(group => group[0]) : [], unitCents, subtotalCents };
    }
    function crossPair(first, second, amount, label) {
        const row = groupedRow('specialPair', label, first.flatMap(p => second.map(t => [p, t])), amount);
        // 两批数量相乘计费，交叉同号不列为有效组合。
        row.billedGroupCount = row.groups.length;
        row.overlapNumbers = first.filter(n => second.includes(n));
        row.groups = groupsFor(row);
        return row;
    }
    function normalizeShorthand(line) {
        // 手写合计在调用本函数前已经单独识别；注单里的“=”和“各数”都是单价分隔符。
        line = line.replace(/各数/g, '各').replace(/=/g, '各');
        line = line.replace(new RegExp('各\\((' + moneyPattern + ')\\)(元?)$'), '各$1$2');
        line = line.replace(/特串/g, '特碰');
        line = line.replace(/^平特尾([0-9])/, '$1尾');
        // 只把末尾横线后的金额转成“各”，不改写带“各”的负数或号码内部短横线。
        const price = line.match(new RegExp('^(.+?)([-—–]+)(' + moneyPattern + ')元?$'));
        if (price && !price[1].endsWith('各') && (/[—–]/.test(price[2]) || (price[2].length > 1 && /[\u4e00-\u9fff]/.test(price[1])))) {
            line = price[1] + '各' + price[3];
        }
        line = line.replace(/[—–]/g, '-');
        line = line.replace(new RegExp('^(?:平特肖|平特一肖)(' + animalSelectionPattern + ')(?=各|\\d)'), '$1一肖');
        // “平特”在连肖简写中是前缀，不把它误当作仅平码的规则。
        if (/连(?:肖)?各/.test(line)) {
            line = line.replace(/^平特-*/, '');
            line = line.replace(/-*(十二|十一|[二三四五六七八九十]|\d{1,2})连(?:肖)?(?=各)/g, '$1连肖');
        }
        return line;
    }
    function parseLine(line, options) {
        line = normalizeShorthand(line);
        const regular = line.match(new RegExp('^(?:平码(.+?)|(.+?)平码)各(' + moneyPattern + ')元?$'));
        if (regular) return [groupedRow('regular', '平码' + (regular[1] || regular[2]), numericList(regular[1] || regular[2]).map(n => [n]), regular[3])];
        const dragPair = line.match(new RegExp('^特碰(.+?)拖(.+?)各(' + moneyPattern + ')元?$'));
        if (dragPair) {
            const anchors = numericList(dragPair[1]);
            const tailSelector = dragPair[2].match(/^([0-9](?:[-.,，、/\s]+[0-9])*)尾$/);
            const tails = tailSelector ? tailSelector[1].split(/[-.,，、/\s]+/).map(Number) : [];
            if (new Set(tails).size !== tails.length) throw new Error('拖尾存在重复尾数，请核对');
            const candidates = tailSelector ? Array.from({length:49}, (_,i) => i+1).filter(n => tails.includes(n % 10)) : numericList(dragPair[2]);
            return [crossPair(candidates, anchors, dragPair[3], `特碰${dragPair[1]}拖${dragPair[2]}（不分方向）`)];
        }
        const anyPair = line.match(new RegExp('^(.+?)(?:复式|复)特碰各(' + moneyPattern + ')元?$'));
        if (anyPair) {
            const byAnimal = anyPair[1].length === 1 && animalChars.includes(anyPair[1]);
            const year = options.zodiacYear ?? defaultZodiacYear();
            const byHead = /^[0-4]头(?:[-.,，、/\s]*[0-4]头)*$/.test(anyPair[1]);
            const numbers = byAnimal ? zodiacNumbers(anyPair[1], year) : byHead ? expand(anyPair[1]) : numericList(anyPair[1]);
            const row = groupedRow('specialPairAny', anyPair[1] + '复特碰（不分方向）', combinations(numbers, 2), anyPair[2]);
            if (byAnimal) { row.zodiacYear = year; row.expandedNumbers = numbers; }
            return [row];
        }
        const dragCombo = line.match(new RegExp('^(\\d.*?)拖(.+?)(三中三|二中二)各(' + moneyPattern + ')元?$'));
        if (dragCombo) {
            const anchors = numericList(dragCombo[1]);
            const candidates = numericList(dragCombo[2]);
            const size = dragCombo[3] === '三中三' ? 3 : 2;
            if (anchors.length >= size) throw new Error(`${dragCombo[3]}必带号码须少于${size}个`);
            if (anchors.some(number => candidates.includes(number))) throw new Error('必带号码不能同时出现在拖码里');
            const groups = combinations(candidates, size - anchors.length).map(group => [...anchors, ...group].sort((a,b) => a-b));
            return [groupedRow(size === 3 ? 'triple' : 'double', dragCombo[1] + '拖' + dragCombo[2] + dragCombo[3], groups, dragCombo[4])];
        }
        const leadingCombo = line.match(new RegExp('^(复式|复)?(三中三|二中二)(.+?)各(' + moneyPattern + ')元?$'));
        if (leadingCombo) {
            const numbers = numericList(leadingCombo[3]);
            const size = leadingCombo[2] === '三中三' ? 3 : 2;
            if (!leadingCombo[1] && numbers.length !== size) throw new Error(`${leadingCombo[2]}单组须填写${size}个号码，多号码组合请加“复”字`);
            return [groupedRow(size === 3 ? 'triple' : 'double', (leadingCombo[1] || '') + leadingCombo[2] + leadingCombo[3], combinations(numbers, size), leadingCombo[4])];
        }
        const single = line.match(new RegExp('^(' + animalSelectionPattern + ')一肖(各)?(' + moneyPattern + ')元?$'));
        if (single) {
            const animals = zodiacList(single[1]);
            if (animals.length > 1 && !single[2]) throw new Error('多个一肖请用“各”明确每个生肖的金额，例如“平特肖鼠鸡各150”');
            return animals.map(animal => groupedRow('singleZodiac', animal + '一肖', [[animal]], single[3]));
        }
        const tail = line.match(new RegExp('^([0-9])尾(?:各)?(' + moneyPattern + ')元?$'));
        if (tail) return [groupedRow('tail', tail[1] + '尾', [[Number(tail[1])]], tail[2])];
        // 生肖可与明确号码混写，按展开后的号码逐号计费，不是一肖或连肖。
        const zodiacSpecial = line.match(new RegExp('^(?:特码|特)?([' + animalChars + '0-9\\-.,，、/\\s]+)各(' + moneyPattern + ')元?$'));
        if (zodiacSpecial && new RegExp('[' + animalChars + ']').test(zodiacSpecial[1])) {
            const animals = zodiacList((zodiacSpecial[1].match(new RegExp('[' + animalChars + ']', 'g')) || []).join(''));
            const explicitTokens = zodiacSpecial[1].match(/\d+/g) || [];
            const explicitNumbers = explicitTokens.length ? numericList(explicitTokens.join('-')) : [];
            const year = options.zodiacYear ?? defaultZodiacYear();
            const numbers = [...animals.flatMap(animal => zodiacNumbers(animal, year)), ...explicitNumbers].sort((a, b) => a - b);
            if (new Set(numbers).size !== numbers.length) throw new Error('生肖与号码存在重复，请核对后拆成不同行录入');
            const label = animals.join('') + '对应特码' + (explicitNumbers.length ? '＋' + explicitNumbers.map(n => String(n).padStart(2, '0')).join('-') : '');
            const row = groupedRow('special', label, numbers.map(n => [n]), zodiacSpecial[2]);
            row.zodiacYear = year;
            row.expandedNumbers = numbers;
            return [row];
        }
        if (new RegExp('^[' + animalChars + ']').test(line)) {
            const match = line.match(/^(.+?)(?=(?:十二|十一|[二三四五六七八九十]|[2-9]|1[012])(?:连)?肖各)(.+)$/);
            if (!match) throw new Error('连肖请写“龙拖马鸡兔羊牛五肖各10”或“龙马鸡三肖各10”');
            const parts = match[1].replace(/(?:复式|复)$/, '').split('拖');
            if (parts.length > 2) throw new Error('一条连肖只能有一个拖字');
            const anchors = parts.length === 2 ? zodiacList(parts[0]) : [];
            const candidates = zodiacList(parts[parts.length - 1]);
            if (anchors.some(value => candidates.includes(value))) throw new Error('必带生肖不能同时出现在拖码里');
            const regex = new RegExp('(十二|十一|[二三四五六七八九十]|[2-9]|1[012])(?:连)?肖各(' + moneyPattern + ')元?', 'g');
            const rates = [...match[2].matchAll(regex)];
            if (!rates.length || rates.map(rate => rate[0]).join('') !== match[2]) throw new Error('连肖组数或金额格式无法识别');
            return rates.map(rate => {
                const size = sizes[rate[1]] || Number(rate[1]);
                const groups = combinations(candidates, size - anchors.length).map(group => [...anchors, ...group].sort());
                return groupedRow('zodiacLink', match[1] + rate[1] + '连肖', groups, rate[2]);
            });
        }
        // 同一行复式和特碰共用前批号码；特碰两批配对，一特一平、不分方向。
        const pairParts = line.split(/[,，]?(?<!特)碰/);
        if (pairParts.length > 2) throw new Error('每行只支持一组“两批号码相碰”');
        const combo = pairParts[0].match(/^(.+?)(?:复|复式)((?:三中三|二中二).+)$/);
        if (combo || pairParts.length === 2) {
            // “号码特码各10复二中二各2”：两种玩法共用选号，但各自计费、独立判中。
            const specialRate = combo && combo[1].match(new RegExp('^(.+?)特码各(' + moneyPattern + ')元?$'));
            const selection = specialRate ? specialRate[1] : combo ? combo[1] : pairParts[0];
            const regular = numericList(selection);
            const rows = [];
            if (specialRate) rows.push(groupedRow('special', selection + '特码', regular.map(n => [n]), specialRate[2]));
            if (combo) {
                const regex = new RegExp('(三中三|二中二)(?:各)?(' + moneyPattern + ')元?', 'g');
                const rates = [...combo[2].matchAll(regex)];
                if (!rates.length || rates.map(rate => rate[0]).join('') !== combo[2]) throw new Error('复式玩法或金额格式无法识别');
                rates.forEach(rate => rows.push(groupedRow(rate[1] === '三中三' ? 'triple' : 'double', selection + '复' + rate[1], combinations(regular, rate[1] === '三中三' ? 3 : 2), rate[2])));
            }
            if (pairParts.length === 2) {
                const pair = pairParts[1].match(new RegExp('^(.+?)特碰各(' + moneyPattern + ')元?$'));
                if (!pair) throw new Error('特碰请写“第一批号码碰第二批号码特碰各金额”');
                const special = numericList(pair[1]);
                rows.push(crossPair(regular, special, pair[2], regular.join('-') + '碰' + special.join('-') + '（不分方向）'));
            }
            return rows;
        }
        const match = line.match(amountPattern);
        if (!match) throw new Error('请核对玩法及金额格式，每条注单占一行');
        return [groupedRow('special', match[1], expand(match[1]).map(n => [n]), match[2])];
    }
    function groupsFor(row) {
        const groups = row.groups || row.numbers.map(n => [n]);
        // 旧记录也按无方向组合读取；不去重收费条目，汇总时才合并相同组合金额。
        return row.type === 'specialPair' || row.type === 'specialPairAny'
            ? groups.filter(([p, t]) => p !== t).map(group => group.slice().sort((a, b) => a - b)) : groups;
    }
    function groupLabel(type, group) {
        const num = n => String(n).padStart(2, '0');
        if (type === 'specialPair' || type === 'specialPairAny') return `${num(group[0])}＋${num(group[1])}（任一特、另一平）`;
        if (type === 'tail') return group[0] + '尾';
        if (type === 'singleZodiac' || type === 'zodiacLink') return group.join('');
        return group.map(num).join('-');
    }
    const predicates = {
        合大: n => Math.floor(n / 10) + n % 10 >= 7,
        合小: n => Math.floor(n / 10) + n % 10 <= 6,
        合单: n => (Math.floor(n / 10) + n % 10) % 2 === 1,
        合双: n => (Math.floor(n / 10) + n % 10) % 2 === 0,
        大: n => n >= 25,
        小: n => n <= 24,
        单: n => n % 2 === 1,
        双: n => n % 2 === 0
    };

    function cents(text) {
        const [whole, fraction = ""] = text.split(".");
        const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
        if (!Number.isSafeInteger(value)) throw new Error("金额过大");
        return value;
    }

    function expand(selection) {
        const clean = selection.replace(/^(?:特码|特)/, '').replace(/特码/g, "").replace(/合数([大小单双])/g, "合$1").replace(/([大小单双])号/g, '$1').replace(/的/g, "").replace(/\/+$/, '');
        if (/^\d{1,2}(?:[-.,，、/\s]+\d{1,2})*$/.test(clean)) {
            const numbers = clean.split(/[-.,，、/\s]+/).map(Number);
            if (numbers.some(n => n < 1 || n > 49)) throw new Error("号码必须在01至49之间");
            if (new Set(numbers).size !== numbers.length) throw new Error("同一行有重复号码，请确认后删除重复项或另起一行");
            return numbers.sort((a, b) => a - b);
        }
        // “头”指十位，按对应特码逐号计费；0头不包括不存在的00号。
        if (/^[0-4]头(?:[-.,，、/\s]*[0-4]头)*$/.test(clean)) {
            const heads = [...clean.matchAll(/([0-4])头/g)].map(match => Number(match[1]));
            if (new Set(heads).size !== heads.length) throw new Error('同一条注单有重复头数，请核对');
            return Array.from({length:49},(_,i)=>i+1).filter(n=>heads.includes(Math.floor(n/10)));
        }
        const tokens = clean.match(/合[大小单双]|[大小单双]/g);
        if (!tokens || tokens.join("") !== clean) throw new Error("未识别的条件；支持大小、单双、合数条件及其组合，或明确号码列表");
        const numbers = Array.from({ length: 49 }, (_, i) => i + 1).filter(n => tokens.every(token => predicates[token](n)));
        if (!numbers.length) throw new Error("条件互相冲突，没有符合条件的号码");
        return numbers;
    }

    function splitStatements(line, options) {
        const parts = [];
        let start = 0;
        for (const match of line.matchAll(/[,，]/g)) {
            const candidate = line.slice(start, match.index).trim();
            // “复式……，碰……”仍共用前面的候选号码，不能拆开。
            if (/^\s*碰/.test(line.slice(match.index + 1))) continue;
            let probe = candidate.replace(/^(新澳|新奥|老澳|香港|新|老|香|港)\s*[:：]?\s*/, '');
            probe = probe.replace(/(?<!\d)\s+|\s+(?!\d)/g, '');
            // “特31,43各5”里的“特31”不能误认作分类合计后拆开。
            let complete = Object.hasOwn(pools, candidate.replace(/[\s:：]/g, ''));
            if (!complete) {
                try { complete = parseLine(probe, options).length > 0; } catch (_) { /* 号码列表中的逗号先保留。 */ }
            }
            if (complete) {
                parts.push(candidate);
                start = match.index + 1;
            }
        }
        const rest = line.slice(start).trim();
        if (rest) parts.push(rest);
        return parts;
    }
    function numberLines(text) {
        const lines = text.split('\n'), result = [];
        const fragment = /^\d{1,2}(?:[-.,，、/\s]+\d{1,2})*\/?$/;
        // 只续接紧邻的纯号码行；遇到空行、奖池或其他玩法立即停止，不能跨单借金额。
        const ending = /^(?:\d[\d.,，、/\s-]*(?:特码)?\s*)?(?:各(?:数)?|=)/;
        for (let i = 0; i < lines.length; i++) {
            const index = i;
            let raw = lines[i];
            if (fragment.test(raw.trim())) {
                while (i+1 < lines.length && fragment.test(lines[i+1].trim())) raw += ' ' + lines[++i].trim();
                if (i+1 < lines.length && ending.test(lines[i+1].trim())) raw += ' ' + lines[++i].trim();
            }
            result.push({raw,index,endIndex:i});
        }
        return result;
    }
    function parse(text, options = {}) {
        const rows = [], errors = [], summaries = [];
        const poolCents = { newao: 0, oldao: 0, xianggang: 0 };
        let pool = "newao";
        const chars = { 單:'单', 雙:'双', 數:'数', 碼:'码', 龍:'龙', 馬:'马', 雞:'鸡', 豬:'猪', 連:'连', 複:'复', 頭:'头' };
        const normalizedText = String(text).normalize('NFKC').replace(/\r\n?/g,'\n').replace(/[單雙數碼龍馬雞豬連複頭]/g,value=>chars[value]);
        numberLines(normalizedText).forEach(({raw,index,endIndex}) => {
            const source = raw.trim();
            if (!source) return;
            splitStatements(source, options).forEach(statement => {
                let line = statement;
                let compact = line.replace(/\s/g, "");
                const header = compact.replace(/[:：]$/, "");
                if (Object.hasOwn(pools, header)) { pool = pools[header]; return; }
                // 奖池可与首条注单写在同一行；后续行沿用，直到出现下一奖池。
                const inlinePool = line.match(/^(新澳|新奥|老澳|香港|新|老|香|港)\s*[:：]?\s*(.+)$/);
                if (inlinePool) {
                    pool = pools[inlinePool[1]];
                    line = inlinePool[2];
                    compact = line.replace(/\s/g, '');
                }
                try {
                    const summary = compact.match(summaryPattern);
                    const numberAssignment = /^(?:特码|特|平码)?\d+=/.test(compact);
                    if (summary && !numberAssignment) {
                        const sum = summary[2].split("+").reduce((total, value) => total + cents(value), 0);
                        if (!Number.isSafeInteger(sum)) throw new Error("合计金额过大");
                        if (summary[3] && sum !== cents(summary[3])) throw new Error("手写合计等式左右不一致");
                        summaries.push({ line: index + 1, cents: sum, category: summary[1] });
                        return;
                    }
                    // 保留数字之间的空格作为分隔符；中文条件和金额周围允许空格。
                    const normalized = line.replace(/(?<!\d)\s+|\s+(?!\d)/g, "");
                    const lineRows = parseLine(normalized, options);
                    const subtotalCents = lineRows.reduce((sum, row) => sum + row.subtotalCents, 0);
                    if (!Number.isSafeInteger(subtotalCents) || !Number.isSafeInteger(poolCents[pool] + subtotalCents)) throw new Error("金额过大");
                    poolCents[pool] += subtotalCents;
                    rows.push(...lineRows.map(row => ({...row, pool, line: index + 1, lineEnd:endIndex+1})));
                } catch (error) { errors.push(`第${index + 1}行：${error.message}`); }
            });
        });
        const totalCents = Object.values(poolCents).reduce((a, b) => a + b, 0);
        if (!Number.isSafeInteger(totalCents)) errors.push("总金额过大");
        summaries.forEach(summary => {
            const types = summaryTypes[summary.category];
            const expected = types ? rows.filter(row => types.includes(row.type)).reduce((sum, row) => sum + row.subtotalCents, 0) : totalCents;
            if (summary.cents !== expected) errors.push(`第${summary.line}行：${summary.category}手写合计${summary.cents / 100}与识别合计${expected / 100}不一致`);
        });
        if (!rows.length && String(text).trim()) errors.push("没有可录入的注单明细");
        const totals = { newao: poolCents.newao / 100, oldao: poolCents.oldao / 100, xianggang: poolCents.xianggang / 100, total: totalCents / 100 };
        return { rows, errors, totals, fingerprint: fingerprintForRows(rows), checked: summaries.length > 0, valid: rows.length > 0 && errors.length === 0 };
    }
    function fingerprintForRows(rows) {
        // 不同行覆盖相同号码时金额叠加；用各号码最终金额检测重复注单。
        const stakes = {};
        rows.forEach(row => {
            groupsFor(row).forEach(group => {
                const key = row.pool + ":" + (row.type === 'special' ? group[0] : row.type + ':' + group.join(','));
                stakes[key] = (stakes[key] || 0) + row.unitCents;
            });
            (row.overlapNumbers || []).forEach(number => {
                const key = row.pool + ':specialPairCharge:' + number;
                stakes[key] = (stakes[key] || 0) + row.unitCents;
            });
        });
        return JSON.stringify(Object.keys(stakes).sort().map(key => [key, stakes[key]]));
    }

    function appendToLedger(state, text, date, createdAt, options = {}) {
        const parsed = parse(text, options);
        if (!parsed.valid) throw new Error(parsed.errors.join("\n") || "请先填写注单");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("记账日期无效");
        const next = JSON.parse(JSON.stringify(state));
        const days = next.dailyBetTotals && !Array.isArray(next.dailyBetTotals) ? next.dailyBetTotals : {};
        const day = days[date] || {};
        for (const key of ["newao", "oldao", "xianggang", "total"]) {
            day[key] = Math.round(((Number(day[key]) || 0) + parsed.totals[key]) * 100) / 100;
        }
        day.count = (Number(day.count) || 0) + 1;
        days[date] = day;
        next.dailyBetTotals = days;
        next.total = Math.round(((Number(next.total) || 0) + parsed.totals.total) * 100) / 100;
        next.textBetSlips = Array.isArray(next.textBetSlips) ? next.textBetSlips : [];
        next.textBetSlips.push({ date, createdAt, text, rows: parsed.rows, totals: parsed.totals, fingerprint: parsed.fingerprint });
        return next;
    }

    function activeRows(slip) {
        return slip.deletedAt ? [] : (slip.rows || []).filter(row => !row.deletedAt);
    }
    function totalsForRows(rows) {
        const sums = {newao:0,oldao:0,xianggang:0,total:0};
        for (const row of rows) {
            if (!Object.hasOwn(poolNames,row.pool)) throw new Error('注单奖池无效，未修改记录');
            const amount = row.subtotalCents ?? (row.billedGroupCount ?? (row.groups || row.numbers.map(n=>[n])).length) * row.unitCents;
            if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('注单金额无效，未修改记录');
            sums[row.pool] += amount; sums.total += amount;
        }
        if (!Object.values(sums).every(Number.isSafeInteger)) throw new Error('注单金额过大，未修改记录');
        return Object.fromEntries(Object.entries(sums).map(([key,value])=>[key,value/100]));
    }
    function updateDeletedTotals(next, previous, changed) {
        const beforeRows = activeRows(previous), afterRows = activeRows(changed);
        const before = totalsForRows(beforeRows), after = totalsForRows(afterRows);
        changed.totals = after;
        changed.fingerprint = fingerprintForRows(afterRows);
        const slips = next.textBetSlips || [];
        const dateSlips = slips.filter(slip=>slip.date===changed.date);
        const actual = totalsForRows(dateSlips.flatMap(activeRows));
        next.dailyBetTotals = next.dailyBetTotals && !Array.isArray(next.dailyBetTotals) ? next.dailyBetTotals : {};
        const day = next.dailyBetTotals[changed.date] || {};
        for (const key of ['newao','oldao','xianggang','total']) {
            day[key] = typeof day[key] === 'number' ? Math.round((day[key]-before[key]+after[key])*100)/100 : actual[key];
        }
        day.count = typeof day.count === 'number' ? day.count-Number(beforeRows.length>0)+Number(afterRows.length>0) : dateSlips.filter(slip=>activeRows(slip).length>0).length;
        next.dailyBetTotals[changed.date] = day;
        next.total = typeof next.total === 'number' ? Math.round((next.total-before.total+after.total)*100)/100 : totalsForRows(slips.flatMap(activeRows)).total;
    }
    function deleteLedgerEntry(state, selection, deletedAt) {
        const {slipIndex,rowIndex=null,expected} = selection;
        if (!Number.isInteger(slipIndex) || slipIndex < 0) throw new Error('请选择有效的注单');
        const previous = state.textBetSlips?.[slipIndex];
        if (!previous || previous.deletedAt || !activeRows(previous).length) throw new Error('该注单已删除或不存在，请刷新');
        // 数组不删除、不重排；快照校验防止其他页面更新后误删对应索引。
        if (typeof expected !== 'string' || JSON.stringify(previous) !== expected) throw new Error('该注单已在其他页面发生变化，请核对后重试');
        if (rowIndex !== null && (!Number.isInteger(rowIndex) || rowIndex < 0 || !previous.rows?.[rowIndex] || previous.rows[rowIndex].deletedAt)) throw new Error('该明细已删除或不存在');
        if (!deletedAt || Number.isNaN(Date.parse(deletedAt))) throw new Error('删除时间无效');
        const next = JSON.parse(JSON.stringify(state));
        next.deletionHistory = next.deletionHistory || [];
        const id = next.deletionHistory.reduce((max,event)=>Math.max(max,event.id),0)+1;
        const changed = next.textBetSlips[slipIndex];
        const target = rowIndex === null ? changed : changed.rows[rowIndex];
        const amount = rowIndex === null ? totalsForRows(activeRows(changed)).total : totalsForRows([target]).total;
        target.deletedAt = deletedAt;
        target.deletionId = id;
        next.deletionHistory.push({id,date:changed.date,slipIndex,rowIndex,deletedAt,amount});
        updateDeletedTotals(next,previous,changed);
        return next;
    }
    function lastDeletion(state, date) {
        return (state.deletionHistory || []).slice().reverse().find(event=>event.date===date && !event.restoredAt) || null;
    }
    function restoreLastDeletion(state, date, expectedId, restoredAt) {
        const event = lastDeletion(state,date);
        if (!event || event.id !== expectedId) throw new Error('删除记录已变化，请核对后重试');
        const previous = state.textBetSlips?.[event.slipIndex];
        const target = event.rowIndex === null ? previous : previous?.rows?.[event.rowIndex];
        if (!target?.deletedAt || target.deletionId !== event.id || (event.rowIndex !== null && previous.deletedAt)) throw new Error('该条记录已变化，无法撤销本次删除');
        if (!restoredAt || Number.isNaN(Date.parse(restoredAt))) throw new Error('恢复时间无效');
        const next = JSON.parse(JSON.stringify(state));
        const changed = next.textBetSlips[event.slipIndex];
        const restored = event.rowIndex === null ? changed : changed.rows[event.rowIndex];
        delete restored.deletedAt;
        delete restored.deletionId;
        next.deletionHistory.find(item=>item.id===event.id).restoredAt = restoredAt;
        updateDeletedTotals(next,previous,changed);
        return next;
    }

    const api = { parse, expand, appendToLedger, poolNames, typeNames, combinations, groupsFor, groupLabel, zodiacNumbers, fingerprintForRows, activeRows, totalsForRows, deleteLedgerEntry, lastDeletion, restoreLastDeletion };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.BetSlip = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
