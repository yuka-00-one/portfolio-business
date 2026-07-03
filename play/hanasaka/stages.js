/* ========================================
   はなさかわんわん - ステージデータ
   あ行〜わ行の10ステージ
   既存の背景アセット（bg_stageN-*.png）を使用
   ======================================== */

class Stage {
    constructor(stageNumber, engine) {
        this.stageNumber = stageNumber;
        this.engine = engine;
        this.data = this.buildStageData(stageNumber);
        this.width = this.data.width;
    }

    buildStageData(num) {
        const row = StageRows[num] || StageRows[1];

        // ステージごとの花テーマ（春→水辺→ひだまりの繰り返し）
        const themes = ['sakura', 'mizube', 'himawari'];
        const flowerTheme = themes[(num - 1) % themes.length];

        // 文字数に応じてイベントを等間隔配置
        const chars = row.chars;
        const spacing = 420;
        const startX = 400;
        const events = chars.map((c, i) => ({
            triggerX: startX + i * spacing,
            character: c,
            pathLength: 220,
            eventType: i === chars.length - 1 ? 'stage_complete' : 'flower_bloom'
        }));
        const width = startX + chars.length * spacing + 300;

        // 背景レイヤー（ステージ1は花の progressive レイヤー付き4層）
        // -3（後景）は1枚の風景画なので繰り返さず、ステージ進行に合わせてパンする
        const backgroundLayers = [
            { image: `assets/backgrounds/bg_stage${num}-3.png`, parallax: 0.3, y: 0, height: 1.0, panorama: true },
            { image: `assets/backgrounds/bg_stage${num}-2.png`, parallax: 1.0, y: 0.6, height: 0.4 },
            { image: `assets/backgrounds/bg_stage${num}-1.png`, parallax: 1.5, y: 0, height: 1.0, foreground: true }
        ];
        if (num === 1) {
            backgroundLayers.splice(1, 0, {
                image: 'assets/backgrounds/bg_stage1-f.png',
                parallax: 0.8, y: 0.55, height: 0.45,
                progressive: true   // 文字をクリアするたびに花畑が濃くなる
            });
        }

        return {
            name: row.label,
            label: row.label,
            chars: chars,
            description: `${row.label}の もじを かいて はなを さかせよう！`,
            width: width,
            events: events,
            backgroundLayers: backgroundLayers,
            flowerTheme: flowerTheme
        };
    }

    getEvents() {
        return this.data.events.map(event => ({ ...event }));
    }

    getBackgroundLayers() {
        return this.data.backgroundLayers || [];
    }
}

/* ========================================
   進捗の保存（どこまで遊んだか）
   ======================================== */
const ProgressStore = {
    KEY: 'hanasaka_wanwan_progress',

    load() {
        try {
            const raw = localStorage.getItem(this.KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { }
        return { unlockedStage: 1, clearedChars: [] };
    },

    save(progress) {
        try {
            localStorage.setItem(this.KEY, JSON.stringify(progress));
        } catch (e) { }
    },

    unlockStage(num) {
        const p = this.load();
        if (num > p.unlockedStage) {
            p.unlockedStage = Math.min(num, 10);
            this.save(p);
        }
    },

    markCharCleared(char) {
        const p = this.load();
        if (!p.clearedChars.includes(char)) {
            p.clearedChars.push(char);
            this.save(p);
        }
    }
};
