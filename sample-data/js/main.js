// アプリ制御
(function () {
    const fileInput=document.getElementById('recFile');
    const gradeSelect=document.getElementById('grade');
    const majorSelect=document.getElementById('major');
    const judgeButton=document.getElementById('judgeButton');
    const resetButton=document.getElementById('resetButton');
    const status=document.getElementById('status');

    async function run() {
        const file=fileInput.files[0];
        if (!file) { alert('成績CSVを選択してください。'); return; }
        const curriculum=GRADUATION_CURRICULA[gradeSelect.value];
        judgeButton.disabled=true;
        status.textContent='CSVを読み込んでいます…';
        try {
            const decoded=await GradeCsv.decodeGradeFile(file);
            const parsed=GradeCsv.parseGradeText(decoded.text);
            if (!parsed.passed.length) throw new Error('合格科目を抽出できませんでした。CSV形式・評価列を確認してください。');
            const result=GraduationChecker.checkGraduation(parsed.passed,curriculum,majorSelect.value);
            GraduationUi.render(result);
            status.textContent=`${parsed.passed.length}件の合格科目を解析 / ${decoded.encoding} / 区切り: ${parsed.separator}`;
            resetButton.hidden=false;
        } catch (error) {
            console.error(error);
            status.textContent='判定に失敗しました。';
            alert(error.message || String(error));
        } finally {
            judgeButton.disabled=false;
        }
    }

    function reset() {
        document.getElementById('output').innerHTML='';
        status.textContent='';
        fileInput.value='';
        resetButton.hidden=true;
    }

    judgeButton.addEventListener('click',run);
    resetButton.addEventListener('click',reset);
})();
