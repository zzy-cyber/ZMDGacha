/**
 * 计算层回归校验（只读校验，不会修改交付文件）。
 *
 * 目的：本次改版把「是否抽取 / 当日获取 / 上半卡池时间已过」从版本卡片
 * 移到了结果表的勾选项，calc.js 的推演函数也顺带重构过。这个脚本用
 * **改造前的原始算法** 作为参照实现，对大量随机场景逐字段比对结果，
 * 确保重构没有改变任何抽卡数值。
 *
 * 运行：node .verify/diff-calc.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ======================== 载入当前实现 ========================

const ROOT = path.join(__dirname, '..', 'js');
const win = {};
const sandbox = { window: win, console: console };
vm.createContext(sandbox);

['core/namespace.js', 'core/util.js', 'core/calc.js'].forEach(function (rel) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
});

const util = win.ZMD.util;
const calc = win.ZMD.calc;

// ======================== 改造前的参照实现 ========================
// 以下函数逐行照抄改造前的 js/core/calc.js（仅 resolveHalf / run 及其依赖），
// 作为差分测试的基准。改动这些代码会让校验失去意义。

const RATES = {
    crystalJadePerPull: 500,
    guaranteeQuotaPerPull: 25,
    sourceStoneFree: 29,
    sourceStonePulls: 75,
    sourceStonePerPull: 500,
    arsenalQuotaPerPull: 1980,
    pullsPerRole: 120,
    firstHalfRatio: 0.55
};

const SCALE_LABELS = { large: '大版本', small: '小版本', custom: '自定义版本' };

function labelOfScale(scale) {
    return SCALE_LABELS[scale] || SCALE_LABELS.large;
}

function buildPullContext(resources) {
    const r = resources || {};
    const includeSS = r.includeSourceStone !== false;
    const crystalJadePulls = Math.floor(util.toInt(r.crystalJade) / RATES.crystalJadePerPull);
    const guaranteeQuotaPulls = Math.floor(util.toInt(r.guaranteeQuota) / RATES.guaranteeQuotaPerPull);
    const stoneValue = util.toInt(r.sourceStone);
    const sourceStonePulls = includeSS && stoneValue > RATES.sourceStoneFree
        ? Math.floor((stoneValue - RATES.sourceStoneFree) * RATES.sourceStonePulls / RATES.sourceStonePerPull)
        : 0;
    const arsenalQuotaPulls = parseFloat((util.toInt(r.arsenalQuota) / RATES.arsenalQuotaPerPull).toFixed(1));
    const manualPulls = util.toInt(r.manualPulls);

    return {
        crystalJadePulls: crystalJadePulls,
        guaranteeQuotaPulls: guaranteeQuotaPulls,
        sourceStonePulls: sourceStonePulls,
        arsenalQuotaPulls: arsenalQuotaPulls,
        manualPulls: manualPulls,
        includeSourceStone: includeSS,
        totalPulls: crystalJadePulls + guaranteeQuotaPulls + sourceStonePulls + manualPulls,
        sourceStoneAmount: stoneValue,
        arsenalQuotaAmount: util.toInt(r.arsenalQuota)
    };
}

function getVersionPullInfo(version, settings) {
    const v = version || {};
    const cfg = settings || {};
    const isCustom = v.scale === 'custom';
    const isLarge = v.scale === 'large';
    const defaultLarge = cfg.defaultLargePulls || 104;
    const defaultSmall = cfg.defaultSmallPulls || 73;

    const totalPulls = isCustom
        ? (v.customTotalPulls || 0)
        : (isLarge ? (v.largePulls || defaultLarge) : (v.smallPulls || defaultSmall));

    if (v.roleCount !== 2) {
        return { totalPulls: totalPulls, half1Pulls: totalPulls, half2Pulls: 0, half2Label: null, half1Label: '全版本' };
    }

    let half1Pulls;
    let half2Pulls;
    if (isCustom) {
        half1Pulls = v.customHalf1Pulls || 0;
        half2Pulls = Math.max(0, totalPulls - half1Pulls);
    } else {
        half1Pulls = Math.floor(totalPulls * RATES.firstHalfRatio);
        half2Pulls = totalPulls - half1Pulls;
    }

    return { totalPulls: totalPulls, half1Pulls: half1Pulls, half2Pulls: half2Pulls, half1Label: '上半', half2Label: '下半' };
}

function oldResolveHalf(ctx, options) {
    const halfPulls = util.toInt(options.halfPulls);
    const skip = !!(options.skipHalf && options.hasHalf2);
    const willPull = skip ? false : !!options.willPull;
    const dayOne = willPull && !!options.dayOne;

    const step = {
        versionLabel: options.versionLabel,
        halfLabel: options.halfLabel,
        roleName: options.roleName,
        halfPulls: halfPulls,
        dayOne: dayOne,
        willPull: willPull,
        skipHalf: skip,
        beforeJudgment: ctx.currentTotal,
        enough: null,
        afterDeduct: null,
        finalTotal: ctx.currentTotal
    };

    if (skip) return step;

    if (!willPull) {
        ctx.currentTotal += halfPulls;
        step.beforeJudgment = ctx.currentTotal - halfPulls;
        step.finalTotal = ctx.currentTotal;
        return step;
    }

    let enough;
    if (dayOne) {
        enough = ctx.currentTotal >= RATES.pullsPerRole;
        if (enough) ctx.currentTotal -= RATES.pullsPerRole;
        step.afterDeduct = ctx.currentTotal;
        ctx.currentTotal += halfPulls;
    } else {
        ctx.currentTotal += halfPulls;
        step.beforeJudgment = ctx.currentTotal;
        enough = ctx.currentTotal >= RATES.pullsPerRole;
        if (enough) ctx.currentTotal -= RATES.pullsPerRole;
        step.afterDeduct = ctx.currentTotal;
    }

    step.enough = enough;
    step.finalTotal = ctx.currentTotal;
    return step;
}

function oldRun(versionDataList, resources, settings) {
    const pullContext = buildPullContext(resources);
    const ctx = { currentTotal: pullContext.totalPulls };
    const steps = [];
    const list = versionDataList || [];

    list.forEach(function (version, index) {
        const vInfo = getVersionPullInfo(version, settings);
        const versionLabel = '版本' + (index + 1) + '（' + labelOfScale(version.scale) + '）';

        const income = util.toInt(version.versionIncome);
        if (income > 0) {
            ctx.currentTotal += income;
            steps.push({ isIncome: true, versionLabel: versionLabel, income: income, finalTotal: ctx.currentTotal });
        }

        steps.push(oldResolveHalf(ctx, {
            versionLabel: versionLabel,
            halfLabel: vInfo.half1Label,
            roleName: version.role1Name || '角色1',
            halfPulls: vInfo.half1Pulls,
            hasHalf2: !!vInfo.half2Label,
            willPull: version.role1Pull,
            dayOne: version.role1DayOne,
            skipHalf: version.skipHalf1
        }));

        if (vInfo.half2Label) {
            steps.push(oldResolveHalf(ctx, {
                versionLabel: versionLabel,
                halfLabel: vInfo.half2Label,
                roleName: version.role2Name || '角色2',
                halfPulls: vInfo.half2Pulls,
                hasHalf2: true,
                willPull: version.role2Pull,
                dayOne: version.role2DayOne,
                skipHalf: false
            }));
        }
    });

    const pullSteps = steps.filter(function (step) { return step.willPull; });

    return {
        initialTotal: pullContext.totalPulls,
        finalTotal: ctx.currentTotal,
        steps: steps,
        targetCount: pullSteps.length,
        enoughCount: pullSteps.filter(function (s) { return s.enough === true; }).length,
        shortCount: pullSteps.filter(function (s) { return s.enough === false; }).length
    };
}

// ======================== 随机场景 ========================

/** 可复现的伪随机数（固定种子） */
let seed = 20240607;
function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
}

function randInt(min, max) {
    return min + Math.floor(rand() * (max - min + 1));
}

function pick(list) {
    return list[randInt(0, list.length - 1)];
}

function randomResources() {
    return {
        crystalJade: randInt(0, 60000),
        guaranteeQuota: randInt(0, 400),
        sourceStone: randInt(0, 120),
        arsenalQuota: randInt(0, 8000),
        manualPulls: randInt(-60, 120),
        includeSourceStone: rand() > 0.3
    };
}

function randomVersion() {
    const scale = pick(['large', 'small', 'custom']);
    const roleCount = pick([1, 2]);
    const total = randInt(0, 260);
    return {
        versionName: '', // 名称不参与差分（标签规则已刻意变更）
        scale: scale,
        roleCount: roleCount,
        largePulls: randInt(0, 200),
        smallPulls: randInt(0, 200),
        customTotalPulls: total,
        customHalf1Pulls: randInt(0, total),
        role1Name: pick(['', '角色A', '阿尔法']),
        role1Pull: rand() > 0.25,
        role1DayOne: rand() > 0.5,
        role2Name: pick(['', '角色B', '贝塔']),
        role2Pull: rand() > 0.25,
        role2DayOne: rand() > 0.5,
        versionIncome: pick([0, 0, 0, 20, 55, 104]),
        skipHalf1: rand() > 0.7
    };
}

function randomSettings() {
    return { defaultLargePulls: randInt(1, 200), defaultSmallPulls: randInt(1, 200) };
}

/** 只比对改造前就存在的字段 */
const STEP_FIELDS = ['isIncome', 'versionLabel', 'halfLabel', 'roleName', 'halfPulls',
    'dayOne', 'willPull', 'skipHalf', 'beforeJudgment', 'enough', 'afterDeduct', 'finalTotal', 'income'];

function normalize(steps) {
    return steps.map(function (step) {
        const out = {};
        STEP_FIELDS.forEach(function (field) { out[field] = step[field]; });
        return out;
    });
}

// ======================== 执行比对 ========================

const SCENARIOS = 20000;
let mismatch = 0;
const samples = [];

for (let i = 0; i < SCENARIOS; i += 1) {
    const resources = randomResources();
    const settings = randomSettings();
    const list = [];
    const versionCount = randInt(0, 4);
    for (let v = 0; v < versionCount; v += 1) list.push(randomVersion());

    const expected = oldRun(list, resources, settings);
    const actual = calc.run(list, resources, settings);

    const problems = [];
    if (expected.initialTotal !== actual.initialTotal) problems.push('initialTotal');
    if (expected.finalTotal !== actual.finalTotal) problems.push('finalTotal');
    if (expected.targetCount !== actual.targetCount) problems.push('targetCount');
    if (expected.enoughCount !== actual.enoughCount) problems.push('enoughCount');
    if (expected.shortCount !== actual.shortCount) problems.push('shortCount');
    if (JSON.stringify(normalize(expected.steps)) !== JSON.stringify(normalize(actual.steps))) problems.push('steps');

    if (problems.length) {
        mismatch += 1;
        if (samples.length < 3) samples.push({ resources: resources, settings: settings, list: list, problems: problems });
    }
}

console.log('差分场景：' + SCENARIOS + ' 组（资源随机 + 0~4 个版本随机 + 版本收入 / 当日 / 跳过随机）');
console.log('字段比对：initialTotal / finalTotal / targetCount / enoughCount / shortCount / steps（逐字段）');

if (mismatch === 0) {
    console.log('✅ 与改造前算法完全一致，抽卡数值未发生任何变化');
} else {
    console.log('❌ 存在 ' + mismatch + ' 组差异，示例：');
    samples.forEach(function (sample, index) {
        console.log('--- 场景 ' + (index + 1) + ' 差异字段：' + sample.problems.join(', '));
        console.log(JSON.stringify(sample));
    });
}

// ======================== 补充：新增字段与名称标签 ========================

function expect(condition, label, extra) {
    if (condition) {
        console.log('  ✅ ' + label);
    } else {
        console.log('  ❌ ' + label + (extra === undefined ? '' : '  → ' + extra));
        mismatch += 1;
    }
}

console.log('\n结果表勾选项所需的步骤元数据：');
const metaList = [
    { versionName: '星尘', scale: 'large', roleCount: 2, role1Pull: true, role1DayOne: true, role2Pull: false, skipHalf1: true, role1Name: 'A', role2Name: 'B' }
];
const metaResult = calc.run(metaList, { crystalJade: 0 }, { defaultLargePulls: 104, defaultSmallPulls: 73 });
const half1 = metaResult.steps[0];
const half2 = metaResult.steps[1];

expect(metaResult.steps.length === 2, '双角色版本产出 2 个步骤');
expect(half1.versionIndex === 0 && half1.roleIndex === 1 && half1.isHalf1 === true && half1.hasHalf2 === true,
    '上半步骤带有 版本序号 / 角色序号 / 上半标记 / 双角色标记');
expect(half2.versionIndex === 0 && half2.roleIndex === 2 && half2.isHalf1 === false && half2.hasHalf2 === true,
    '下半步骤带有对应元数据');
expect(half1.pullRequested === true && half1.dayOneRequested === true, '保留原始勾选值（抽取 / 当日）');
expect(half1.skipHalf === true && half1.willPull === false, '上半卡池时间已过 → 不计入抽取目标');
expect(half2.pullRequested === false && half2.willPull === false, '下半未勾选抽取');
expect(half1.versionLabel === '星尘（大版本）', '版本标签使用自定义名称', half1.versionLabel);
expect(calc.versionLabelOf({ scale: 'small' }, 2) === '版本3（小版本）', '未命名时回退为「版本N（规模）」', calc.versionLabelOf({ scale: 'small' }, 2));
expect(calc.versionLabelOf({ versionName: '   ', scale: 'custom' }, 0) === '版本1（自定义版本）', '空白名称同样回退');

console.log('\n———————————————————————————————');
if (mismatch === 0) {
    console.log('✅ 全部通过');
    process.exit(0);
}
console.log('❌ 存在差异');
process.exit(1);
