// 成績CSV読み込み・解析
(function (global) {
    const PASS_GRADES = new Set(["AA", "A", "B", "C", "合"]);

    function decodeGradeFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = event => {
                try {
                    const buffer = event.target.result;
                    let text;
                    let encoding;
                    try {
                        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
                        encoding = "UTF-8";
                    } catch (_) {
                        text = new TextDecoder("windows-31j").decode(buffer);
                        encoding = "Windows-31J / Shift_JIS";
                    }
                    resolve({ text, encoding });
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = () => reject(reader.error || new Error("ファイルを読み込めませんでした。"));
            reader.readAsArrayBuffer(file);
        });
    }

    function detectSeparator(text) {
        const sample = text.split(/\r?\n/).slice(0, 12);
        const tabScore = sample.reduce((n, row) => n + (row.match(/\t/g) || []).length, 0);
        const commaScore = sample.reduce((n, row) => n + (row.match(/,/g) || []).length, 0);
        return tabScore > commaScore ? "\t" : ",";
    }

    function parseDelimited(text, separator) {
        const rows = [];
        let row = [];
        let field = "";
        let quoted = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (quoted) {
                if (ch === '"' && text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else if (ch === '"') {
                    quoted = false;
                } else {
                    field += ch;
                }
            } else if (ch === '"') {
                quoted = true;
            } else if (ch === separator) {
                row.push(field.trim());
                field = "";
            } else if (ch === "\n") {
                row.push(field.replace(/\r$/, "").trim());
                rows.push(row);
                row = [];
                field = "";
            } else {
                field += ch;
            }
        }
        if (field.length || row.length) {
            row.push(field.replace(/\r$/, "").trim());
            rows.push(row);
        }
        return rows;
    }

    function normalizeHeader(value) {
        return String(value || "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    }

    function findColumn(header, candidates) {
        const normalized = header.map(normalizeHeader);
        for (const candidate of candidates.map(normalizeHeader)) {
            const exact = normalized.indexOf(candidate);
            if (exact >= 0) return exact;
        }
        for (let i = 0; i < normalized.length; i++) {
            if (candidates.some(c => normalized[i].includes(normalizeHeader(c)))) return i;
        }
        return -1;
    }

    function detectLayout(rows) {
        const candidates = rows.slice(0, 15);
        for (let i = 0; i < candidates.length; i++) {
            const row = candidates[i];
            const name = findColumn(row, ["授業科目名", "科目名", "授業科目"]);
            const credit = findColumn(row, ["単位数", "単位"]);
            const grade = findColumn(row, ["評語", "評価", "成績"]);
            if (name >= 0 && credit >= 0 && grade >= 0) {
                const category = findColumn(row, ["科目区分", "授業科目区分", "区分"]);
                return {
                    headerIndex: i,
                    dataStart: i + 1,
                    category: category >= 0 ? category : 2,
                    name,
                    credit,
                    grade
                };
            }
        }
        // 従来の大学CSV形式: 5行目がヘッダ、3/5/6/10列目を利用
        return { headerIndex: 4, dataStart: 5, category: 2, name: 4, credit: 5, grade: 9 };
    }

    function parseGradeText(text) {
        const separator = detectSeparator(text);
        const rows = parseDelimited(text, separator);
        const layout = detectLayout(rows);
        const passed = [];
        let skipped = 0;

        for (let i = layout.dataStart; i < rows.length; i++) {
            const cols = rows[i];
            if (!cols || !cols.some(Boolean)) continue;
            const category = String(cols[layout.category] || "").trim();
            const name = String(cols[layout.name] || "").trim();
            const grade = String(cols[layout.grade] || "").normalize("NFKC").trim().toUpperCase();
            const credit = Number.parseFloat(String(cols[layout.credit] || "").normalize("NFKC"));

            if (!name || !Number.isFinite(credit) || credit <= 0) {
                skipped++;
                continue;
            }
            if (PASS_GRADES.has(grade)) {
                passed.push({ category, name, credit, grade, rowNumber: i + 1 });
            }
        }

        return { passed, separator: separator === "\t" ? "TAB" : "comma", layout, skipped };
    }

    global.GradeCsv = { decodeGradeFile, parseGradeText };
    if (typeof module !== "undefined" && module.exports) module.exports = global.GradeCsv;
})(typeof globalThis !== "undefined" ? globalThis : window);
