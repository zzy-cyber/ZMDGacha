/**
 * 纯计算层：资源换算与「版本规划 → 抽卡步骤」的推演引擎。
 *
 * 关键特性：本文件完全不接触 DOM，只依赖传入的普通对象。
 * 因此这套规则可以单独测试、也可以被未来的新界面（导出报告、模拟器等）复用。
 *
 * 换算规则（与原实现一致）：
 *   嵌晶玉   500 个 = 1 抽（向下取整）
 *   保障配额 25 个  = 1 抽（向下取整）
 *   衍质源石 超出 29 的部分按 75/500 折算（向下取整），不超过 29 记 0
 *   武库配额 1980 个 = 1 抽（保留 1 位小数，不计入总抽数）
 *   手动抽数 直接计入总抽数，可为负数
 *   每个角色按 120 抽结算，支持「当日获取」（先扣后加）
 *   列表最后一个干员：当日获取且资源足够时，「扣除后抽数」直接计入本半场抽数
 *   （即等于最终剩余；其它行必须保持「未计入本半场」，否则会与下一步的判断冲突）
 *   双角色版本按上半 55%（向下取整）、下半 45% 分配
 *
 * 武库配额推演（可选功能，由 settings.arsenalPlanEnabled 控制）：
 *   卡池抽取收入：每个「实际抽取」的角色卡池 +8160 武库配额（即 4.12 抽），
 *                 双角色版本两个卡池都抽就加两次；未抽取 / 已跳过的卡池不加；
 *   武器抽取支出：每个角色各自的武器独立结算，各 -15840 武库配额（即 8 抽），
 *                 两个角色的武器都抽就扣两次；只有该角色确实抽取时才结算。
 *   结果只影响「武库配额抽数」，不影响总抽数。
 */
(function (ZMD) {
    'use strict';

    var util = ZMD.util;

    // ======================== 常量 ========================

    /** 抽数换算比例。修改数值即可调整规则，无需改动其他代码。 */
    var RATES = {
        /** 嵌晶玉：多少数量折算 1 抽 */
        crystalJadePerPull: 500,
        /** 保障配额：多少数量折算 1 抽 */
        guaranteeQuotaPerPull: 25,
        /** 衍质源石：免费额度 + 每抽需要的数量 */
        sourceStoneFree: 29,
        sourceStonePulls: 75,
        sourceStonePerPull: 500,
        /** 武库配额：多少数量折算 1 抽 */
        arsenalQuotaPerPull: 1980,
        /**
         * 武库配额推演数值（受设置里的功能开关控制，默认不参与计算）：
         * 每个被抽取的卡池提供的武库配额收入 / 每把武器抽取的固定支出。
         */
        arsenalQuotaPerPoolPull: 8160,
        arsenalQuotaPerWeaponPull: 15840,
        /** 每个角色需要准备多少抽 */
        pullsPerRole: 120,
        /** 双角色版本上半占比 */
        firstHalfRatio: 0.55
    };

    /** 版本规模的中文名，用于结果表格展示。 */
    var SCALE_LABELS = {
        large: '大版本',
        small: '小版本',
        custom: '自定义版本'
    };

    function labelOfScale(scale) {
        return SCALE_LABELS[scale] || SCALE_LABELS.large;
    }

    /**
     * 版本的展示名：优先使用用户自定义名称，未命名时退回「版本N」。
     * @param {object} version
     * @param {number} index 版本序号（从 0 开始）
     * @returns {string} 形如「星尘（大版本）」
     */
    function versionLabelOf(version, index) {
        var v = version || {};
        var custom = String(v.versionName == null ? '' : v.versionName).trim();
        var base = custom || ('版本' + (index + 1));
        return base + '（' + labelOfScale(v.scale) + '）';
    }

    // ======================== 资源换算 ========================

    /** 嵌晶玉 → 抽数 */
    function crystalJadeToPulls(amount) {
        return Math.floor(util.toInt(amount) / RATES.crystalJadePerPull);
    }

    /** 保障配额 → 抽数 */
    function guaranteeQuotaToPulls(amount) {
        return Math.floor(util.toInt(amount) / RATES.guaranteeQuotaPerPull);
    }

    /** 衍质源石 → 抽数（只计算超出免费额度的部分） */
    function sourceStoneToPulls(amount) {
        var value = util.toInt(amount);
        if (value <= RATES.sourceStoneFree) return 0;
        return Math.floor((value - RATES.sourceStoneFree) * RATES.sourceStonePulls / RATES.sourceStonePerPull);
    }

    /** 武库配额 → 抽数（保留 1 位小数） */
    function arsenalQuotaToPulls(amount) {
        var pulls = util.toInt(amount) / RATES.arsenalQuotaPerPull;
        return parseFloat(pulls.toFixed(1));
    }

    /** 武库配额数量 → 抽数（用于展示收入 / 支出折算，同样保留 1 位小数） */
    function arsenalAmountToPulls(amount) {
        return parseFloat((util.toInt(amount) / RATES.arsenalQuotaPerPull).toFixed(1));
    }

    /**
     * 汇总资源换算结果。
     * 注意：武库配额不计入 totalPulls，只在这里换算成抽数备用。
     * @param {object} resources 资源原始数量 { crystalJade, guaranteeQuota, sourceStone, arsenalQuota, manualPulls, includeSourceStone }
     * @returns {object} 含各项抽数与总抽数
     */
    function buildPullContext(resources) {
        var r = resources || {};
        var includeSS = r.includeSourceStone !== false;

        var crystalJadePulls = crystalJadeToPulls(r.crystalJade);
        var guaranteeQuotaPulls = guaranteeQuotaToPulls(r.guaranteeQuota);
        var sourceStonePulls = includeSS ? sourceStoneToPulls(r.sourceStone) : 0;
        var arsenalBasePulls = arsenalQuotaToPulls(r.arsenalQuota);
        var manualPulls = util.toInt(r.manualPulls);

        return {
            crystalJadePulls: crystalJadePulls,
            guaranteeQuotaPulls: guaranteeQuotaPulls,
            sourceStonePulls: sourceStonePulls,
            manualPulls: manualPulls,
            includeSourceStone: includeSS,
            totalPulls: crystalJadePulls + guaranteeQuotaPulls + sourceStonePulls + manualPulls,
            sourceStoneAmount: util.toInt(r.sourceStone),
            /** 手填武库配额的数量与换算抽数（推演的「初始值」） */
            arsenalQuotaAmount: util.toInt(r.arsenalQuota),
            arsenalBasePulls: arsenalBasePulls,
            /** 卡池抽取收入（抽数），由 calc.run 填充 */
            arsenalGainPulls: 0,
            /** 武器抽取支出（抽数，正数表示支出），由 calc.run 填充 */
            arsenalCostPulls: 0,
            /** 推演结束后的武库配额抽数，由 calc.run 填充 */
            arsenalTotalPulls: arsenalBasePulls
        };
    }

    // ======================== 版本抽数分配 ========================

    /**
     * 解析一个版本的总抽数 / 上半 / 下半分配。
     * @param {object} version
     * @param {object} settings { defaultLargePulls, defaultSmallPulls }
     */
    function getVersionPullInfo(version, settings) {
        var v = version || {};
        var cfg = settings || {};
        var isCustom = v.scale === 'custom';
        var isLarge = v.scale === 'large';
        var defaultLarge = cfg.defaultLargePulls || 104;
        var defaultSmall = cfg.defaultSmallPulls || 73;

        var totalPulls = isCustom
            ? (v.customTotalPulls || 0)
            : (isLarge ? (v.largePulls || defaultLarge) : (v.smallPulls || defaultSmall));

        // 单角色版本：全部抽数集中在「全版本」这一个半场
        if (v.roleCount !== 2) {
            return {
                totalPulls: totalPulls,
                half1Pulls: totalPulls,
                half2Pulls: 0,
                half2Label: null,
                half1Label: '全版本'
            };
        }

        // 双角色版本
        var half1Pulls;
        var half2Pulls;
        if (isCustom) {
            half1Pulls = v.customHalf1Pulls || 0;
            half2Pulls = Math.max(0, totalPulls - half1Pulls);
        } else {
            half1Pulls = Math.floor(totalPulls * RATES.firstHalfRatio);
            half2Pulls = totalPulls - half1Pulls;
        }

        return {
            totalPulls: totalPulls,
            half1Pulls: half1Pulls,
            half2Pulls: half2Pulls,
            half1Label: '上半',
            half2Label: '下半'
        };
    }

    // ======================== 推演引擎 ========================

    /**
     * 处理一个半场（或单角色版本）的抽卡步骤。
     *
     * 原先单角色/双角色、上半/下半、抽/不抽、当日/非当日共 6 段几乎相同的代码，
     * 在这里收敛为一条路径。三种模式的顺序差异是规则本身，全部保留：
     *  - 不抽取：先把半场抽数加入总数，记录「判断时总抽数」用于展示；
     *  - 当日获取：先判断是否够 120 抽，够则扣除，再加入本半场抽数；
     *  - 普通抽取：先加入本半场抽数，再判断并扣除 120 抽。
     *
     * 步骤里同时保留了「原始勾选值」（pullRequested / dayOneRequested），
     * 界面据此渲染结果表中的勾选框；willPull / dayOne 是参与推演的有效值。
     *
     * @param {object} ctx 推演上下文 { currentTotal }
     * @param {object} options
     * @returns {object} 步骤记录
     */
    function resolveHalf(ctx, options) {
        var halfPulls = util.toInt(options.halfPulls);
        var skip = !!(options.skipHalf && options.hasHalf2);
        var pullRequested = !!options.willPull;
        var dayOneRequested = !!options.dayOne;
        // 已跳过（上半卡池时间已过）的半场不算作抽取目标，也不参与判断
        var willPull = skip ? false : pullRequested;
        var dayOne = willPull && dayOneRequested;

        var step = {
            versionIndex: options.versionIndex,
            roleIndex: options.roleIndex,
            isHalf1: !!options.isHalf1,
            hasHalf2: !!options.hasHalf2,
            versionLabel: options.versionLabel,
            halfLabel: options.halfLabel,
            roleName: options.roleName,
            halfPulls: halfPulls,
            pullRequested: pullRequested,
            dayOneRequested: dayOneRequested,
            dayOne: dayOne,
            willPull: willPull,
            skipHalf: skip,
            beforeJudgment: ctx.currentTotal,
            enough: null,
            afterDeduct: null,
            /** 「扣除后抽数」是否已经计入本半场抽数（仅列表最后一个干员会出现） */
            afterDeductWithHalf: false,
            finalTotal: ctx.currentTotal
        };

        if (skip) {
            // 已跳过上半卡池：本半场抽数不计入总抽数
            return step;
        }

        if (!willPull) {
            // 不抽取：抽数照常累加，此时不产生 120 抽的判断
            ctx.currentTotal += halfPulls;
            step.beforeJudgment = ctx.currentTotal - halfPulls;
            step.finalTotal = ctx.currentTotal;
            return step;
        }

        var enough;
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

    /**
     * 按版本顺序推演整份规划。
     * @param {Array} versionDataList
     * @param {object} resources 资源原始数量
     * @param {object} settings { defaultLargePulls, defaultSmallPulls, arsenalPlanEnabled }
     * @returns {{initialTotal:number, finalTotal:number, steps:Array, targetCount:number, enoughCount:number, shortCount:number, pullContext:object, arsenal:object}}
     */
    function run(versionDataList, resources, settings) {
        var cfg = settings || {};
        // 武库配额推演是可开关功能：关闭时只把手填的武库配额换算成抽数，不做任何加减
        var useArsenal = !!cfg.arsenalPlanEnabled;

        var pullContext = buildPullContext(resources);
        var ctx = { currentTotal: pullContext.totalPulls };
        var steps = [];
        var list = versionDataList || [];

        // 武库配额：推演过程中的累计值（单位：抽，保留 1 位小数）
        var arsenal = {
            enabled: useArsenal,
            basePulls: pullContext.arsenalBasePulls,
            current: pullContext.arsenalBasePulls,
            gainPulls: 0,
            costPulls: 0,
            /** 产生收入的卡池数（= 实际抽取的角色数） */
            gainCount: 0,
            /** 抽取的武器数（= 勾选武器的角色数） */
            weaponCount: 0,
            totalPulls: pullContext.arsenalBasePulls
        };

        list.forEach(function (version, index) {
            var vInfo = getVersionPullInfo(version, settings);
            var versionLabel = versionLabelOf(version, index);

            // 版本收入：在抽取之前先加入总抽数
            var income = util.toInt(version.versionIncome);
            if (income > 0) {
                ctx.currentTotal += income;
                steps.push({
                    isIncome: true,
                    versionIndex: index,
                    versionLabel: versionLabel,
                    income: income,
                    arsenalDeltaPulls: 0,
                    arsenalTotalPulls: arsenal.current,
                    finalTotal: ctx.currentTotal
                });
            }

            // 上半（单角色版本即「全版本」）
            steps.push(resolveHalf(ctx, {
                versionIndex: index,
                roleIndex: 1,
                isHalf1: true,
                hasHalf2: !!vInfo.half2Label,
                versionLabel: versionLabel,
                halfLabel: vInfo.half1Label,
                roleName: version.role1Name || '角色1',
                halfPulls: vInfo.half1Pulls,
                willPull: version.role1Pull,
                dayOne: version.role1DayOne,
                skipHalf: version.skipHalf1
            }));

            // 下半（双角色版本才有）
            if (vInfo.half2Label) {
                steps.push(resolveHalf(ctx, {
                    versionIndex: index,
                    roleIndex: 2,
                    isHalf1: false,
                    hasHalf2: true,
                    versionLabel: versionLabel,
                    halfLabel: vInfo.half2Label,
                    roleName: version.role2Name || '角色2',
                    halfPulls: vInfo.half2Pulls,
                    willPull: version.role2Pull,
                    dayOne: version.role2DayOne,
                    skipHalf: false
                }));
            }

            // 卡池抽取收入：只要该角色卡池实际抽取（未被跳过 / 未取消勾选）就 +8160
            var pullSteps = steps.filter(function (step) {
                return !step.isIncome && step.versionIndex === index;
            });
            pullSteps.forEach(function (step) {
                step.arsenalGainQuota = 0;
                step.arsenalWeaponQuota = 0;
                step.arsenalDeltaPulls = 0;
                step.arsenalTotalPulls = arsenal.current;
                if (!step.willPull) return;

                step.arsenalGainQuota = RATES.arsenalQuotaPerPoolPull;
                var gainPulls = arsenalAmountToPulls(RATES.arsenalQuotaPerPoolPull);
                if (useArsenal) {
                    arsenal.current = parseFloat((arsenal.current + gainPulls).toFixed(1));
                    arsenal.gainPulls = parseFloat((arsenal.gainPulls + gainPulls).toFixed(1));
                    arsenal.gainCount += 1;
                }
                step.arsenalDeltaPulls = gainPulls;
                step.arsenalTotalPulls = arsenal.current;
            });

            // 武器抽取支出：每个角色各自的武器独立结算，每个固定 -15840（= 8 抽）。
            // 只有该角色确实要抽（willPull）时才扣；不抽该角色时武器开销没有意义。
            // 收入与支出都记在各自那一行，表格按行顺序展示即可看懂收支。
            pullSteps.forEach(function (step) {
                if (!step.willPull) return;
                if (!useArsenal || !version['role' + step.roleIndex + 'Weapon']) return;

                step.weaponPull = true;
                step.arsenalWeaponQuota = RATES.arsenalQuotaPerWeaponPull;

                var costPulls = arsenalAmountToPulls(RATES.arsenalQuotaPerWeaponPull);
                arsenal.current = parseFloat((arsenal.current - costPulls).toFixed(1));
                arsenal.costPulls = parseFloat((arsenal.costPulls + costPulls).toFixed(1));
                arsenal.weaponCount += 1;

                step.arsenalDeltaPulls = parseFloat((step.arsenalDeltaPulls - costPulls).toFixed(1));
                step.arsenalTotalPulls = arsenal.current;
            });
        });

        // 列表最后一个干员：当日获取且资源足够时，「扣除后抽数」直接把本半场抽数计入。
        // 「当日获取」是「先扣 120、再加入本半场抽数」，中间这一行在其它干员身上必须保持
        // 「未计入本半场」，因为下一步判断要以它为基准；但最后一个干员后面没有步骤，
        // 这里直接把半场抽数加上，读者看到的就是规划结束时的剩余（与 finalTotal 相同）。
        // 非当日模式本来就是「先加半场、再扣 120」，扣除后抽数自然已经含本半场，无需处理。
        var lastRoleStep = null;
        for (var i = steps.length - 1; i >= 0; i -= 1) {
            if (!steps[i].isIncome) {
                lastRoleStep = steps[i];
                break;
            }
        }
        if (lastRoleStep && lastRoleStep.dayOne && lastRoleStep.enough === true) {
            lastRoleStep.afterDeduct = lastRoleStep.finalTotal;
            lastRoleStep.afterDeductWithHalf = true;
        }

        arsenal.totalPulls = parseFloat(arsenal.current.toFixed(1));
        pullContext.arsenalGainPulls = arsenal.gainPulls;
        pullContext.arsenalCostPulls = arsenal.costPulls;
        pullContext.arsenalTotalPulls = arsenal.totalPulls;

        var countedSteps = steps.filter(function (step) { return step.willPull; });
        var enoughCount = countedSteps.filter(function (step) { return step.enough === true; }).length;
        var shortCount = countedSteps.filter(function (step) { return step.enough === false; }).length;

        return {
            pullContext: pullContext,
            initialTotal: pullContext.totalPulls,
            finalTotal: ctx.currentTotal,
            steps: steps,
            targetCount: countedSteps.length,
            enoughCount: enoughCount,
            shortCount: shortCount,
            arsenal: arsenal
        };
    }

    ZMD.calc = {
        RATES: RATES,
        labelOfScale: labelOfScale,
        versionLabelOf: versionLabelOf,
        crystalJadeToPulls: crystalJadeToPulls,
        guaranteeQuotaToPulls: guaranteeQuotaToPulls,
        sourceStoneToPulls: sourceStoneToPulls,
        arsenalQuotaToPulls: arsenalQuotaToPulls,
        arsenalAmountToPulls: arsenalAmountToPulls,
        buildPullContext: buildPullContext,
        getVersionPullInfo: getVersionPullInfo,
        run: run
    };
})(window.ZMD);
