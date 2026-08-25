// 卒業要件判定コア（DOM非依存）
(function (global) {
    function norm(value) {
        return String(value || "")
            .normalize("NFKC")
            .replace(/[\s　]+/g, "")
            .replace(/[‐‑–—―ー]/g, "-")
            .toUpperCase();
    }

    function equivalentCourseKey(value) {
        let s = norm(value);
        // 学則改定前後・CSV表記差の互換
        s = s.replace(/^工学倫理$/, "倫理科目").replace(/^科学者倫理$/, "倫理科目");
        s = s.replace(/^認知システム論([AB])$/, "認知システム$1");
        return s;
    }

    function categoryKey(value, aliases) {
        let s = String(value || "").normalize("NFKC").replace(/[\s　]+/g, "");
        const direct = aliases && aliases[s];
        return direct ? direct : s;
    }

    function matchesText(haystack, needle) {
        const h = norm(haystack);
        const n = norm(needle);
        return n && h.includes(n);
    }

    function makeProfessionalIndex(config) {
        const map = new Map();
        for (const course of config.courses) {
            map.set(equivalentCourseKey(course.name), course);
        }
        return map;
    }

    function classifyProfessional(passed, config) {
        const index = makeProfessionalIndex(config);
        const recognized = [];
        const remaining = [];
        const passedKeys = new Set();

        for (const record of passed) {
            const key = equivalentCourseKey(record.name);
            const course = index.get(key);
            if (course) {
                if (!passedKeys.has(key)) {
                    recognized.push({ ...record, ruleCourse: course });
                    passedKeys.add(key);
                }
            } else {
                remaining.push(record);
            }
        }
        return { recognized, remaining, passedKeys, index };
    }

    function generalMatchScore(record, item, aliases) {
        // 科目名ヒントを区分名より優先する。CSV側の区分が広い場合の誤分類を防ぐ。
        if ((item.match.nameIncludes || []).some(hint => matchesText(record.name, hint))) return 100;
        const category = categoryKey(record.category, aliases);
        let best = 0;
        for (const c of (item.match.categories || [])) {
            const target = categoryKey(c, aliases);
            if (!target || !category) continue;
            if (category === target) best = Math.max(best, 60);
            else if (category.includes(target) || target.includes(category)) best = Math.max(best, 30);
        }
        return best;
    }

    function evaluateGeneral(records, general) {
        const aliases = general.categoryAliases || {};
        const unused = [...records];
        const groups = [];
        let countedTotal = 0;
        let allSatisfied = true;

        for (const group of general.groups) {
            const allocations = new Map(group.items.map(item => [item.id, []]));
            const claimed = new Set();

            for (let i = 0; i < unused.length; i++) {
                let bestItem = null;
                let bestScore = 0;
                for (const item of group.items) {
                    const score = generalMatchScore(unused[i], item, aliases);
                    if (score > bestScore) {
                        bestScore = score;
                        bestItem = item;
                    }
                }
                if (bestItem && bestScore > 0) {
                    allocations.get(bestItem.id).push(unused[i]);
                    claimed.add(i);
                }
            }

            const itemResults = group.items.map(item => {
                const matched = allocations.get(item.id);
                const earned = matched.reduce((sum, r) => sum + r.credit, 0);
                const countedForItem = item.max == null ? earned : Math.min(earned, item.max);
                const satisfied = countedForItem >= item.min;
                if (!satisfied) allSatisfied = false;
                return { ...item, earned, countedForItem, satisfied, missing: Math.max(0, item.min - countedForItem), records: matched };
            });

            const poolResults = (group.pools || []).map(pool => {
                const poolEarned = itemResults
                    .filter(r => pool.itemIds.includes(r.id))
                    .reduce((sum, r) => sum + r.countedForItem, 0);
                const satisfied = poolEarned >= pool.min;
                if (!satisfied) allSatisfied = false;
                return { ...pool, earned: poolEarned, satisfied, missing: Math.max(0, pool.min - poolEarned) };
            });

            const takenRecords = [...claimed].map(i => unused[i]);
            for (const i of [...claimed].sort((a,b)=>b-a)) unused.splice(i, 1);

            const rawEarned = itemResults.reduce((sum, r) => sum + r.countedForItem, 0);
            const counted = Math.min(rawEarned, group.target);
            const targetSatisfied = counted >= group.target;
            if (!targetSatisfied) allSatisfied = false;
            countedTotal += counted;

            groups.push({
                ...group,
                itemResults,
                poolResults,
                rawEarned,
                counted,
                missing: Math.max(0, group.target - counted),
                targetSatisfied,
                records: takenRecords
            });
        }

        const totalSatisfied = countedTotal >= general.total;
        if (!totalSatisfied) allSatisfied = false;
        return { groups, countedTotal, total: general.total, totalSatisfied, satisfied: allSatisfied, unclassified: unused };
    }

    function evaluateProfessional(classification, config, externalRecords, externalRules) {
        const { recognized, passedKeys, index } = classification;
        const byType = type => recognized.filter(r => r.ruleCourse.type === type);

        const requiredPassed = byType("required");
        const requiredEarned = requiredPassed.reduce((s,r)=>s+r.ruleCourse.credit,0);
        const requiredMissing = config.courses.filter(c => c.type === "required" && !passedKeys.has(equivalentCourseKey(c.name)));
        const requiredSatisfied = requiredMissing.length === 0 && requiredEarned >= config.targets.required;

        const electivePassed = byType("elective");
        const internalElective = electivePassed.reduce((s,r)=>s+r.ruleCourse.credit,0);

        const externalBreakdown = [];
        const consumedExternal = new Set();
        let externalElective = 0;
        for (const rule of (externalRules || [])) {
            let raw = 0;
            externalRecords.forEach((r, idx) => {
                if (!consumedExternal.has(idx) && (matchesText(r.category, rule.keyword) || matchesText(r.name, rule.keyword))) {
                    raw += r.credit;
                    consumedExternal.add(idx);
                }
            });
            const counted = Math.min(raw, rule.max);
            externalElective += counted;
            externalBreakdown.push({ ...rule, raw, counted });
        }

        const electiveEarned = internalElective + externalElective;
        const electiveSatisfied = electiveEarned >= config.targets.elective;

        let selectRequiredEarned = 0;
        let selectRequiredSatisfied = config.targets.selectRequired === 0;
        const selectSetResults = [];
        if (config.targets.selectRequired > 0) {
            for (const set of config.selectRequiredSets) {
                const courses = set.courses.map(name => {
                    const course = index.get(equivalentCourseKey(name));
                    const passed = passedKeys.has(equivalentCourseKey(name));
                    return { ...course, passed };
                });
                const earned = courses.filter(c=>c.passed).reduce((s,c)=>s+c.credit,0);
                const satisfied = courses.every(c=>c.passed);
                selectSetResults.push({ ...set, courses, earned, satisfied });
                selectRequiredEarned = Math.max(selectRequiredEarned, Math.min(earned, config.targets.selectRequired));
                if (satisfied) selectRequiredSatisfied = true;
            }
            if (selectRequiredSatisfied) selectRequiredEarned = config.targets.selectRequired;
        }

        const counted = Math.min(requiredEarned, config.targets.required)
            + Math.min(selectRequiredEarned, config.targets.selectRequired)
            + Math.min(electiveEarned, config.targets.elective);
        const target = config.targets.required + config.targets.selectRequired + config.targets.elective;

        return {
            required: { target:config.targets.required, earned:requiredEarned, satisfied:requiredSatisfied, missingCourses:requiredMissing },
            selectRequired: { target:config.targets.selectRequired, earned:selectRequiredEarned, satisfied:selectRequiredSatisfied, sets:selectSetResults },
            elective: {
                target:config.targets.elective, earned:electiveEarned, internalEarned:internalElective,
                externalEarned:externalElective, externalBreakdown,
                satisfied:electiveSatisfied, missing:Math.max(0,config.targets.elective-electiveEarned),
                passedCourses:electivePassed.map(r=>r.ruleCourse)
            },
            freeCourses: byType("free").map(r=>r.ruleCourse),
            counted,
            target,
            satisfied: requiredSatisfied && selectRequiredSatisfied && electiveSatisfied
        };
    }

    function checkGraduation(passedCourses, curriculum, major) {
        if (!curriculum) throw new Error("入学年度の卒業要件データがありません。");
        if (!curriculum.professional[major]) throw new Error("コース指定が不正です。");

        // 再履修など同一科目の複数行を二重計上しない。
        const dedupedMap = new Map();
        for (const record of passedCourses) {
            const key = norm(record.name);
            const current = dedupedMap.get(key);
            if (!current || record.credit > current.credit) dedupedMap.set(key, record);
        }
        const dedupedPassed = [...dedupedMap.values()];

        const professionalConfig = curriculum.professional[major];
        const classification = classifyProfessional(dedupedPassed, professionalConfig);
        const general = evaluateGeneral(classification.remaining, curriculum.general);
        const professional = evaluateProfessional(
            classification,
            professionalConfig,
            general.unclassified,
            curriculum.externalElectiveRules
        );

        // 明示的に副専攻/相互履修として拾えたものを未分類から除外
        const externalKeywords = (curriculum.externalElectiveRules || []).map(r=>r.keyword);
        const unclassified = general.unclassified.filter(r => !externalKeywords.some(k => matchesText(r.category,k) || matchesText(r.name,k)));

        const requirementCounted = general.countedTotal + professional.counted;
        const rawPassedCredits = dedupedPassed.reduce((s,r)=>s+r.credit,0);
        const eligible = general.satisfied && professional.satisfied && requirementCounted >= curriculum.graduationTotal;

        return {
            eligible,
            requirementCounted,
            graduationTotal: curriculum.graduationTotal,
            rawPassedCredits,
            general,
            professional,
            unclassified,
            sourceFile: curriculum.sourceFile,
            curriculumLabel: curriculum.label,
            major
        };
    }

    global.GraduationChecker = { checkGraduation, norm, equivalentCourseKey };
    if (typeof module !== "undefined" && module.exports) module.exports = global.GraduationChecker;
})(typeof globalThis !== "undefined" ? globalThis : window);
