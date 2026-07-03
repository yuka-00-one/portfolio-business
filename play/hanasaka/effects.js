/* ========================================
   はなさかわんわん - エフェクトマネージャー
   水彩イラストの花（FlowerArt）＋
   花畑（GardenFlower）・満開ウェーブ・花びら・紙吹雪・花火
   ======================================== */

/* ========================================
   水彩イラストの花アセット
   assets/sprites/flowers/flower_NN.png（透過済み）
   茎付き → 花畑用 / 花頭のみ → バースト用
   ロード時に使用サイズへ縮小キャッシュしておく（毎フレームの縮小を回避）
   ======================================== */
const FlowerArt = {
    stems: {},   // 番号→canvas 茎付き（02黄, 03コスモス, 04マーガレット, 09カンパニュラ）
    heads: {},   // 番号→canvas 花頭のみ（01ピンク, 05紫, 06青, 07黄, 08白）

    /* ステージごとの花テーマ（咲く花の種類が変わる） */
    themes: {
        sakura: { stems: [3, 4], heads: [1, 8] },         // 春のピンク系
        mizube: { stems: [9, 4], heads: [6, 5, 8] },      // 水辺の青・紫系
        himawari: { stems: [2, 3], heads: [7, 1] }        // ひだまりの黄・暖色系
    },
    theme: null,   // 現在のテーマ名（null/不明なら全種から）

    load() {
        const defs = [
            { nums: [2, 3, 4, 9], store: this.stems, maxH: 220 },
            { nums: [1, 5, 6, 7, 8], store: this.heads, maxH: 150 }
        ];
        for (const d of defs) {
            for (const n of d.nums) {
                const img = new Image();
                img.onload = () => {
                    const h = Math.min(d.maxH, img.naturalHeight);
                    const w = h * img.naturalWidth / img.naturalHeight;
                    const cv = document.createElement('canvas');
                    cv.width = Math.ceil(w);
                    cv.height = Math.ceil(h);
                    cv.getContext('2d').drawImage(img, 0, 0, w, h);
                    d.store[n] = cv;
                };
                img.src = `assets/sprites/flowers/flower_${String(n).padStart(2, '0')}.png`;
            }
        }
    },

    pickFrom(store, themeNums) {
        let pool = (themeNums || []).map(n => store[n]).filter(Boolean);
        if (!pool.length) pool = Object.values(store);   // テーマ分が未ロードなら全種
        return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    },
    pickStem() {
        const t = this.themes[this.theme];
        return this.pickFrom(this.stems, t && t.stems);
    },
    pickHead() {
        const t = this.themes[this.theme];
        return this.pickFrom(this.heads, t && t.heads);
    }
};
FlowerArt.load();

/* 花畑の奥行き列: 奥は小さく、手前は大きく描いて野原に見せる
   parallax は背景レイヤーと同調（後景0.3〜中景1.0〜前景1.5）させ、
   奥の花はゆっくり・手前の花は速くスクロールして奥行きを出す */
const GARDEN_ROWS = [
    { y0: 0.62, y1: 0.70, scale: 0.55, parallax: 0.8 },   // 奥
    { y0: 0.72, y1: 0.81, scale: 1.0, parallax: 1.0 },    // 中（犬と同じ地面）
    { y0: 0.83, y1: 0.94, scale: 1.5, parallax: 1.5 }     // 手前（前景の茂みと同速）
];
const GARDEN_MAX = 250;

class EffectsManager {
    constructor(engine) {
        this.engine = engine;

        this.flowers = [];
        this.sparkles = [];
        this.confetti = [];
        this.fireworks = [];
        this.garden = [];      // 地面に生える花（世界座標・スクロールで流れる）
        this.frontGarden = []; // 画面最前面の花（画面固定・ステージ中ずっと残る）
        this.petals = [];      // 舞い散る花びら
        this.rings = [];       // 開花の光の輪
    }

    /* ステージ切替時にリセット（花畑もクリア） */
    reset() {
        this.flowers = [];
        this.sparkles = [];
        this.confetti = [];
        this.fireworks = [];
        this.garden = [];
        this.frontGarden = [];
        this.petals = [];
        this.rings = [];
    }

    update() {
        this.flowers = this.flowers.filter(f => { f.update(); return f.isAlive(); });
        this.sparkles = this.sparkles.filter(s => { s.update(); return s.isAlive(); });
        this.confetti = this.confetti.filter(c => { c.update(); return c.isAlive(); });
        this.fireworks = this.fireworks.filter(f => { f.update(); return f.isAlive(); });
        this.petals = this.petals.filter(p => { p.update(); return p.isAlive(); });
        this.rings = this.rings.filter(r => { r.update(); return r.isAlive(); });
        const scrollX = this.engine.scrollX;
        this.garden = this.garden.filter(g => { g.update(); return g.isAlive(scrollX); });
        this.frontGarden.forEach(g => g.update());
    }

    render(ctx) {
        // 奥の花から描いて遠近感を出す
        [...this.garden].sort((a, b) => a.groundY - b.groundY).forEach(g => g.render(ctx));
        this.flowers.forEach(f => f.render(ctx));
        this.rings.forEach(r => r.render(ctx));
        this.sparkles.forEach(s => s.render(ctx));
        this.fireworks.forEach(f => f.render(ctx));
        this.confetti.forEach(c => c.render(ctx));
    }

    /* 最前面レイヤー（犬や前景より手前）。game.jsの描画の最後に呼ばれる */
    renderFront(ctx) {
        [...this.frontGarden].sort((a, b) => a.groundY - b.groundY).forEach(g => g.render(ctx));
        this.petals.forEach(p => p.render(ctx));
    }

    /* 花を咲かせる: 開花バースト＋地面の花畑＋舞い散る花びら */
    spawnFlowers(x, y, count) {
        const colors = ['#ffb7c5', '#fff4b8', '#d4a5ff', '#ffffff', '#ffd700'];

        // 光の輪がふわっと広がる
        this.rings.push(new BloomRing({ x, y }));

        for (let i = 0; i < count; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            const flower = new Flower({
                x: x + (Math.random() - 0.5) * 240,
                y: y + (Math.random() - 0.5) * 110,
                color,
                size: 9 + Math.random() * 13,
                delay: i * 80
            });
            this.flowers.push(flower);

            if (Math.random() > 0.5) {
                this.sparkles.push(new Sparkle({
                    x: flower.x,
                    y: flower.y - 10,
                    delay: flower.delay + 200
                }));
            }

            // 咲いた花から花びらが1〜2枚こぼれ落ちる
            const shed = 1 + Math.floor(Math.random() * 2);
            for (let k = 0; k < shed; k++) {
                this.petals.push(new FallingPetal({
                    x: flower.x + (Math.random() - 0.5) * 16,
                    y: flower.y,
                    color,
                    delay: flower.delay + 700 + Math.random() * 800
                }));
            }
        }

        // 地面に花畑を植える（ステージ中ずっと残る）
        this.plantGarden(x, Math.max(4, Math.round(count * 0.6)));
    }

    /* 地面から茎が伸びて花が咲く。スクロールと一緒に流れていく
       opts.spread: 横の散らばり幅 / opts.aheadBias: 0.5=中心、大きいほど進行方向（右）寄り */
    plantGarden(screenX, count, opts = {}) {
        const engine = this.engine;
        const spread = opts.spread || 300;
        const aheadBias = opts.aheadBias !== undefined ? opts.aheadBias : 0.5;
        for (let i = 0; i < count; i++) {
            const row = GARDEN_ROWS[Math.floor(Math.random() * GARDEN_ROWS.length)];
            const offset = (Math.random() - (1 - aheadBias)) * spread;
            this.garden.push(new GardenFlower({
                engine,
                screenX: screenX + offset,
                parallax: row.parallax,
                groundY: engine.height * (row.y0 + Math.random() * (row.y1 - row.y0)),
                scale: row.scale * (0.85 + Math.random() * 0.3),
                delay: i * 100 + Math.random() * 150
            }));
        }
        this.trimGarden();
    }

    /* 増えすぎたら古いものから消す（描画負荷対策） */
    trimGarden() {
        if (this.garden.length > GARDEN_MAX) {
            this.garden.splice(0, this.garden.length - GARDEN_MAX);
        }
    }

    /* 画面最前面（画面固定）の花畑。スクロールしても消えずに残る */
    plantFrontGarden(count) {
        const engine = this.engine;
        for (let i = 0; i < count; i++) {
            this.frontGarden.push(new GardenFlower({
                engine,
                screenFixed: true,
                screenX: Math.random() * engine.width,
                groundY: engine.height * (0.88 + Math.random() * 0.1),
                scale: 1.15 + Math.random() * 0.55,
                delay: i * 130 + Math.random() * 200
            }));
        }
        if (this.frontGarden.length > 80) {
            this.frontGarden.splice(0, this.frontGarden.length - 80);
        }
    }

    /* 満開ウェーブ: 中心から開花の波が広がり、画面いっぱいの野原になる */
    spawnBloomWave(centerX) {
        const engine = this.engine;
        const cx = centerX !== undefined ? centerX : engine.width * 0.45;
        const waveSpeed = 2.2;   // 1pxあたりの遅延ms（波の広がる速さ）

        for (let i = 0; i < 90; i++) {
            const sx = Math.random() * engine.width;
            const row = GARDEN_ROWS[Math.floor(Math.random() * GARDEN_ROWS.length)];
            this.garden.push(new GardenFlower({
                engine,
                screenX: sx,
                parallax: row.parallax,
                groundY: engine.height * (row.y0 + Math.random() * (row.y1 - row.y0)),
                scale: row.scale * (0.85 + Math.random() * 0.3),
                delay: Math.abs(sx - cx) * waveSpeed + Math.random() * 250
            }));
        }

        // 画面下端に大きな花を並べてフレームに（画面固定＝スクロールしても残る）
        for (let i = 0; i < 12; i++) {
            const sx = ((i + 0.5) / 12) * engine.width + (Math.random() - 0.5) * 40;
            this.frontGarden.push(new GardenFlower({
                engine,
                screenFixed: true,
                screenX: sx,
                groundY: engine.height * (0.90 + Math.random() * 0.08),
                scale: 1.9 + Math.random() * 0.5,
                delay: Math.abs(sx - cx) * waveSpeed + 300
            }));
        }
        this.trimGarden();

        // 波と同期した大きな光の輪＋画面のあちこちでキラキラ
        this.rings.push(new BloomRing({
            x: cx, y: engine.height * 0.7,
            maxRadius: engine.width * 0.55, maxLife: 1300
        }));
        for (let i = 0; i < 14; i++) {
            this.sparkles.push(new Sparkle({
                x: Math.random() * engine.width,
                y: engine.height * (0.45 + Math.random() * 0.4),
                delay: Math.random() * 1500
            }));
        }
    }

    /* 画面全体に花びらが舞う（ステージクリア用の桜吹雪） */
    spawnPetalStorm(count = 60) {
        const colors = ['#ffb7c5', '#ffd1dc', '#fff4b8', '#d4a5ff', '#ffffff'];
        for (let i = 0; i < count; i++) {
            this.petals.push(new FallingPetal({
                x: Math.random() * this.engine.width * 1.3,
                y: -20 - Math.random() * this.engine.height * 0.5,
                color: colors[Math.floor(Math.random() * colors.length)],
                delay: i * 60 + Math.random() * 400,
                drift: -0.8 - Math.random() * 1.4,   // 風で左へ流れる
                maxLife: 7000
            }));
        }
    }

    spawnConfetti(count = 100) {
        const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3'];
        for (let i = 0; i < count; i++) {
            this.confetti.push(new Confetti({
                x: Math.random() * this.engine.width,
                y: -20 - Math.random() * 100,
                color: colors[Math.floor(Math.random() * colors.length)],
                delay: i * 30
            }));
        }
    }

    spawnFireworks(count = 5) {
        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                const x = this.engine.width * 0.2 + Math.random() * this.engine.width * 0.6;
                const y = this.engine.height * 0.3 + Math.random() * this.engine.height * 0.2;
                this.fireworks.push(new Firework({ x, y }));
            }, i * 500);
        }
    }
}

/* ========================================
   花パーティクル
   ======================================== */
class Flower {
    constructor(options) {
        this.x = options.x;
        this.y = options.y;
        this.color = options.color;
        this.targetSize = options.size;
        this.delay = options.delay || 0;

        this.size = 0;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() - 0.5) * 0.02;
        this.petalCount = 5 + Math.floor(Math.random() * 3);

        this.state = 'waiting';
        this.life = 0;
        this.maxLife = 4000;
        this.bloomDuration = 500;

        this.offsetY = 0;
        this.swayPhase = Math.random() * Math.PI * 2;

        // 水彩イラスト（花頭）。未ロードならプロシージャル描画にフォールバック
        this.img = null;
        this.flip = Math.random() < 0.5 ? -1 : 1;
    }

    update() {
        this.life += 16;
        if (this.life < this.delay) return;

        const activeLife = this.life - this.delay;
        if (this.state === 'waiting' && activeLife >= 0) this.state = 'blooming';

        if (this.state === 'blooming') {
            // つぼみ（中心）がまず膨らむ
            this.size = this.targetSize * Math.min(1, activeLife / 250);
            // 最後の花びらが開ききったら完了
            const lastPetalEnd = 250 + (this.petalCount - 1) * 70 + 380;
            if (activeLife >= lastPetalEnd) this.state = 'bloomed';
        }

        if (this.state === 'bloomed') {
            this.swayPhase += 0.02;
            this.offsetY = Math.sin(this.swayPhase) * 2;
            this.rotation += this.rotationSpeed;
        }
    }

    elasticOut(t) {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 :
            Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }

    /* 花びらi枚目の開き具合（1枚ずつ時間差で、ぽんっと開く） */
    petalProgress(i) {
        const activeLife = this.life - this.delay;
        const start = 250 + i * 70;
        return this.elasticOut(Math.min(1, Math.max(0, (activeLife - start) / 380)));
    }

    isAlive() {
        return this.life < this.maxLife + this.delay;
    }

    render(ctx) {
        // 水彩イラスト版: ぽんっと弾んで開く
        if (!this.img) this.img = FlowerArt.pickHead();
        if (this.img) {
            const activeLife = this.life - this.delay;
            if (activeLife <= 0) return;
            const open = this.elasticOut(Math.min(1, activeLife / 500));
            const d = this.targetSize * 2.6 * open;
            if (d <= 0.5) return;
            const fade = Math.min(1, Math.max(0, (this.maxLife + this.delay - this.life) / 600));
            ctx.save();
            ctx.globalAlpha = fade;
            ctx.translate(this.x, this.y + this.offsetY);
            ctx.rotate(this.rotation);
            ctx.scale(this.flip, 1);
            const w = d * this.img.width / this.img.height;
            ctx.drawImage(this.img, -w / 2, -d / 2, w, d);
            ctx.restore();
            return;
        }

        if (this.size <= 0) return;

        // 終盤はふわっと消える
        const fade = Math.min(1, Math.max(0, (this.maxLife + this.delay - this.life) / 600));

        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(this.x, this.y + this.offsetY);
        ctx.rotate(this.rotation);

        ctx.fillStyle = this.color;
        for (let i = 0; i < this.petalCount; i++) {
            const open = this.petalProgress(i);
            if (open <= 0) continue;
            const angle = (i / this.petalCount) * Math.PI * 2;
            ctx.save();
            ctx.rotate(angle);
            ctx.scale(open, open);
            ctx.beginPath();
            ctx.ellipse(0, -this.size * 0.6, this.size * 0.4, this.size * 0.8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(0, 0, this.size * 0.25, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

/* ========================================
   輝きパーティクル
   ======================================== */
class Sparkle {
    constructor(options) {
        this.x = options.x;
        this.y = options.y;
        this.delay = options.delay || 0;

        this.size = 0;
        this.maxSize = 6 + Math.random() * 4;
        this.life = 0;
        this.maxLife = 1000;
        this.vy = -0.5 - Math.random() * 0.5;
    }

    update() {
        this.life += 16;
        if (this.life < this.delay) return;

        const progress = (this.life - this.delay) / this.maxLife;
        this.y += this.vy;

        if (progress < 0.2) this.size = (progress / 0.2) * this.maxSize;
        else if (progress > 0.8) this.size = ((1 - progress) / 0.2) * this.maxSize;
        else this.size = this.maxSize;
    }

    isAlive() {
        return this.life < this.maxLife + this.delay;
    }

    render(ctx) {
        if (this.size <= 0) return;
        const alpha = 0.5 + Math.sin(this.life * 0.02) * 0.3;

        ctx.fillStyle = `rgba(255, 223, 186, ${alpha})`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.x - this.size * 1.5, this.y);
        ctx.lineTo(this.x + this.size * 1.5, this.y);
        ctx.moveTo(this.x, this.y - this.size * 1.5);
        ctx.lineTo(this.x, this.y + this.size * 1.5);
        ctx.stroke();
    }
}

/* ========================================
   紙吹雪パーティクル
   ======================================== */
class Confetti {
    constructor(options) {
        this.x = options.x;
        this.y = options.y;
        this.color = options.color;
        this.delay = options.delay || 0;

        this.size = 6 + Math.random() * 6;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() - 0.5) * 0.2;

        this.vx = (Math.random() - 0.5) * 3;
        this.vy = 2 + Math.random() * 3;
        this.wobble = Math.random() * 10;
        this.wobbleSpeed = 0.1 + Math.random() * 0.1;

        this.life = 0;
        this.maxLife = 4000;
    }

    update() {
        this.life += 16;
        if (this.life < this.delay) return;

        this.wobble += this.wobbleSpeed;
        this.x += this.vx + Math.sin(this.wobble) * 2;
        this.y += this.vy;
        this.rotation += this.rotationSpeed;
        this.vy *= 0.995;
    }

    isAlive() {
        return this.life < this.maxLife + this.delay;
    }

    render(ctx) {
        if (this.life < this.delay) return;
        const alpha = Math.max(0, 1 - (this.life - this.delay) / this.maxLife);

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.size / 2, -this.size / 4, this.size, this.size / 2);
        ctx.restore();
    }
}

/* ========================================
   花火パーティクル
   ======================================== */
class Firework {
    constructor(options) {
        this.x = options.x;
        this.y = options.y;

        this.particles = [];
        this.life = 0;
        this.maxLife = 2000;

        const colors = ['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#fff'];
        const particleCount = 30 + Math.floor(Math.random() * 20);

        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const speed = 3 + Math.random() * 4;
            this.particles.push({
                x: this.x, y: this.y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                color: colors[Math.floor(Math.random() * colors.length)],
                size: 2 + Math.random() * 3,
                trail: []
            });
        }
    }

    update() {
        this.life += 16;
        this.particles.forEach(p => {
            p.trail.push({ x: p.x, y: p.y });
            if (p.trail.length > 5) p.trail.shift();
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.15;
            p.vx *= 0.98;
            p.vy *= 0.98;
        });
    }

    isAlive() {
        return this.life < this.maxLife;
    }

    render(ctx) {
        const alpha = Math.max(0, 1 - this.life / this.maxLife);

        this.particles.forEach(p => {
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.size * 0.5;
            ctx.globalAlpha = alpha * 0.5;
            if (p.trail.length > 1) {
                ctx.beginPath();
                ctx.moveTo(p.trail[0].x, p.trail[0].y);
                p.trail.forEach(t => ctx.lineTo(t.x, t.y));
                ctx.stroke();
            }
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.globalAlpha = 1;
    }
}

/* ========================================
   地面に生える花（花畑）
   茎が伸びる → 花びらが1枚ずつ開く → 風に揺れて残る
   スクロールに合わせて世界座標で流れていく
   ======================================== */
class GardenFlower {
    constructor(options) {
        this.engine = options.engine;
        this.baseX = options.screenX;               // 植えた瞬間の画面X
        this.scroll0 = options.engine.scrollX;      // 植えた瞬間のスクロール量
        this.groundY = options.groundY;
        this.delay = options.delay || 0;
        this.screenFixed = !!options.screenFixed;   // trueなら画面固定（スクロールしない）
        // 奥行きに応じた視差（奥=ゆっくり、手前=速い）。画面固定なら動かない
        this.parallax = this.screenFixed ? 0
            : (options.parallax !== undefined ? options.parallax : 1.0);

        const colors = ['#ffb7c5', '#ff9eb5', '#fff4b8', '#d4a5ff', '#ffffff', '#ffd27f'];
        this.color = colors[Math.floor(Math.random() * colors.length)];
        this.scale = options.scale || 1;
        this.stemHeight = (26 + Math.random() * 34) * this.scale;
        this.headSize = (7 + Math.random() * 6) * this.scale;

        // 水彩イラスト（茎付き）。未ロードならプロシージャル描画にフォールバック
        this.img = null;
        this.flip = Math.random() < 0.5 ? -1 : 1;
        this.displayH = (48 + Math.random() * 38) * this.scale;
        this.petalCount = 5 + Math.floor(Math.random() * 2);
        this.lean = (Math.random() - 0.5) * 0.5;   // 茎の傾き
        this.swayPhase = Math.random() * Math.PI * 2;

        this.life = 0;
        this.growDuration = 600;
    }

    update() {
        this.life += 16;
        this.swayPhase += 0.025;
    }

    /* 現在の画面X（視差適用後） */
    screenXAt(scrollX) {
        return this.baseX - (scrollX - this.scroll0) * this.parallax;
    }

    /* 画面左に流れ切ったら消す（画面固定の花は消えない） */
    isAlive(scrollX) {
        if (this.screenFixed) return true;
        return this.screenXAt(scrollX) > -80;
    }

    easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    elasticOut(t) {
        const c4 = (2 * Math.PI) / 3;
        return t === 0 ? 0 : t === 1 ? 1 :
            Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }

    petalProgress(i) {
        const t = this.life - this.delay - this.growDuration - i * 90;
        return this.elasticOut(Math.min(1, Math.max(0, t / 400)));
    }

    render(ctx) {
        const activeLife = this.life - this.delay;
        if (activeLife <= 0) return;

        const screenX = this.screenXAt(this.engine.scrollX);
        if (screenX < -80 || screenX > this.engine.width + 80) return;

        // 水彩イラスト版: 地面からぽんっと生える（根元基準で伸びて揺れる）
        if (!this.img) this.img = FlowerArt.pickStem();
        if (this.img) {
            const pop = this.elasticOut(Math.min(1, activeLife / 700));
            if (pop <= 0.01) return;
            const h = this.displayH * pop;
            const w = h * this.img.width / this.img.height;
            ctx.save();
            ctx.translate(screenX, this.groundY);
            ctx.rotate(Math.sin(this.swayPhase) * 0.045);
            ctx.scale(this.flip, 1);
            ctx.drawImage(this.img, -w / 2, -h, w, h);
            ctx.restore();
            return;
        }

        const grow = this.easeOutCubic(Math.min(1, activeLife / this.growDuration));
        const h = this.stemHeight * grow;
        const sway = Math.sin(this.swayPhase) * 2.5 * grow;
        const tipX = this.lean * h * 0.5 + sway;

        ctx.save();
        ctx.translate(screenX, this.groundY);

        // 茎（下から伸びる）
        ctx.strokeStyle = '#7aa95c';
        ctx.lineWidth = Math.min(5, Math.max(1.4, 2.5 * this.scale));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(tipX * 0.3, -h * 0.55, tipX, -h);
        ctx.stroke();

        // 葉っぱ
        if (grow > 0.55) {
            const leafGrow = Math.min(1, (grow - 0.55) / 0.45);
            ctx.fillStyle = '#8fbc6f';
            ctx.save();
            ctx.translate(tipX * 0.2, -h * 0.45);
            ctx.rotate(-0.7 + Math.sin(this.swayPhase) * 0.05);
            ctx.beginPath();
            ctx.ellipse(5 * leafGrow * this.scale, 0, 6 * leafGrow * this.scale, 2.6 * leafGrow * this.scale, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // 花の頭（花びらが1枚ずつ開く）
        if (grow >= 1) {
            ctx.save();
            ctx.translate(tipX, -h);
            ctx.rotate(sway * 0.04);

            ctx.fillStyle = this.color;
            for (let i = 0; i < this.petalCount; i++) {
                const open = this.petalProgress(i);
                if (open <= 0) continue;
                ctx.save();
                ctx.rotate((i / this.petalCount) * Math.PI * 2);
                ctx.scale(open, open);
                ctx.beginPath();
                ctx.ellipse(0, -this.headSize * 0.55, this.headSize * 0.38, this.headSize * 0.72, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            // 中心
            if (this.petalProgress(0) > 0) {
                ctx.fillStyle = '#ffcf4d';
                ctx.beginPath();
                ctx.arc(0, 0, this.headSize * 0.3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        ctx.restore();
    }
}

/* ========================================
   舞い散る花びら
   ひらひらと回転しながら落ちる。桜吹雪にも使う
   ======================================== */
class FallingPetal {
    constructor(options) {
        this.x = options.x;
        this.y = options.y;
        this.color = options.color || '#ffb7c5';
        this.delay = options.delay || 0;
        this.maxLife = options.maxLife || 3500;

        this.size = 4 + Math.random() * 4;
        this.vx = (options.drift !== undefined ? options.drift : (Math.random() - 0.5) * 0.8);
        this.vy = 0.6 + Math.random() * 0.9;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotationSpeed = (Math.random() - 0.5) * 0.15;
        this.wobble = Math.random() * Math.PI * 2;
        this.wobbleSpeed = 0.06 + Math.random() * 0.06;

        this.life = 0;
    }

    update() {
        this.life += 16;
        if (this.life < this.delay) return;

        this.wobble += this.wobbleSpeed;
        this.x += this.vx + Math.sin(this.wobble) * 1.4;
        this.y += this.vy + Math.cos(this.wobble * 0.7) * 0.3;
        this.rotation += this.rotationSpeed;
    }

    isAlive() {
        return this.life < this.maxLife + this.delay;
    }

    render(ctx) {
        if (this.life < this.delay) return;
        const t = (this.life - this.delay) / this.maxLife;
        const alpha = t < 0.1 ? t / 0.1 : Math.max(0, 1 - Math.max(0, t - 0.75) / 0.25);

        // ひらひら感: 回転に合わせて幅がつぶれる
        const squash = 0.35 + 0.65 * Math.abs(Math.sin(this.wobble * 0.9));

        ctx.save();
        ctx.globalAlpha = alpha * 0.9;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, this.size, this.size * 0.55 * squash, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

/* ========================================
   開花の光の輪
   咲いた瞬間にやわらかい輪がふわっと広がる
   ======================================== */
class BloomRing {
    constructor(options) {
        this.x = options.x;
        this.y = options.y;
        this.life = 0;
        this.maxLife = options.maxLife || 700;
        this.maxRadius = options.maxRadius || 70;
    }

    update() {
        this.life += 16;
    }

    isAlive() {
        return this.life < this.maxLife;
    }

    render(ctx) {
        const t = Math.min(1, this.life / this.maxLife);
        const ease = 1 - Math.pow(1 - t, 3);
        const radius = this.maxRadius * ease;
        const alpha = 0.55 * (1 - t);

        ctx.save();
        ctx.strokeStyle = `rgba(255, 235, 190, ${alpha})`;
        ctx.lineWidth = 6 * (1 - t) + 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}
