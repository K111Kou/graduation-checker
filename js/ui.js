// 判定結果表示
(function (global) {
    const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const pct = (v,t) => t ? Math.min(100, Math.round(v/t*100)) : 100;

    function progress(label, earned, target, good) {
        const rate = pct(earned,target);
        return `<div class="progress-block">
            <div class="progress-head"><span>${esc(label)}</span><strong>${earned} / ${target} 単位</strong></div>
            <div class="progress-track"><div class="progress-fill ${good ? 'ok' : ''}" style="width:${rate}%"></div></div>
        </div>`;
    }

    function statusBadge(ok, textOk='充足', textNg='不足') {
        return `<span class="badge ${ok?'badge-ok':'badge-ng'}">${ok?textOk:textNg}</span>`;
    }

    function missingCourseTable(courses) {
        if (!courses.length) return `<p class="success-line">必修科目はすべて修得済みです。</p>`;
        return `<div class="table-wrap"><table><thead><tr><th>未修得必修科目</th><th>単位</th><th>標準年次</th></tr></thead><tbody>
            ${courses.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.credit}</td><td>${c.year || '-'}</td></tr>`).join('')}
        </tbody></table></div>`;
    }

    function generalDetails(general) {
        return general.groups.map(group => `
            <section class="rule-card">
                <div class="rule-title"><strong>${esc(group.label)}</strong>${statusBadge(group.targetSatisfied)}</div>
                ${progress(group.label, group.counted, group.target, group.targetSatisfied)}
                <div class="table-wrap"><table><thead><tr><th>区分</th><th>取得</th><th>最低</th><th>判定</th></tr></thead><tbody>
                    ${group.itemResults.map(item=>`<tr><td>${esc(item.label)}</td><td>${item.countedForItem}</td><td>${item.min}</td><td>${statusBadge(item.satisfied)}</td></tr>`).join('')}
                    ${(group.poolResults||[]).map(pool=>`<tr><td>${esc(pool.label)}</td><td>${pool.earned}</td><td>${pool.min}</td><td>${statusBadge(pool.satisfied)}</td></tr>`).join('')}
                </tbody></table></div>
            </section>`).join('');
    }

    function selectRequiredDetails(sr) {
        if (!sr.target) return '';
        return `<section class="rule-card">
            <div class="rule-title"><strong>専門選択必修</strong>${statusBadge(sr.satisfied)}</div>
            ${progress('選択必修', sr.earned, sr.target, sr.satisfied)}
            <p class="hint">次の組合せのいずれか1組をすべて修得する必要があります。</p>
            ${sr.sets.map(set=>`<div class="set-box ${set.satisfied?'set-ok':''}">
                <div><strong>${esc(set.label)}</strong> ${statusBadge(set.satisfied,'この組で充足','未完成')}</div>
                <ul>${set.courses.map(c=>`<li class="${c.passed?'passed':'missing'}">${c.passed?'✓':'×'} ${esc(c.name)}（${c.credit}単位・${c.year || '-'}年次）</li>`).join('')}</ul>
            </div>`).join('')}
        </section>`;
    }

    function render(result) {
        const root=document.getElementById('output');
        const p=result.professional;
        const overallRate=pct(result.requirementCounted,result.graduationTotal);
        const externalUsed=p.elective.externalBreakdown.filter(x=>x.counted>0);

        root.innerHTML=`
        <section class="result-hero ${result.eligible?'eligible':'not-eligible'}">
            <div>
                <p class="eyebrow">${esc(result.curriculumLabel)} / ${esc(result.major)}コース</p>
                <h2>${result.eligible?'卒業要件を満たしています':'卒業要件に不足があります'}</h2>
                <p>要件算入 ${result.requirementCounted} / ${result.graduationTotal} 単位</p>
            </div>
            <div class="donut" style="--rate:${overallRate * 3.6}deg"><span>${overallRate}%</span></div>
        </section>

        <div class="summary-grid">
            <article class="summary-card"><span>教養教育</span><strong>${result.general.countedTotal}/${result.general.total}</strong>${statusBadge(result.general.satisfied)}</article>
            <article class="summary-card"><span>専門必修</span><strong>${p.required.earned}/${p.required.target}</strong>${statusBadge(p.required.satisfied)}</article>
            ${p.selectRequired.target ? `<article class="summary-card"><span>専門選択必修</span><strong>${p.selectRequired.earned}/${p.selectRequired.target}</strong>${statusBadge(p.selectRequired.satisfied)}</article>`:''}
            <article class="summary-card"><span>専門選択</span><strong>${p.elective.earned}/${p.elective.target}</strong>${statusBadge(p.elective.satisfied)}</article>
            <article class="summary-card"><span>CSV上の合格単位</span><strong>${result.rawPassedCredits}</strong><small>参考値</small></article>
        </div>

        <details open><summary>教養教育の内訳</summary>${generalDetails(result.general)}</details>

        <details open><summary>専門必修</summary>
            ${progress('専門必修',p.required.earned,p.required.target,p.required.satisfied)}
            ${missingCourseTable(p.required.missingCourses)}
        </details>

        ${p.selectRequired.target ? `<details open><summary>専門選択必修</summary>${selectRequiredDetails(p.selectRequired)}</details>`:''}

        <details open><summary>専門選択</summary>
            ${progress('専門選択',p.elective.earned,p.elective.target,p.elective.satisfied)}
            <p>${p.elective.satisfied ? '必要な選択単位数を満たしています。' : `あと ${p.elective.missing} 単位必要です。`}</p>
            ${externalUsed.length ? `<p class="hint">外部プログラム算入: ${externalUsed.map(x=>`${esc(x.label)} ${x.counted}単位`).join(' / ')}</p>`:''}
        </details>

        ${result.unclassified.length ? `<details><summary>未分類の合格科目 (${result.unclassified.length}件)</summary>
            <p class="warning">卒業要件データまたはCSVの区分名と一致せず、自動算入できなかった科目です。必要なら表記対応を追加してください。</p>
            <div class="table-wrap"><table><thead><tr><th>区分</th><th>科目名</th><th>単位</th></tr></thead><tbody>
                ${result.unclassified.map(r=>`<tr><td>${esc(r.category)}</td><td>${esc(r.name)}</td><td>${r.credit}</td></tr>`).join('')}
            </tbody></table></div></details>`:''}

        <p class="source-note">判定基準: ${esc(result.sourceFile)} の別表。最終的な卒業可否は大学の公式確認を優先してください。</p>`;
    }

    global.GraduationUi={render};
})(typeof globalThis !== 'undefined' ? globalThis : window);
