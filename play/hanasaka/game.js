/* ========================================
   はなさかわんわん - メインゲームエンジン

   ながれ:
   タイトル → ステージえらび → さんぽ（横スクロール）
   → 文字イベント → なぞり書き → 花が咲く
   → ステージクリア → 次の行へ
   ======================================== */

class GameEngine {
    constructor() {
        this.gameCanvas = document.getElementById('game-canvas');
        this.gameCtx = this.gameCanvas.getContext('2d');
        this.writingCanvas = document.getElementById('writing-canvas');
        this.writingCtx = this.writingCanvas.getContext('2d');

        // ゲーム状態
        this.state = 'title'; // title, select, walking, event, writing, celebrating, stageComplete
        this.scrollX = 0;
        this.scrollSpeed = 1.8;

        // コンポーネント
        this.dog = null;
        this.currentStage = null;
        this.effects = null;
        this.writingSystem = null;

        // イベント管理
        this.events = [];
        this.currentEvent = null;
        this.currentEventIndex = 0;

        this.backgroundLayers = [];
        this.useSprites = false;
        this.dogSprite = null;
        this.fadeAlpha = 0;

        this.init();
    }

    async init() {
        this.setupCanvas();
        this.setupComponents();
        await this.loadSprites();

        this.setupTitleScreen();
        this.setupStageSelect();
        this.setupHud();

        this.startGameLoop();

        window.addEventListener('resize', () => {
            this.setupCanvas();
        });
    }

    /* ---------- Canvasセットアップ ---------- */

    setupCanvas() {
        const wrapper = document.getElementById('safe-area-wrapper');
        const rect = wrapper.getBoundingClientRect();

        const targetRatio = 16 / 9;
        const containerRatio = rect.width / rect.height;

        let width, height;
        if (containerRatio > targetRatio) {
            height = rect.height;
            width = height * targetRatio;
        } else {
            width = rect.width;
            height = width / targetRatio;
        }

        const scale = window.devicePixelRatio || 1;
        const left = (rect.width - width) / 2 + 'px';
        const top = (rect.height - height) / 2 + 'px';

        for (const canvas of [this.gameCanvas, this.writingCanvas]) {
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            canvas.style.position = 'absolute';
            canvas.style.left = left;
            canvas.style.top = top;
        }

        // 内部解像度をDPRに合わせる
        this.gameCanvas.width = width * scale;
        this.gameCanvas.height = height * scale;
        this.writingCanvas.width = width * scale;
        this.writingCanvas.height = height * scale;
        this.gameCtx.scale(scale, scale);
        this.writingCtx.scale(scale, scale);

        this.width = width;
        this.height = height;
        this.scale = scale;
    }

    setupComponents() {
        this.dog = new DogCharacter(this);
        this.effects = new EffectsManager(this);
        this.writingSystem = new WritingSystem(this);
    }

    async loadSprites() {
        try {
            const dogSpriteData = await spriteManager.registerSprite('dog', DogSpriteConfig);
            this.dogSprite = new AnimatedSprite(dogSpriteData);
            this.dogSprite.play('walk');
            this.useSprites = true;
        } catch (e) {
            console.log('🎨 Canvas描画モード（スプライトなし）');
            this.useSprites = false;
        }
    }

    /* ---------- 画面（タイトル・ステージ選択・HUD） ---------- */

    setupTitleScreen() {
        const titleScreen = document.getElementById('title-screen');
        const startButton = document.getElementById('start-button');

        startButton.addEventListener('click', () => {
            // 先に画面遷移（BGM読み込みを待たせない）。音は用意でき次第鳴らす
            titleScreen.classList.add('hidden');
            this.showStageSelect();
            audioManager.init()
                .then(() => audioManager.playBGM('assets/audio/bgm_main.mp3'))
                .catch(() => { });
        });
    }

    setupStageSelect() {
        this.selectScreen = document.getElementById('stage-select');
        this.stageGrid = document.getElementById('stage-grid');
    }

    showStageSelect() {
        this.state = 'select';
        const progress = ProgressStore.load();
        this.stageGrid.innerHTML = '';

        for (let i = 1; i <= 10; i++) {
            const row = StageRows[i];
            const unlocked = i <= progress.unlockedStage;
            const btn = document.createElement('button');
            btn.className = 'stage-button' + (unlocked ? '' : ' locked');
            btn.innerHTML = unlocked
                ? `<span class="stage-flower">🌸</span><span class="stage-label">${row.label}</span>`
                : `<span class="stage-flower">🌱</span><span class="stage-label">${row.label}</span>`;
            if (unlocked) {
                btn.addEventListener('click', () => {
                    this.selectScreen.classList.add('hidden');
                    this.startStage(i);
                });
            }
            this.stageGrid.appendChild(btn);
        }

        this.selectScreen.classList.remove('hidden');
    }

    setupHud() {
        this.hud = document.getElementById('hud');
        this.hudStageLabel = document.getElementById('hud-stage-label');
        this.hudChars = document.getElementById('hud-chars');
        this.hintLabel = document.getElementById('hint-label');

        document.getElementById('home-button').addEventListener('click', () => {
            this.writingSystem.stop();
            this.writingCanvas.classList.remove('active');
            this.hud.classList.add('hidden');
            this.showStageSelect();
        });
    }

    updateHud() {
        if (!this.currentStage) return;
        this.hudStageLabel.textContent = this.currentStage.data.label;
        const chars = this.currentStage.data.chars;
        this.hudChars.innerHTML = chars.map((c, i) =>
            `<span class="hud-char ${i < this.currentEventIndex ? 'done' : ''}">${c}</span>`
        ).join('');
    }

    showHint(text, duration = 1800) {
        if (!this.hintLabel) return;
        this.hintLabel.textContent = text;
        this.hintLabel.classList.add('visible');
        clearTimeout(this._hintTimer);
        this._hintTimer = setTimeout(() => {
            this.hintLabel.classList.remove('visible');
        }, duration);
    }

    /* ---------- 音声よみあげ ---------- */

    speak(text, rate = 0.85) {
        // 読み上げ音声はユーザー要望によりオフ（呼び出し側はそのまま）
    }

    /* ---------- ステージ進行 ---------- */

    async startStage(stageNumber) {
        await this.loadStage(stageNumber);
        this.state = 'walking';
        this.hud.classList.remove('hidden');
        this.updateHud();
        if (this.useSprites && this.dogSprite) this.dogSprite.play('walk');
        this.speak(`${this.currentStage.data.label}！ ${this.currentStage.data.chars.join('、')}`);
        this.fadeIn();
    }

    async loadStage(stageNumber) {
        this.currentStage = new Stage(stageNumber, this);
        this.events = this.currentStage.getEvents();
        this.currentEventIndex = 0;
        this.scrollX = 0;
        FlowerArt.theme = this.currentStage.data.flowerTheme || null;   // ステージの花テーマ
        this.effects.reset();   // 前ステージの花畑などをクリア
        this._progAlpha = 0;    // progressive背景もリセット

        const layerConfigs = this.currentStage.getBackgroundLayers();
        this.backgroundLayers = await this.loadBackgroundImages(layerConfigs);
    }

    async loadBackgroundImages(layerConfigs) {
        const layers = [];
        for (const config of layerConfigs) {
            if (config.image) {
                try {
                    const img = new Image();
                    img.src = config.image;
                    await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = reject;
                    });
                    layers.push({ ...config, imageElement: img });
                } catch (e) {
                    console.warn(`背景読み込み失敗: ${config.image}`);
                }
            } else {
                layers.push(config);
            }
        }
        return layers;
    }

    /* ---------- ゲームループ ---------- */

    startGameLoop() {
        const loop = () => {
            this.update();
            this.render();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    update() {
        switch (this.state) {
            case 'walking':
                this.updateWalking();
                break;
            case 'writing':
                // WritingSystemが制御
                break;
        }
        this.dog.update(this.state);
        this.effects.update();
    }

    updateWalking() {
        this.scrollX += this.scrollSpeed;

        if (this.currentEventIndex < this.events.length) {
            const nextEvent = this.events[this.currentEventIndex];
            if (this.scrollX >= nextEvent.triggerX - 100) {
                this.triggerEvent(nextEvent);
            }
        }

        if (this.scrollX >= this.currentStage.width) {
            this.onStageComplete();
        }
    }

    triggerEvent(event) {
        this.state = 'event';
        this.currentEvent = event;
        this.dog.stopAndListen();
        if (this.useSprites && this.dogSprite) this.dogSprite.play('listen');

        this.speak(`「${event.character}」を かいてみよう！`);

        setTimeout(() => this.startWritingEvent(), 1100);
    }

    startWritingEvent() {
        this.state = 'writing';
        this.writingCanvas.classList.add('active');
        this.writingSystem.startWriting(this.currentEvent.character);
        this.showHint(`ひかる ところから なぞってね`, 2500);
    }

    onWritingSuccess(accuracy) {
        this.state = 'celebrating';
        this.writingCanvas.classList.remove('active');

        ProgressStore.markCharCleared(this.currentEvent.character);

        audioManager.playSFX('success');

        const praises = ['じょうずに かけたね！', 'すごい！', 'きれいに かけたね！', 'はなまる！'];
        this.speak(praises[Math.floor(Math.random() * praises.length)]);

        // 精度に応じた花の数
        const flowerCount = accuracy > 0.85 ? 14 : accuracy > 0.7 ? 9 : 6;
        const flowerX = this.dog.x + 120;
        const flowerY = this.height * 0.68;
        this.effects.spawnFlowers(flowerX, flowerY, flowerCount);

        // 進行度に応じて花畑がエスカレート。最後の文字は画面いっぱいの満開ウェーブ
        const idx = this.currentEventIndex;   // 0始まり（あ=0 … お=4）
        const isLastChar = idx >= this.events.length - 1;
        if (isLastChar) {
            this.effects.spawnBloomWave(this.dog.x + 60);
            this.effects.spawnPetalStorm(50);
            setTimeout(() => audioManager.playSFX('sparkle'), 600);
            setTimeout(() => audioManager.playSFX('flower_bloom'), 1200);
        } else {
            this.effects.plantGarden(flowerX, 6 + idx * 7, {
                spread: 320 + idx * 160,
                aheadBias: 0.65   // 進行方向（右）にも咲かせる
            });
        }
        // 画面最前面の花畑（スクロールしても残る）が1文字ごとに増えていく
        this.effects.plantFrontGarden(5 + idx * 3);

        setTimeout(() => audioManager.playSFX('flower_bloom'), 200);

        this.dog.celebrate();
        audioManager.playSFX('dog_happy');
        if (this.useSprites && this.dogSprite) this.dogSprite.play('celebrate');

        this.currentEventIndex++;
        this.updateHud();

        // 満開ウェーブのときは余韻を長めに
        setTimeout(() => {
            this.state = 'walking';
            if (this.useSprites && this.dogSprite) this.dogSprite.play('walk');
        }, isLastChar ? 3800 : 2200);
    }

    onStageComplete() {
        if (this.state === 'stageComplete') return;
        this.state = 'stageComplete';

        this.dog.celebrate();
        if (this.useSprites && this.dogSprite) this.dogSprite.play('celebrate');

        // 次のステージを解放
        ProgressStore.unlockStage(this.currentStage.stageNumber + 1);

        this.speak(`${this.currentStage.data.label} クリア！ おはなが いっぱい さいたね！`);

        this.effects.spawnFireworks(6);
        this.effects.spawnPetalStorm(70);
        setTimeout(() => this.effects.spawnConfetti(120), 500);

        for (let i = 0; i < 4; i++) {
            setTimeout(() => {
                this.effects.spawnFlowers(
                    this.width * 0.2 + Math.random() * this.width * 0.6,
                    this.height * 0.5 + Math.random() * this.height * 0.25,
                    14
                );
            }, i * 350);
        }

        audioManager.playSFX('success');
        setTimeout(() => audioManager.playSFX('sparkle'), 300);
        setTimeout(() => audioManager.playSFX('dog_happy'), 600);

        setTimeout(() => this.transitionToNextStage(), 5200);
    }

    transitionToNextStage() {
        const nextStage = this.currentStage.stageNumber + 1;

        if (nextStage <= 10) {
            this.fadeOut(async () => {
                await this.startStage(nextStage);
            });
        } else {
            this.showGameComplete();
        }
    }

    fadeOut(callback) {
        this.fadeAlpha = 0;
        const fade = () => {
            this.fadeAlpha += 0.025;
            if (this.fadeAlpha >= 1) {
                this.fadeAlpha = 1;
                if (callback) callback();
            } else {
                requestAnimationFrame(fade);
            }
        };
        fade();
    }

    fadeIn() {
        const fade = () => {
            this.fadeAlpha -= 0.025;
            if (this.fadeAlpha <= 0) {
                this.fadeAlpha = 0;
            } else {
                requestAnimationFrame(fade);
            }
        };
        fade();
    }

    showGameComplete() {
        this.state = 'gameComplete';
        this.speak('ぜんぶ かけたね！ おめでとう！ あいうえおの はかせだ！');
        this.effects.spawnFireworks(10);
        this.effects.spawnPetalStorm(100);
        setTimeout(() => this.effects.spawnConfetti(200), 500);
        setTimeout(() => {
            this.hud.classList.add('hidden');
            this.showStageSelect();
        }, 8000);
    }

    /* ---------- 描画 ---------- */

    render() {
        const ctx = this.gameCtx;
        ctx.save();

        ctx.fillStyle = '#e8f4fc';
        ctx.fillRect(0, 0, this.width, this.height);

        this.renderBackground(ctx);
        this.effects.render(ctx);

        if (this.state !== 'title' && this.state !== 'select') {
            if (this.useSprites && this.dogSprite) {
                this.dogSprite.update(16);
                this.dogSprite.x = this.dog.x + this.dog.width / 2;
                this.dogSprite.y = this.dog.y + this.dog.height / 2;
                this.dogSprite.scaleX = 1.5;
                this.dogSprite.scaleY = 1.5;
                this.dogSprite.render(ctx);
            } else {
                this.dog.render(ctx);
            }
        }

        this.renderForeground(ctx);

        if (this.state === 'event') {
            this.renderEventGuide(ctx);
        }

        // 画面最前面の花畑＋舞う花びら（前景よりさらに手前）
        this.effects.renderFront(ctx);

        if (this.fadeAlpha > 0) {
            ctx.fillStyle = `rgba(20, 16, 28, ${this.fadeAlpha})`;
            ctx.fillRect(0, 0, this.width, this.height);
        }

        ctx.restore();
    }

    renderBackground(ctx) {
        for (const layer of this.backgroundLayers) {
            if (layer.foreground) continue;
            this.renderBackgroundLayer(ctx, layer);
        }
    }

    renderForeground(ctx) {
        for (const layer of this.backgroundLayers) {
            if (!layer.foreground) continue;
            this.renderBackgroundLayer(ctx, layer);
        }
    }

    renderBackgroundLayer(ctx, layer) {
        if (!layer.imageElement) return;

        const img = layer.imageElement;
        const parallaxX = this.scrollX * layer.parallax;

        const imgAspect = img.width / img.height;
        const layerHeight = this.height * layer.height;
        const layerWidth = layerHeight * imgAspect;
        const layerY = this.height * layer.y;

        let alpha = 1.0;
        if (layer.progressive) {
            const totalEvents = this.events.length;
            const target = totalEvents > 0 ? this.currentEventIndex / totalEvents : 0;
            // 段階値へなめらかに追従（最後は満開ウェーブと同期して速めに開く）
            if (this._progAlpha === undefined) this._progAlpha = target;
            const rate = target >= 1 ? 0.05 : 0.025;
            this._progAlpha += (target - this._progAlpha) * rate;
            alpha = this._progAlpha;
            if (alpha <= 0.005) return;
        }

        ctx.save();
        ctx.globalAlpha = alpha;

        if (layer.panorama) {
            // 1枚の風景画を繰り返さず、ステージ進行(0→1)で端から端までパンする
            // （タイル繰り返しだと継ぎ目や鏡写しが出るため）
            const maxScroll = Math.max(1, this.currentStage ? this.currentStage.width : 1);
            const t = Math.min(1, Math.max(0, this.scrollX / maxScroll));
            const overflow = layerWidth - this.width;
            if (overflow > 0) {
                ctx.drawImage(img, -overflow * t, layerY, layerWidth, layerHeight);
            } else {
                // 画像が画面より狭い場合は引き伸ばしてカバー
                ctx.drawImage(img, 0, layerY, this.width, layerHeight);
            }
        } else {
            const startX = -(parallaxX % layerWidth);
            for (let x = startX; x < this.width + layerWidth; x += layerWidth) {
                ctx.drawImage(img, x, layerY, layerWidth, layerHeight);
            }
        }
        ctx.restore();
    }

    renderEventGuide(ctx) {
        if (!this.currentEvent) return;

        const time = Date.now() * 0.003;
        const butterflyX = this.width * 0.5 + Math.sin(time) * 30;
        const butterflyY = this.height * 0.4 + Math.cos(time * 1.5) * 20;
        this.drawButterfly(ctx, butterflyX, butterflyY);
        this.drawSparkles(ctx, this.width * 0.5, this.height * 0.5);
    }

    drawButterfly(ctx, x, y) {
        ctx.save();
        ctx.translate(x, y);

        const time = Date.now() * 0.01;
        const wingAngle = Math.sin(time) * 0.3;

        ctx.save();
        ctx.rotate(wingAngle);
        ctx.fillStyle = '#ffb7c5';
        ctx.beginPath();
        ctx.ellipse(-8, 0, 12, 8, -0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.rotate(-wingAngle);
        ctx.fillStyle = '#ffb7c5';
        ctx.beginPath();
        ctx.ellipse(8, 0, 12, 8, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = '#4a5568';
        ctx.beginPath();
        ctx.ellipse(0, 0, 3, 10, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    drawSparkles(ctx, centerX, centerY) {
        const time = Date.now() * 0.002;
        for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2 + time;
            const radius = 40 + Math.sin(time * 2 + i) * 10;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;
            const alpha = 0.3 + Math.sin(time * 3 + i * 2) * 0.3;
            const size = 3 + Math.sin(time * 4 + i) * 2;

            ctx.fillStyle = `rgba(255, 223, 186, ${alpha})`;
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

/* ========================================
   犬キャラクター（Canvas描画フォールバック）
   ======================================== */
class DogCharacter {
    constructor(engine) {
        this.engine = engine;
        this.x = 150;
        this.y = 0;
        this.width = 80;
        this.height = 60;

        this.animState = 'walking';
        this.frame = 0;
        this.walkCycle = 0;
        this.tailAngle = 0;
        this.earAngle = 0;
        this.legOffset = 0;
    }

    update(gameState) {
        this.frame++;

        switch (gameState) {
            case 'walking':
                this.animState = 'walking';
                this.walkCycle = Math.sin(this.frame * 0.15) * 5;
                this.tailAngle = Math.sin(this.frame * 0.1) * 0.2;
                this.legOffset = Math.abs(Math.sin(this.frame * 0.15)) * 8;
                break;
            case 'event':
            case 'writing':
                this.animState = 'listening';
                this.walkCycle = 0;
                this.earAngle = Math.sin(this.frame * 0.1) * 0.15;
                this.legOffset = 0;
                break;
            case 'celebrating':
            case 'stageComplete':
            case 'gameComplete':
                this.animState = 'celebrating';
                this.tailAngle = Math.sin(this.frame * 0.3) * 0.5;
                this.walkCycle = Math.sin(this.frame * 0.2) * 3;
                break;
        }

        this.y = this.engine.height * 0.75 - this.height + this.walkCycle;
    }

    stopAndListen() { this.animState = 'listening'; }
    celebrate() { this.animState = 'celebrating'; }

    render(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        this.drawDog(ctx);
        ctx.restore();
    }

    drawDog(ctx) {
        // 影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.beginPath();
        ctx.ellipse(40, this.height + 5, 35, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        // 後ろ脚
        ctx.fillStyle = '#d4a574';
        this.drawLeg(ctx, 55, this.height - 15, -this.legOffset);

        // しっぽ
        ctx.save();
        ctx.translate(70, 25);
        ctx.rotate(this.tailAngle);
        ctx.fillStyle = '#e8c9a0';
        ctx.beginPath();
        ctx.ellipse(10, 0, 15, 6, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 胴体
        ctx.fillStyle = '#f5deb3';
        ctx.beginPath();
        ctx.ellipse(40, 30, 35, 25, 0, 0, Math.PI * 2);
        ctx.fill();

        // 前脚
        ctx.fillStyle = '#d4a574';
        this.drawLeg(ctx, 20, this.height - 15, this.legOffset);

        // 頭
        ctx.fillStyle = '#f5deb3';
        ctx.beginPath();
        ctx.ellipse(10, 20, 22, 20, -0.2, 0, Math.PI * 2);
        ctx.fill();

        // 耳
        ctx.save();
        ctx.translate(0, 5);
        ctx.rotate(this.earAngle);
        ctx.fillStyle = '#d4a574';
        ctx.beginPath();
        ctx.ellipse(-5, -5, 10, 15, -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 目
        ctx.fillStyle = '#2d3748';
        ctx.beginPath();
        ctx.arc(5, 18, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(6, 16, 1.5, 0, Math.PI * 2);
        ctx.fill();

        // 鼻
        ctx.fillStyle = '#2d3748';
        ctx.beginPath();
        ctx.arc(-8, 22, 5, 0, Math.PI * 2);
        ctx.fill();

        // 口（笑顔）
        if (this.animState === 'celebrating') {
            ctx.strokeStyle = '#2d3748';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(-5, 28, 8, 0.2, Math.PI - 0.2);
            ctx.stroke();
        }
    }

    drawLeg(ctx, x, y, offset) {
        ctx.beginPath();
        ctx.roundRect(x - 5, y - offset, 10, 20 + offset, 5);
        ctx.fill();
    }
}

/* ========================================
   ゲーム開始
   ======================================== */
let game;
window.addEventListener('DOMContentLoaded', () => {
    game = new GameEngine();
});
