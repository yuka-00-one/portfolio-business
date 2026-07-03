/* ========================================
   はなさかわんわん - なぞり書きシステム（完成版）

   ・書き順どおりに1画ずつなぞる
   ・始点の近くから書き始める（光って教えてくれる）
   　→ 外れていても途中でラインに乗れば復帰OK（幼児向け）
   ・お手本ラインに沿って進むと進捗が伸びる
   ・65%以上なぞれたら1画クリア（リトライするほどさらに甘く）
   ・足りなければ やさしくリトライ
   ======================================== */

class WritingSystem {
    constructor(engine) {
        this.engine = engine;
        this.canvas = engine.writingCanvas;
        this.ctx = engine.writingCtx;

        // 文字の状態
        this.currentCharacter = null;
        this.allStrokes = [];         // 全ストローク（リサンプル済み点列）
        this.currentStrokeIndex = 0;
        this.completedStrokeFlags = [];
        this.strokeAccuracies = [];

        // なぞり状態
        this.active = false;
        this.isDrawing = false;
        this.tracking = false;        // 始点から正しくなぞれているか
        this.progressIndex = 0;       // お手本のどこまで進んだか
        this.matchedCount = 0;        // ユーザー点のうちライン近傍だった数
        this.totalCount = 0;
        this.userPath = [];
        this.drawnPaths = [];         // SVGモード: 書き終えた画の「自分の線」を保持
        this.lastPoint = null;
        this.attempts = 0;            // この画のリトライ回数
        this.hintTimer = 0;

        // SVG下絵キャッシュ
        this.svgImages = {};
        this.currentSvgImage = null;

        // 見た目
        this.inkColor = '#4a5568';
        this.inkColorSoft = 'rgba(74, 85, 104, 0.85)';
        this.guideColor = 'rgba(160, 135, 105, 0.55)';   // 紙を薄くしたぶん濃いめに
        this.doneColor = 'rgba(90, 105, 130, 0.9)';
        this.brushSize = 14;

        // デモアニメ（光る点がお手本をなぞる）
        this.demoT = 0;

        this.animFrame = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
        this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('pointerleave', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    }

    /* ---------- 開始・終了 ---------- */

    async startWriting(character) {
        this.currentCharacter = character;
        this.allStrokes = this.buildStrokes(character);
        this.currentStrokeIndex = 0;
        this.completedStrokeFlags = this.allStrokes.map(() => false);
        this.strokeAccuracies = [];
        this.userPath = [];
        this.drawnPaths = [];
        this.isDrawing = false;
        this.tracking = false;
        this.progressIndex = 0;
        this.attempts = 0;
        this.demoT = 0;
        this.active = true;

        await this.loadSvgImage(character);

        // サイズ依存パラメータ（幼児向けにかなり甘め）
        const minDim = Math.min(this.engine.width, this.engine.height);
        this.brushSize = Math.max(10, minDim * 0.035);
        this.tolerance = minDim * 0.16;       // ラインからこの距離まではOK
        this.startTolerance = minDim * 0.20;  // 始点判定はさらに甘く

        this.startRenderLoop();
    }

    stop() {
        this.active = false;
        if (this.animFrame) {
            cancelAnimationFrame(this.animFrame);
            this.animFrame = null;
        }
        this.ctx.clearRect(0, 0, this.engine.width, this.engine.height);
    }

    /* ---------- ストローク構築 ---------- */

    buildStrokes(char) {
        const data = (typeof CharacterPaths !== 'undefined') ? CharacterPaths[char] : null;
        const scale = Math.min(this.engine.width, this.engine.height) * 0.0072;
        const cx = this.engine.width * 0.5;
        const cy = this.engine.height * 0.5;

        let rawStrokes;
        if (data && data.strokes) {
            rawStrokes = data.strokes.map(stroke =>
                stroke.map(p => Array.isArray(p) ? { x: p[0], y: p[1] } : p)
            );
        } else {
            // データがない文字は対角線（開発時のフォールバック）
            console.warn(`文字データなし: ${char}`);
            rawStrokes = [[{ x: 30, y: 30 }, { x: 70, y: 70 }]];
        }

        // 画面座標に変換 → スムーズ化 → 等間隔リサンプル
        const step = Math.max(4, Math.min(this.engine.width, this.engine.height) * 0.015);
        return rawStrokes.map(stroke => {
            const scaled = stroke.map(p => ({
                x: cx + (p.x - 50) * scale,
                y: cy + (p.y - 50) * scale
            }));
            return this.resample(this.smoothPath(scaled), step);
        });
    }

    // Catmull-Rom的に中間点を補間してなめらかに
    smoothPath(points) {
        if (points.length < 3) return points;
        const out = [];
        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(points.length - 1, i + 2)];
            const segments = 8;
            for (let t = 0; t < segments; t++) {
                const s = t / segments;
                const s2 = s * s, s3 = s2 * s;
                out.push({
                    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * s +
                        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 +
                        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3),
                    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * s +
                        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 +
                        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3)
                });
            }
        }
        out.push(points[points.length - 1]);
        return out;
    }

    // 一定間隔の点列にリサンプル（進捗判定を安定させる）
    resample(points, step) {
        if (points.length < 2) return points;
        const out = [points[0]];
        let acc = 0;
        for (let i = 1; i < points.length; i++) {
            let prev = points[i - 1];
            const cur = points[i];
            let d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
            while (acc + d >= step) {
                const t = (step - acc) / d;
                const nx = prev.x + (cur.x - prev.x) * t;
                const ny = prev.y + (cur.y - prev.y) * t;
                out.push({ x: nx, y: ny });
                prev = { x: nx, y: ny };
                d = Math.hypot(cur.x - prev.x, cur.y - prev.y);
                acc = 0;
            }
            acc += d;
        }
        out.push(points[points.length - 1]);
        return out;
    }

    async loadSvgImage(char) {
        this.currentSvgImage = null;
        const charData = (typeof CharacterPaths !== 'undefined') ? CharacterPaths[char] : null;
        if (!charData || !charData.svg) return;
        if (this.svgImages[char]) {
            this.currentSvgImage = this.svgImages[char];
            return;
        }
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                this.svgImages[char] = img;
                this.currentSvgImage = img;
                resolve();
            };
            img.onerror = () => resolve();
            img.src = charData.svg;
        });
    }

    /* ---------- 描画ループ ---------- */

    startRenderLoop() {
        if (this.animFrame) cancelAnimationFrame(this.animFrame);
        const loop = () => {
            if (!this.active) return;
            this.renderFrame();
            this.animFrame = requestAnimationFrame(loop);
        };
        this.animFrame = requestAnimationFrame(loop);
    }

    renderFrame() {
        const ctx = this.ctx;
        const w = this.engine.width, h = this.engine.height;
        ctx.clearRect(0, 0, w, h);

        // 和紙のような半透明の紙（背景の花畑が透けて見える濃さに）
        ctx.fillStyle = 'rgba(255, 251, 244, 0.7)';
        ctx.fillRect(0, 0, w, h);

        // 紙のふち
        const pad = Math.min(w, h) * 0.04;
        ctx.strokeStyle = 'rgba(196, 174, 145, 0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(pad, pad, w - pad * 2, h - pad * 2, 18);
        ctx.stroke();

        // 画数表示
        ctx.fillStyle = 'rgba(140, 120, 100, 0.8)';
        ctx.font = `bold ${Math.max(18, h * 0.045)}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(`${this.currentStrokeIndex + 1} / ${this.allStrokes.length} かくめ`, w - pad - 14, pad + h * 0.06);

        // SVG下絵（あれば薄く表示）
        this.drawSvgUnderlay(ctx);

        // お手本ストローク
        this.drawTemplateStrokes(ctx);

        // SVGモード: 書き終えた画は「自分の描いた線」をインクで残す
        this.drawDrawnPaths(ctx);

        // 進捗（なぞった部分がインク色で伸びていく）
        this.drawProgress(ctx);

        // ユーザーの現在のなぞり線
        this.drawUserPath(ctx);

        // 始点ガイド＆デモアニメ
        if (!this.isDrawing) {
            this.demoT += 0.012;
            this.drawStartGuide(ctx);
            this.drawDemoDot(ctx);
        }
    }

    drawSvgUnderlay(ctx) {
        if (!this.currentSvgImage) return;
        // SVGは700x700 → ストローク座標(0-100)と同じ中心合わせで描画
        const scale = Math.min(this.engine.width, this.engine.height) * 0.0072;
        const size = 100 * scale;
        const x0 = this.engine.width * 0.5 - size / 2;
        const y0 = this.engine.height * 0.5 - size / 2;
        ctx.save();
        // SVGがある文字はこれが唯一のお手本文字なので、しっかり見える濃さで
        ctx.globalAlpha = 0.5;
        ctx.drawImage(this.currentSvgImage, x0, y0, size, size);
        ctx.restore();
    }

    drawTemplateStrokes(ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // SVG下絵がある文字は、ストローク由来の文字線を描くと文字が二重に見えるため
        // 文字の形はSVGだけに任せる（矢印・肉球・なぞりインクなどの誘導だけ描く）
        const svgOnly = !!this.currentSvgImage;
        this.allStrokes.forEach((stroke, index) => {
            if (stroke.length < 2) return;
            if (this.completedStrokeFlags[index]) {
                // 完了した画：きれいなインクで清書
                // （SVGモードではストローク形でなく「自分の描いた線」を drawDrawnPaths で残す）
                if (!svgOnly) this.drawBrushStroke(ctx, stroke, this.doneColor, this.brushSize);
            } else if (index === this.currentStrokeIndex) {
                // いまなぞる画：他の画と同じ太さ（太くすると分かりにくいため）。
                // 区別は色の濃さ＋方向矢印＋始点の肉球とデモ光で伝える
                if (!svgOnly) {
                    ctx.strokeStyle = this.guideColor;
                    ctx.lineWidth = this.brushSize * 1.2;
                    this.strokePolyline(ctx, stroke);
                }
                this.drawDirectionChevrons(ctx, stroke);
            } else if (!svgOnly) {
                // まだ先の画：文字の形が分かる程度に薄く
                ctx.strokeStyle = 'rgba(180, 155, 125, 0.3)';
                ctx.lineWidth = this.brushSize * 1.2;
                this.strokePolyline(ctx, stroke);
            }
        });
    }

    strokePolyline(ctx, points) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
    }

    // 筆っぽい清書（中心が濃く、淡いにじみをまとう）
    drawBrushStroke(ctx, points, color, size) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = size * 1.7;
        this.strokePolyline(ctx, points);
        ctx.globalAlpha = 1.0;
        ctx.lineWidth = size;
        this.strokePolyline(ctx, points);
        ctx.restore();
    }

    // なぞる方向を示す小さな矢じるし
    drawDirectionChevrons(ctx, stroke) {
        const n = stroke.length;
        const count = Math.min(4, Math.floor(n / 10));
        ctx.save();
        ctx.fillStyle = 'rgba(230, 150, 70, 0.55)';
        for (let i = 1; i <= count; i++) {
            const idx = Math.floor((i / (count + 1)) * (n - 1));
            const p = stroke[idx];
            const q = stroke[Math.min(n - 1, idx + 2)];
            const angle = Math.atan2(q.y - p.y, q.x - p.x);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(angle);
            const s = this.brushSize * 0.5;
            ctx.beginPath();
            ctx.moveTo(s, 0);
            ctx.lineTo(-s * 0.5, -s * 0.7);
            ctx.lineTo(-s * 0.5, s * 0.7);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();
    }

    drawDrawnPaths(ctx) {
        if (!this.drawnPaths || this.drawnPaths.length === 0) return;
        this.drawnPaths.forEach((p) => this.drawBrushStroke(ctx, p, this.doneColor, this.brushSize));
    }

    drawProgress(ctx) {
        // SVGモードではお手本ストローク形のインクは描かない（文字が二重に見えるため）
        if (this.currentSvgImage) return;
        const stroke = this.allStrokes[this.currentStrokeIndex];
        if (!stroke || this.progressIndex < 1) return;
        const done = stroke.slice(0, this.progressIndex + 1);
        this.drawBrushStroke(ctx, done, this.inkColorSoft, this.brushSize);
    }

    drawUserPath(ctx) {
        if (this.userPath.length < 2) return;
        if (this.currentSvgImage) {
            // SVGモード: 自分の線がそのまま筆のインクになる
            this.drawBrushStroke(ctx, this.userPath, this.inkColorSoft, this.brushSize * 0.9);
            return;
        }
        ctx.save();
        ctx.strokeStyle = this.tracking ? 'rgba(74, 85, 104, 0.5)' : 'rgba(74, 85, 104, 0.2)';
        ctx.lineWidth = this.brushSize * 0.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.strokePolyline(ctx, this.userPath);
        ctx.restore();
    }

    drawStartGuide(ctx) {
        const stroke = this.allStrokes[this.currentStrokeIndex];
        if (!stroke || stroke.length === 0) return;
        const p = stroke[0];
        const t = performance.now() * 0.004;
        const pulse = Math.sin(t) * 0.3 + 0.7;
        const radius = this.brushSize * (1.4 + Math.sin(t) * 0.3);

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 2);
        grad.addColorStop(0, `rgba(255, 200, 100, ${pulse})`);
        grad.addColorStop(0.6, `rgba(255, 170, 90, ${pulse * 0.4})`);
        grad.addColorStop(1, 'rgba(255, 170, 90, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 2, 0, Math.PI * 2);
        ctx.fill();

        // 肉球マーク（ここから！）
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = `rgba(225, 130, 70, ${0.5 + pulse * 0.4})`;
        const s = this.brushSize * 0.45;
        ctx.beginPath(); ctx.ellipse(0, s * 0.4, s, s * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.arc(i * s * 0.9, -s * 0.6 - (i === 0 ? s * 0.25 : 0), s * 0.38, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    // 光る点がお手本の上を走って、なぞり方を見せる
    drawDemoDot(ctx) {
        const stroke = this.allStrokes[this.currentStrokeIndex];
        if (!stroke || stroke.length < 2) return;
        const t = this.demoT % 1.3;          // 1.3秒周期（最後に少し休む）
        if (t > 1.0) return;
        const idx = Math.floor(t * (stroke.length - 1));
        const p = stroke[idx];

        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, this.brushSize * 1.2);
        grad.addColorStop(0, 'rgba(255, 240, 200, 0.9)');
        grad.addColorStop(0.5, 'rgba(255, 200, 120, 0.5)');
        grad.addColorStop(1, 'rgba(255, 200, 120, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, this.brushSize * 1.2, 0, Math.PI * 2);
        ctx.fill();
    }

    /* ---------- 入力処理 ---------- */

    getPointerPosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (this.engine.width / rect.width),
            y: (e.clientY - rect.top) * (this.engine.height / rect.height)
        };
    }

    onPointerDown(e) {
        if (!this.active) return;
        e.preventDefault();
        const point = this.getPointerPosition(e);
        const stroke = this.allStrokes[this.currentStrokeIndex];
        if (!stroke) return;

        this.isDrawing = true;
        this.userPath = [point];
        this.lastPoint = point;
        this.matchedCount = 0;
        this.totalCount = 0;

        // 始点付近から始めたか（先頭35%以内のどこかに近ければOK）
        const searchEnd = Math.max(2, Math.floor(stroke.length * 0.35));
        let best = -1, bestDist = Infinity;
        for (let i = 0; i < searchEnd; i++) {
            const d = Math.hypot(point.x - stroke[i].x, point.y - stroke[i].y);
            if (d < bestDist) { bestDist = d; best = i; }
        }
        // リトライが続いたら判定をやさしく
        const tol = this.startTolerance * (1 + this.attempts * 0.3);
        this.tracking = bestDist <= tol;
        this.progressIndex = this.tracking ? best : 0;

        if (this.tracking) {
            audioManager.playSFX('ink_draw');
        }
    }

    onPointerMove(e) {
        if (!this.active || !this.isDrawing) return;
        e.preventDefault();
        const point = this.getPointerPosition(e);
        const prev = this.lastPoint;
        this.userPath.push(point);
        this.lastPoint = point;
        this.totalCount++;

        const stroke = this.allStrokes[this.currentStrokeIndex];
        if (!stroke) return;

        const tol = this.tolerance * (1 + this.attempts * 0.25);

        // 書き出しが外れていても、途中でラインの前半に乗れたら復帰OK（幼児向け）
        if (!this.tracking) {
            const searchEnd = Math.max(2, Math.floor(stroke.length * 0.5));
            for (let i = 0; i < searchEnd; i++) {
                const d = Math.hypot(point.x - stroke[i].x, point.y - stroke[i].y);
                if (d <= this.startTolerance) {
                    this.tracking = true;
                    this.progressIndex = Math.max(this.progressIndex, i);
                    break;
                }
            }
        }

        // 進捗を進める：少し先までの窓から最も遠くまで届いた点を採用
        const lookahead = 16;
        let advanced = false;
        for (let i = Math.min(stroke.length - 1, this.progressIndex + lookahead); i > this.progressIndex; i--) {
            const d = Math.hypot(point.x - stroke[i].x, point.y - stroke[i].y);
            if (d <= tol) {
                this.progressIndex = i;
                advanced = true;
                break;
            }
        }

        // 精度カウント（現在位置がライン近傍か）
        const near = stroke[Math.min(stroke.length - 1, this.progressIndex)];
        if (Math.hypot(point.x - near.x, point.y - near.y) <= tol * 1.3) {
            this.matchedCount++;
        }

        if (advanced && this.progressIndex % 12 === 0) {
            audioManager.playSFX('ink_draw');
        }
    }

    onPointerUp(e) {
        if (!this.active || !this.isDrawing) return;
        e.preventDefault();
        this.isDrawing = false;

        const stroke = this.allStrokes[this.currentStrokeIndex];
        if (!stroke) return;

        const progressRatio = this.progressIndex / (stroke.length - 1);

        // 必要進捗65%。リトライするたびにさらに甘く（最低45%）
        const required = Math.max(0.45, 0.65 - this.attempts * 0.1);
        if (this.tracking && progressRatio >= required) {
            this.onStrokeComplete(progressRatio);
        } else {
            this.onStrokeRetry();
        }
    }

    onStrokeComplete(progressRatio) {
        // 精度 = ライン近傍にいた割合と進捗の合成
        const followRatio = this.totalCount > 0 ? this.matchedCount / this.totalCount : 0.7;
        const accuracy = Math.max(0.5, Math.min(1, progressRatio * 0.5 + followRatio * 0.5));
        this.strokeAccuracies.push(accuracy);

        this.completedStrokeFlags[this.currentStrokeIndex] = true;
        // SVGモード: 自分の描いた線を清書として残す
        if (this.currentSvgImage && this.userPath.length > 1) {
            this.drawnPaths.push(this.userPath.slice());
        }
        this.userPath = [];
        this.attempts = 0;

        audioManager.playSFX('sparkle');

        // 次の画へ
        this.currentStrokeIndex++;
        this.progressIndex = 0;
        this.tracking = false;
        this.demoT = 0;

        if (this.currentStrokeIndex >= this.allStrokes.length) {
            // 全画クリア！
            const total = this.strokeAccuracies.reduce((a, b) => a + b, 0) / this.strokeAccuracies.length;
            this.active = false;   // 入力停止（描画ループも止まる）
            setTimeout(() => {
                this.stop();
                this.engine.onWritingSuccess(total);
            }, 600);
        }
    }

    onStrokeRetry() {
        this.attempts++;
        this.userPath = [];
        this.progressIndex = 0;
        this.tracking = false;
        this.demoT = 0;

        // やさしい音＆メッセージ
        audioManager.playSFX('retry');
        if (this.engine.showHint) {
            this.engine.showHint(this.attempts >= 2 ? 'ひかる ところから ゆっくりね' : 'もういちど！');
        }
    }
}
