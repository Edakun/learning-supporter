// 状態管理
const state = {
    settings: {
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1IBZx9KSIfYdCSBZKIdxmJT0tLq1XpDlB5sVn065qo_c/edit#gid=0',
        gasUrl: 'https://script.google.com/macros/s/AKfycbzVWm3oZv1VdH-Rp-ujOfxmXE_WwskA0VCr3466w1vwFpsxhZhcJzZWtPnbYEnS7TK9/exec', 
        webhookUrl: 'https://discord.com/api/webhooks/1482625093560565761/JfZK_0mRc-27HBt3IvYnF3u...',
        targetTime: 60,
        targetCount: 20,
        couponDays: 3,
        couponPrize: 'TikTok 2時間見放題権',
        schedule: {
            '日': '全教科複合', '月': '国語', '火': '算数', '水': '英語', '木': '社会', '金': '理科', '土': '復習'
        }
    },
    progress: {
        timeSpentSeconds: 0,
        questionsAnswered: 0,
        lastDateStr: '',
        streakDays: 0,
        streakLastDateStr: '', // 連続記録を追跡するための最終クリア日
        clearedDates: [], // 追加：過去に目標を達成した日付（YYYY-MM-DD形式）のリスト
        earnedCoupons: [], // 追加：獲得したクーポンのリスト { id, title, isUsed, date }
        wrongQuestionIds: [], // 追加：間違えた問題のIDリスト
        subjectStats: { // 追加：教科ごとの正解率分析用
            '国語': { correct: 0, total: 0 },
            '算数': { correct: 0, total: 0 },
            '英語': { correct: 0, total: 0 },
            '社会': { correct: 0, total: 0 },
            '理科': { correct: 0, total: 0 }
        }
    },
    sheetQuestions: [],
    dummyQuestions: [
        { id: 'd1', subject: '国語', q: '「走る」の反対に近い意味を持つ言葉は？', choices: ['歩く', '止まる', '飛ぶ', '泳ぐ'], a: 1, explanation: '「走る」という動作をしない状態は「止まる」です。' },
        { id: 'd2', subject: '算数', q: '15 + 27 は？', choices: ['32', '42', '52', '62'], a: 1, explanation: '10の位は1+2=3。1の位は5+7=12なので、あわせて42です。' },
        { id: 'd3', subject: '英語', q: '「りんご」を英語で言うと？', choices: ['Apple', 'Banana', 'Orange', 'Grape'], a: 0, explanation: 'りんごは英語で Apple です。' },
        { id: 'd4', subject: '社会', q: '日本の首都はどこですか？', choices: ['大阪', '京都', '東京', '北海道'], a: 2, explanation: '日本の首都は東京です。' },
        { id: 'd5', subject: '理科', q: '水が凍ると何になる？', choices: ['お湯', '水蒸気', '氷', '雲'], a: 2, explanation: '水は0度以下になると凍って氷（こおり）になります。' }
    ],
    currentQuestions: [],
    currentQIndex: 0,
    isReviewMode: false, // 追加：現在復習モードかどうか
    timerInterval: null,
    hasNotifiedTime: false,
    hasNotifiedCount: false
};

// DOM要素の取得
const views = {
    home: document.getElementById('view-home'),
    study: document.getElementById('view-study'),
    parent: document.getElementById('view-parent')
};

// 初期化
async function init() {
    try {
        // ボタンが動くようにイベントリスナーを最優先で設定
        setupEventListeners();
        generateScheduleGrid();

        // ローカルデータを読み込む
        loadSettings();
        loadProgress();
        checkDateReset();
        updateHomeDisplay();
        
        // クラウド同期（バックグラウンドで実行し、画面をブロックしない）
        if (state.settings.gasUrl) {
            console.log("Cloud sync started...");
            syncWithCloud('load').catch(e => console.error("Cloud load error:", e));
        }
    } catch (e) {
        console.error("Initialization error:", e);
    }
}

// 通知用トースト表示
function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ---------------------------------------------------------
// クラウド同期 (GAS)
// ---------------------------------------------------------
async function syncWithCloud(mode = 'save') {
    const url = state.settings.gasUrl;
    if (!url) return;

    try {
        let fetchUrl = url;
        if (mode === 'save') {
            // 保存もGETパラメータで行う（最も確実な通信方法）
            const delimiter = url.indexOf('?') > -1 ? '&' : '?';
            fetchUrl += `${delimiter}action=save` +
                        `&settings=${encodeURIComponent(JSON.stringify(state.settings))}` +
                        `&progress=${encodeURIComponent(JSON.stringify(state.progress))}` +
                        `&ts=${Date.now()}`; // キャッシュ防止
        } else {
            // 読み込み
            const delimiter = url.indexOf('?') > -1 ? '&' : '?';
            fetchUrl += `${delimiter}action=load&ts=${Date.now()}`;
        }

        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error("Network response was not ok");
        const cloudData = await response.json();
        
        if (mode === 'load') {
            if (cloudData && (cloudData.settings || cloudData.progress)) {
                if (cloudData.settings) state.settings = { ...state.settings, ...cloudData.settings };
                if (cloudData.progress) state.progress = { ...state.progress, ...cloudData.progress };
                
                localStorage.setItem('studySettings', JSON.stringify(state.settings));
                localStorage.setItem('studyProgress', JSON.stringify(state.progress));
                updateHomeDisplay();
                showToast('✅ 最新の進捗を読み込みました');
            }
        } else {
            console.log("Cloud Save result:", cloudData ? cloudData.status : "unknown");
        }
    } catch (error) {
        console.error('Cloud Sync Error:', error);
    }
}

function loadSettings() {
    const saved = localStorage.getItem('studySettings');
    if (saved) {
        const localSettings = JSON.parse(saved);
        // localStorageにgasUrlが空で保存されている場合、ハードコードされた値を優先する
        if (!localSettings.gasUrl && state.settings.gasUrl) {
            localSettings.gasUrl = state.settings.gasUrl;
        }
        state.settings = { ...state.settings, ...localSettings };
    }
    const savedQs = localStorage.getItem('studyQuestions');
    if (savedQs) {
        state.sheetQuestions = JSON.parse(savedQs);
    }
}

function loadProgress() {
    const saved = localStorage.getItem('studyProgress');
    if (saved) {
        state.progress = { ...state.progress, ...JSON.parse(saved) };
    }
}

function saveProgress() {
    localStorage.setItem('studyProgress', JSON.stringify(state.progress));
    updateHomeDisplay();
    if (state.settings.gasUrl) syncWithCloud('save');
}

function checkDateReset() {
    const todayStr = new Date().toDateString();
    if (state.progress.lastDateStr !== todayStr) {
        // 日付が変わったらプログレスをリセット
        state.progress.timeSpentSeconds = 0;
        state.progress.questionsAnswered = 0;
        state.progress.lastDateStr = todayStr;
        state.hasNotifiedTime = false;
        state.hasNotifiedCount = false;
        saveProgress();
    }
}

// 画面遷移
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');

    if (viewName === 'home') updateHomeDisplay();
    if (viewName === 'parent') loadParentView();
}

// 日付と曜日に基づくホーム画面の更新
function updateHomeDisplay() {
    const now = new Date();
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const dayName = days[now.getDay()];

    // 日付表示
    document.getElementById('date-display').textContent =
        `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日(${dayName})`;

    // 今日の教科
    const todaySubject = state.settings.schedule[dayName] || '全教科複合';

    // アイコンのマッピング
    const iconMap = {
        '国語': '📚', '算数': '🧮', '英語': '🔤', '社会': '🗺️', '理科': '🔬',
        '全教科複合': '🌈', '復習': '♻️'
    };
    const icon = iconMap[todaySubject] || '📝';

    document.getElementById('today-subject-badge').innerHTML =
        `<span class="icon">${icon}</span><span class="text">${todaySubject}</span>`;

    // プログレスバー（時間）
    const timeSpentMins = Math.floor(state.progress.timeSpentSeconds / 60);
    const timeRatio = Math.min((timeSpentMins / state.settings.targetTime) * 100, 100);
    document.getElementById('time-text').textContent = `${timeSpentMins} / ${state.settings.targetTime} 分`;
    document.getElementById('time-bar').style.width = `${timeRatio}%`;

    // プログレスバー（問題数）
    const countRatio = Math.min((state.progress.questionsAnswered / state.settings.targetCount) * 100, 100);
    document.getElementById('count-text').textContent = `${state.progress.questionsAnswered} / ${state.settings.targetCount} 問`;
    document.getElementById('count-bar').style.width = `${countRatio}%`;

    // クーポン枚数
    const unusedCoupons = (state.progress.earnedCoupons || []).filter(c => !c.isUsed);
    document.getElementById('unused-coupon-count').textContent = `${unusedCoupons.length} 枚`;

    // 次のチケットまでの残り日数計算
    const targetDays = state.settings.couponDays || 3;
    const currentProgress = state.progress.streakDays % targetDays;
    const daysLeft = targetDays - currentProgress;
    const daysEl = document.getElementById('days-to-next-coupon');
    if (daysEl) daysEl.textContent = `${daysLeft}日`;

    // モーダルと通知チェック
    checkNotifications();
}

// イベントリスナー設定
function setupEventListeners() {
    document.getElementById('nav-parent-btn').addEventListener('click', () => {
        const pass = prompt('保護者パスワードを入力してください:');
        if (pass === '1459') {
            switchView('parent');
        } else if (pass !== null) { // nullはキャンセル時
            alert('パスワードが違います。');
        }
    });
    document.getElementById('back-home-btn').addEventListener('click', () => switchView('home'));

    document.getElementById('start-study-btn').addEventListener('click', startStudy);
    document.getElementById('quit-study-btn').addEventListener('click', stopStudy);
    document.getElementById('save-settings-btn').addEventListener('click', saveParentSettings);
    document.getElementById('next-question-btn').addEventListener('click', loadNextQuestion);
    document.getElementById('fetch-sheet-btn').addEventListener('click', fetchSheetData);

    
    // モーダルを閉じてメインへ
    document.getElementById('close-explanation-btn').addEventListener('click', stopStudy);
    document.getElementById('close-coupon-btn').addEventListener('click', () => {
        document.getElementById('coupon-modal').classList.add('hidden');
    });
    
    // カレンダー関連
    document.getElementById('show-calendar-btn').addEventListener('click', openCalendar);
    document.getElementById('close-calendar-btn').addEventListener('click', () => {
        document.getElementById('calendar-modal').classList.add('hidden');
    });
    document.getElementById('cal-prev-btn').addEventListener('click', () => changeCalendarMonth(-1));
    document.getElementById('cal-next-btn').addEventListener('click', () => changeCalendarMonth(1));

    // チケットボックス関連
    document.getElementById('show-coupon-box-btn').addEventListener('click', openCouponBox);
    document.getElementById('close-coupon-box-btn').addEventListener('click', () => {
        document.getElementById('coupon-box-modal').classList.add('hidden');
    });
}

// 学習セッションの開始
async function startStudy() {
    switchView('study');

    // UIをロード状態にする
    document.getElementById('question-text').textContent = '📝 最新の問題を取得中...';
    document.getElementById('choices-container').innerHTML = '';

    // スプレッドシートURLが設定されているか確認
    if (state.settings.sheetUrl) {
        // 設定があれば常に最新のデータを取得
        try {
            const fetchedQuestions = await fetchSheetDataSilent(state.settings.sheetUrl);
            if (fetchedQuestions && fetchedQuestions.length > 0) {
                state.sheetQuestions = fetchedQuestions;
                // 万が一オフラインの時のためローカルにも保存しておく
                localStorage.setItem('studyQuestions', JSON.stringify(fetchedQuestions));
            }
        } catch (e) {
            console.error("自動問題取得に失敗しました。前回保存したデータを使用します。", e);
        }
    }

    const now = new Date();
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const todaySubject = state.settings.schedule[days[now.getDay()]];

    // シートのデータがあればそれを使用、なければダミー
    let allQs = state.sheetQuestions && state.sheetQuestions.length > 0 ? state.sheetQuestions : state.dummyQuestions;

    // 今日の教科学習の場合、教科と一致する問題を抽出。「全教科複合」「復習」の場合はすべてを含める
    state.isReviewMode = false;
    if (todaySubject === '復習') {
        const wrongIds = state.progress.wrongQuestionIds || [];
        const reviewQs = allQs.filter(q => wrongIds.includes(String(q.id)));
        if (reviewQs.length > 0) {
            allQs = reviewQs;
            state.isReviewMode = true;
            showToast(`🔥 復習モード！過去に間違えた${reviewQs.length}問に挑戦します`);
        } else {
            showToast('✅ 復習する問題がありません！全問から出題します');
        }
    } else if (todaySubject !== '全教科複合') {
        const filteredQs = allQs.filter(q => q.subject === todaySubject);
        if (filteredQs.length > 0) {
            allQs = filteredQs; // 一致する問題があれば絞り込み反映（なければ全問から出題）
        }
    }

    state.currentQuestions = [...allQs].sort(() => 0.5 - Math.random());
    state.currentQIndex = 0;

    startTimer();
    renderQuestion();
}

// 学習タイマー
function startTimer() {
    if (state.timerInterval) clearInterval(state.timerInterval);

    const liveTimerEl = document.getElementById('live-timer');
    let sessionSeconds = 0;

    state.timerInterval = setInterval(() => {
        sessionSeconds++;
        state.progress.timeSpentSeconds++;

        // ローカルには10秒ごとに保存（負荷対策）
        if (sessionSeconds % 10 === 0) saveProgress();

        // ライブタイマー表示更新
        const m = String(Math.floor(sessionSeconds / 60)).padStart(2, '0');
        const s = String(sessionSeconds % 60).padStart(2, '0');
        liveTimerEl.textContent = `⏱️ ${m}:${s}`;

    }, 1000);
}

function stopStudy() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    saveProgress();
    switchView('home');
}

// 問題の描画
function renderQuestion() {
    const q = state.currentQuestions[state.currentQIndex];
    if (!q) {
        stopStudy();
        alert('今日の問題はすべて終了しました！お疲れ様！');
        return;
    }

    document.getElementById('current-q-num').textContent = state.progress.questionsAnswered + 1;
    document.getElementById('question-text').textContent = q.q;

    const choicesContainer = document.getElementById('choices-container');
    choicesContainer.innerHTML = '';

    q.choices.forEach((choiceText, index) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.innerHTML = `<span style="margin-right: 12px; font-weight: 800; color: var(--secondary)">${index + 1}.</span> ${choiceText}`;
        btn.onclick = () => handleAnswer(index, q.a, q.explanation, btn);
        choicesContainer.appendChild(btn);
    });
}

// 解答の処理
function handleAnswer(selectedIndex, correctIndex, explanation, btnEl) {
    const q = state.currentQuestions[state.currentQIndex];
    const isCorrect = (selectedIndex === correctIndex);
    const modal = document.getElementById('explanation-modal');
    const badge = document.getElementById('result-badge');
    const explanationText = document.getElementById('explanation-text');

    // 選択肢のボタンスタイル変更
    const allBtns = document.getElementById('choices-container').querySelectorAll('button');
    allBtns.forEach(b => b.disabled = true); // 連打防止

    if (!state.progress.wrongQuestionIds) state.progress.wrongQuestionIds = [];

    if (isCorrect) {
        btnEl.classList.add('correct');
        badge.textContent = '⭕️ 大正解！すごい！';
        badge.className = 'result-badge correct';
        
        // 復習リストに入っていれば削除（克服！）
        const idx = state.progress.wrongQuestionIds.indexOf(String(q.id));
        if (idx > -1) {
            state.progress.wrongQuestionIds.splice(idx, 1);
        }
    } else {
        btnEl.classList.add('wrong');
        allBtns[correctIndex].classList.add('correct'); // 正解を教える
        badge.textContent = '❌ おしい！';
        badge.className = 'result-badge wrong';

        // 復習リストに追加
        if (!state.progress.wrongQuestionIds.includes(String(q.id))) {
            state.progress.wrongQuestionIds.push(String(q.id));
        }
    }

    // 教科ごとの統計を更新 (5教科の場合のみ)
    if (state.progress.subjectStats && q.subject) {
        const stats = state.progress.subjectStats[q.subject];
        if (stats) {
            stats.total++;
            if (isCorrect) stats.correct++;
        }
    }

    // プログレス更新
    state.progress.questionsAnswered++;
    saveProgress();

    // 解説モーダル表示
    explanationText.textContent = explanation;

    // 今日の目標を達成したら「おわり」ボタンも表示する (時間 または 問題数のどちらか一方で達成)
    const isCleared = (state.progress.timeSpentSeconds / 60 >= state.settings.targetTime) ||
        (state.progress.questionsAnswered >= state.settings.targetCount);

    const closeBtn = document.getElementById('close-explanation-btn');
    if (isCleared) {
        closeBtn.classList.remove('hidden');
    } else {
        closeBtn.classList.add('hidden');
    }

    setTimeout(() => {
        modal.classList.remove('hidden');
    }, 500);
}

function loadNextQuestion() {
    document.getElementById('explanation-modal').classList.add('hidden');
    
    // 復習モード中に全問クリアした場合の処理
    if (state.isReviewMode && (!state.progress.wrongQuestionIds || state.progress.wrongQuestionIds.length === 0)) {
        state.isReviewMode = false;
        // 全教科の問題リストに切り替える
        const allQs = state.sheetQuestions && state.sheetQuestions.length > 0 ? state.sheetQuestions : state.dummyQuestions;
        state.currentQuestions = [...allQs].sort(() => 0.5 - Math.random());
        state.currentQIndex = 0;
        showToast('🎊 復習完了！全教科の問題に切り替えます');
        renderQuestion();
        return;
    }

    state.currentQIndex++;

    // 足りなければループ
    if (state.currentQIndex >= state.currentQuestions.length) {
        state.currentQIndex = 0;
    }
    renderQuestion();
}

// 通知ロジック（Discord）
async function checkNotifications() {
    const timeMins = Math.floor(state.progress.timeSpentSeconds / 60);
    const targetMins = state.settings.targetTime;
    const answered = state.progress.questionsAnswered;
    const targetAns = state.settings.targetCount;

    const todayStr = new Date().toDateString();
    
    // YYYY-MM-DD形式に変換するヘルパー
    const getFormattedDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const todayFormatted = getFormattedDate(new Date());

    // 今日の目標がどちらか一方でもクリアされたか？
    if (timeMins >= targetMins || answered >= targetAns) {
        
        // カレンダー履歴へ追加（まだ追加されていなければ）
        if (!state.progress.clearedDates) state.progress.clearedDates = [];
        if (!state.progress.clearedDates.includes(todayFormatted)) {
            state.progress.clearedDates.push(todayFormatted);
            saveProgress();
        }
        
        // ストリークの更新判定
        if (state.progress.streakLastDateStr !== todayStr) {
            // 初クリア時のみストリークを加算

            // 昨日の日付を計算して連続かチェック
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            if (state.progress.streakLastDateStr === yesterday.toDateString()) {
                state.progress.streakDays++;
            } else {
                state.progress.streakDays = 1; // 途切れていたら1から
            }

            state.progress.streakLastDateStr = todayStr;
            saveProgress();

            // 目標日数連続ならクーポン獲得と表示
            const targetDays = state.settings.couponDays || 3;
            if (state.progress.streakDays > 0 && state.progress.streakDays % targetDays === 0) {
                // クーポン獲得情報を作る
                const title = state.settings.couponPrize;
                if (!state.progress.earnedCoupons) state.progress.earnedCoupons = [];
                state.progress.earnedCoupons.push({
                    id: Date.now().toString(),
                    title: title,
                    isUsed: false,
                    date: todayFormatted
                });
                saveProgress();
                
                // モーダルのテキストも動的に変更
                const modalText = document.querySelector('#coupon-modal p');
                if(modalText) {
                    modalText.innerHTML = `${targetDays}日連続で目標をクリアしたよ！<br>チケットを1枚手に入れた！`;
                }
                
                document.getElementById('coupon-prize').textContent = title;
                setTimeout(() => {
                    document.getElementById('coupon-modal').classList.remove('hidden');
                }, 1000);
            }
        }
    }

    // ストリークテキストの更新
    document.getElementById('streak-text').textContent = `${state.progress.streakDays || 0} 日連続！`;

    // --- Discord通知 ---
    const webhook = state.settings.webhookUrl;
    if (!webhook) return;

    if (!state.hasNotifiedTime && timeMins >= targetMins) {
        state.hasNotifiedTime = true;
        await sendDiscord(`🎉 【達成】今日の目標勉強時間（${targetMins}分）をクリアしました！お疲れ様！\n(現在: ${timeMins}分)`);
    }

    if (!state.hasNotifiedCount && answered >= targetAns) {
        state.hasNotifiedCount = true;
        await sendDiscord(`🎯 【達成】今日の目標問題数（${targetAns}問）をクリアしました！素晴らしい！\n(現在: ${answered}問解答)`);
    }
}

async function sendDiscord(message) {
    try {
        await fetch(state.settings.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message })
        });
    } catch (e) {
        console.error('Discord通知失敗:', e);
    }
}

// 保護者設定画面のロジック
function loadParentView() {
    document.getElementById('sheet-url-input').value = state.settings.sheetUrl || '';
    document.getElementById('gas-url-input').value = state.settings.gasUrl || '';
    document.getElementById('webhook-url-input').value = state.settings.webhookUrl || '';
    document.getElementById('coupon-days-input').value = state.settings.couponDays || 3;
    document.getElementById('coupon-prize-input').value = state.settings.couponPrize || '';
    document.getElementById('target-time-input').value = state.settings.targetTime;
    document.getElementById('target-count-input').value = state.settings.targetCount;

    // 曜日のセレクトボックス反映
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    days.forEach(day => {
        const sel = document.getElementById(`sel-${day}`);
        if (sel) sel.value = state.settings.schedule[day] || '全教科複合';
    });

    // 苦手分析グラフを描画
    setTimeout(renderAnalysisChart, 100);
}

let analysisChartInstance = null;
function renderAnalysisChart() {
    const ctx = document.getElementById('analysis-chart');
    if (!ctx) return;

    const subjects = ['国語', '算数', '英語', '社会', '理科'];
    const data = subjects.map(s => {
        const stats = state.progress.subjectStats?.[s];
        if (!stats || stats.total === 0) return 0;
        return Math.round((stats.correct / stats.total) * 100);
    });

    if (analysisChartInstance) {
        analysisChartInstance.destroy();
    }

    analysisChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: subjects,
            datasets: [{
                label: '正解率 (%)',
                data: data,
                backgroundColor: 'rgba(255, 107, 107, 0.2)',
                borderColor: 'rgba(255, 107, 107, 1)',
                borderWidth: 3,
                pointBackgroundColor: 'rgba(255, 107, 107, 1)',
                pointBorderColor: '#fff',
                pointRadius: 4
            }]
        },
        options: {
            scales: {
                r: {
                    angleLines: { display: true, color: '#eee' },
                    grid: { color: '#eee' },
                    suggestedMin: 0,
                    suggestedMax: 100,
                    ticks: { display: false, stepSize: 20 },
                    pointLabels: {
                        font: { size: 14, weight: 'bold', family: "'M PLUS Rounded 1c', sans-serif" },
                        color: '#4A5568'
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => ` 正解率: ${context.raw}%`
                    }
                }
            }
        }
    });
}

function generateScheduleGrid() {
    const grid = document.getElementById('schedule-grid');
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const subjects = ['国語', '算数', '英語', '社会', '理科', '復習', '全教科複合'];

    grid.innerHTML = '';
    days.forEach(day => {
        const div = document.createElement('div');
        div.className = 'schedule-item';

        const optionsHtml = subjects.map(s => `<option value="${s}">${s}</option>`).join('');
        div.innerHTML = `
            <span>${day}曜日</span>
            <select id="sel-${day}">
                ${optionsHtml}
            </select>
        `;
        grid.appendChild(div);
    });
}

function saveParentSettings() {
    state.settings.sheetUrl = document.getElementById('sheet-url-input').value;
    state.settings.gasUrl = document.getElementById('gas-url-input').value;
    state.settings.webhookUrl = document.getElementById('webhook-url-input').value;
    state.settings.couponDays = parseInt(document.getElementById('coupon-days-input').value) || 3;
    state.settings.couponPrize = document.getElementById('coupon-prize-input').value || 'TikTok 2時間見放題権';
    state.settings.targetTime = parseInt(document.getElementById('target-time-input').value) || 60;
    state.settings.targetCount = parseInt(document.getElementById('target-count-input').value) || 20;

    const days = ['日', '月', '火', '水', '木', '金', '土'];
    days.forEach(day => {
        state.settings.schedule[day] = document.getElementById(`sel-${day}`).value;
    });

    localStorage.setItem('studySettings', JSON.stringify(state.settings));

    // クラウド同期
    if (state.settings.gasUrl) syncWithCloud('save');

    // Toast表示
    const toast = document.getElementById('toast');
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

// スプレッドシートからデータを取得
async function fetchSheetData() {
    const url = document.getElementById('sheet-url-input').value.trim();
    const statusText = document.getElementById('sheet-status-text');

    if (!url) {
        alert('スプレッドシートのURLを入力してください。');
        return;
    }

    // URLからIDを抽出
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) {
        alert('有効なGoogleスプレッドシートのURLではありません。');
        return;
    }
    const sheetId = match[1];

    statusText.textContent = '⏳ データ読み込み中...';
    statusText.style.color = 'var(--text-main)';
    document.getElementById('fetch-sheet-btn').disabled = true;

    try {
        // file:/// からのリクエストの場合、Google Visualization API は CORS に引っかかってしまうため CSV のエクスポートエンドポイントを使用する
        const fetchUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
        const response = await fetch(fetchUrl);

        if (!response.ok) {
            throw new Error(`HTTP通信エラー: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();

        // HTMLが返された場合（リダイレクトや権限エラー画面など）
        if (text.trim().toLowerCase().startsWith('<!doctype html>') || text.trim().toLowerCase().startsWith('<html')) {
            throw new Error("スプレッドシートが一般公開されていないか、URLが正しくありません。");
        }

        // 簡単なCSVパーサー (カンマ区切り、ダブルクォーテーション対応)
        const rows = parseCSV(text);

        if (!rows || rows.length <= 1) {
            throw new Error("シートのデータが空になっているか、構造が読み取れませんでした。");
        }

        const newQuestions = [];

        rows.forEach((cells, i) => {
            // 最初の行（ヘッダー）を判断。ID列が数字じゃなければスキップ
            if (i === 0 && isNaN(parseInt(cells[0]))) return;

            const q = {
                id: cells[0],
                subject: cells[1],
                q: cells[2],
                choices: [cells[3] || '', cells[4] || '', cells[5] || '', cells[6] || ''],
                a: parseInt(cells[7]) - 1,   // スプレッドシートは1~4、JavaScriptは0~3で管理
                explanation: cells[8] || ''
            };

            // 必須項目（問題文があり、正解番号が0〜3の範囲）が揃っているか
            if (q.q && !isNaN(q.a) && q.a >= 0 && q.a <= 3) {
                newQuestions.push(q);
            }
        });

        if (newQuestions.length > 0) {
            state.sheetQuestions = newQuestions;
            localStorage.setItem('studyQuestions', JSON.stringify(newQuestions));
            statusText.textContent = `✅ 読み込み完了！ (${newQuestions.length}問のデータを保存しました)`;
            statusText.style.color = 'var(--success)';

            state.settings.sheetUrl = url;
            localStorage.setItem('studySettings', JSON.stringify(state.settings));
        } else {
            statusText.textContent = '❌ データが見つかりませんでした。A〜I列の項目（特にH列の答えが1〜4の数字か）を確認してください。';
            statusText.style.color = 'var(--error)';
        }
    } catch (e) {
        console.error('Fetch Error Detail:', e);
        let errorMsg = e.message || String(e);
        statusText.textContent = `❌ 読み込み失敗: ${errorMsg}`;
        statusText.style.color = 'var(--error)';
        alert(`データの読み込みに失敗しました。\n\n【詳細エラー】\n${errorMsg}`);
    } finally {
        document.getElementById('fetch-sheet-btn').disabled = false;
    }
}

// CSVパース用のヘルパー関数
function parseCSV(str) {
    const arr = [];
    let quote = false;
    let col = 0;
    let row = 0;

    for (let c = 0; c < str.length; c++) {
        let cc = str[c];
        let nc = str[c + 1];
        arr[row] = arr[row] || [];
        arr[row][col] = arr[row][col] || '';

        if (cc == '"' && quote && nc == '"') {
            arr[row][col] += cc; // エスケープされたダブルクォート
            c++;
            continue;
        }
        if (cc == '"') {
            quote = !quote;
            continue;
        }
        if (cc == ',' && !quote) {
            col++;
            continue;
        }
        if (cc == '\r' && nc == '\n' && !quote) {
            row++; col = 0; c++;
            continue;
        }
        if (cc == '\n' && !quote) {
            row++; col = 0;
            continue;
        }
        arr[row][col] += cc;
    }
    return arr;
}

// (非同期裏側実行用) スプレッドシートからデータを取得し、配列を返す関数
async function fetchSheetDataSilent(url) {
    if (!url) return null;
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return null;

    const sheetId = match[1];
    const fetchUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

    const response = await fetch(fetchUrl);
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

    const text = await response.text();
    if (text.trim().toLowerCase().startsWith('<!doctype html>') || text.trim().toLowerCase().startsWith('<html')) {
        throw new Error("HTML response received, likely an auth screen.");
    }

    const rows = parseCSV(text);
    if (!rows || rows.length <= 1) return null;

    const newQuestions = [];
    rows.forEach((cells, i) => {
        if (i === 0 && isNaN(parseInt(cells[0]))) return;

        const q = {
            id: cells[0],
            subject: cells[1],
            q: cells[2],
            choices: [cells[3] || '', cells[4] || '', cells[5] || '', cells[6] || ''],
            a: parseInt(cells[7]) - 1,
            explanation: cells[8] || ''
        };

        if (q.q && !isNaN(q.a) && q.a >= 0 && q.a <= 3) {
            newQuestions.push(q);
        }
    });

    return newQuestions;
}

// ========================
// カレンダー機能
// ========================
let currentCalDate = new Date();

function openCalendar() {
    currentCalDate = new Date(); // 開くたびに今月にリセット
    renderCalendar();
    document.getElementById('calendar-modal').classList.remove('hidden');
}

function changeCalendarMonth(offset) {
    currentCalDate.setMonth(currentCalDate.getMonth() + offset);
    renderCalendar();
}

function renderCalendar() {
    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();
    
    document.getElementById('cal-month-text').textContent = `${year}年${month + 1}月`;
    
    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';
    
    const daysArr = ['日', '月', '火', '水', '木', '金', '土'];
    daysArr.forEach(d => {
        const h = document.createElement('div');
        h.className = 'calendar-day-header';
        h.textContent = d;
        if(d === '日') h.style.color = 'var(--error)';
        if(d === '土') h.style.color = '#3b82f6';
        grid.appendChild(h);
    });
    
    // 月初の曜日と、月末の日付を取得
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    
    // 今日の日付を文字列で取得 (スタイリング用)
    const today = new Date();
    const isCurrentMonth = (year === today.getFullYear() && month === today.getMonth());
    const todayDate = today.getDate();
    
    // 過去のクリア済みデータ
    const clearedList = state.progress.clearedDates || [];

    // 空白マス（先月分）
    for (let i = 0; i < firstDay; i++) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'calendar-day empty';
        grid.appendChild(emptyDiv);
    }
    
    // 日付マス
    for (let d = 1; d <= lastDate; d++) {
        const div = document.createElement('div');
        div.className = 'calendar-day';
        div.textContent = d;
        
        // 当日ハイライト
        if (isCurrentMonth && d === todayDate) {
            div.classList.add('today');
        }
        
        // 目標達成済みのチェック
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        if (clearedList.includes(dateStr)) {
            div.classList.add('cleared');
        }
        
        grid.appendChild(div);
    }
}

// ========================
// チケットボックス機能
// ========================
function openCouponBox() {
    renderCouponBox();
    document.getElementById('coupon-box-modal').classList.remove('hidden');
}

function renderCouponBox() {
    const listContainer = document.getElementById('coupon-list-container');
    listContainer.innerHTML = '';
    
    // 未使用のクーポンをリストアップ
    const unusedCoupons = (state.progress.earnedCoupons || []).filter(c => !c.isUsed);
    
    if (unusedCoupons.length === 0) {
        listContainer.innerHTML = '<p style="color: var(--text-light); padding: 20px;">まだチケットがないよ。がんばってあつめよう！</p>';
        return;
    }
    
    unusedCoupons.forEach(coupon => {
        const item = document.createElement('div');
        item.style.padding = '16px';
        item.style.border = '2px dashed var(--accent)';
        item.style.borderRadius = '12px';
        item.style.background = '#FFF9E6';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        
        const details = document.createElement('div');
        details.style.textAlign = 'left';
        details.innerHTML = `
            <div style="font-size: 0.8rem; color: var(--text-light); margin-bottom: 4px;">ゲットした日: ${coupon.date}</div>
            <div style="font-weight: 900; color: var(--text-main); font-size: 1.1rem;">🎁 ${coupon.title}</div>
        `;
        
        const useBtn = document.createElement('button');
        useBtn.className = 'btn-primary';
        useBtn.style.padding = '8px 16px';
        useBtn.style.fontSize = '0.9rem';
        useBtn.style.background = 'var(--primary)';
        useBtn.style.boxShadow = 'none';
        useBtn.style.width = 'auto';
        useBtn.textContent = 'つかう！';
        
        useBtn.onclick = () => redeemCoupon(coupon.id);
        
        item.appendChild(details);
        item.appendChild(useBtn);
        listContainer.appendChild(item);
    });
}

function redeemCoupon(id) {
    if(!confirm("おうちのひとの めのまえで つかいますか？\n(「はい」を押すとチケットが消費されます)")) return;
    
    const coupon = state.progress.earnedCoupons.find(c => c.id === id);
    if(coupon) {
        coupon.isUsed = true;
        saveProgress();
        renderCouponBox();
        updateHomeDisplay();
        alert('🎉 チケットをつかいました！やったね！');
    }
}

// 起動
document.addEventListener('DOMContentLoaded', init);
