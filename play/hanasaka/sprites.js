/* ========================================
   もじのさんぽ - スプライトアニメーションシステム
   動くイラストの管理
   ======================================== */

class SpriteManager {
    constructor() {
        this.sprites = {};
        this.loadedImages = {};
    }

    /**
     * スプライトシートを登録
     * @param {string} name - スプライト名
     * @param {object} config - 設定
     *   - imagePath: 画像パス
     *   - frameWidth: 1フレームの幅
     *   - frameHeight: 1フレームの高さ
     *   - animations: アニメーション定義 { name: { frames: [0,1,2], fps: 10, loop: true } }
     */
    async registerSprite(name, config) {
        const image = await this.loadImage(config.imagePath);

        const cols = Math.floor(image.width / config.frameWidth);
        const rows = Math.floor(image.height / config.frameHeight);

        this.sprites[name] = {
            image: image,
            frameWidth: config.frameWidth,
            frameHeight: config.frameHeight,
            cols: cols,
            rows: rows,
            totalFrames: cols * rows,
            animations: config.animations || {}
        };

        return this.sprites[name];
    }

    async loadImage(path) {
        if (this.loadedImages[path]) {
            return this.loadedImages[path];
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.loadedImages[path] = img;
                resolve(img);
            };
            img.onerror = () => reject(new Error(`Failed to load image: ${path}`));
            img.src = path;
        });
    }

    getSprite(name) {
        return this.sprites[name];
    }
}

/* ========================================
   アニメーションするスプライトインスタンス
   ======================================== */
class AnimatedSprite {
    constructor(spriteData, x = 0, y = 0) {
        this.spriteData = spriteData;
        this.x = x;
        this.y = y;
        this.scaleX = 1;
        this.scaleY = 1;
        this.rotation = 0;
        this.alpha = 1;
        this.anchorX = 0.5; // 中心を基準
        this.anchorY = 0.5;

        // アニメーション状態
        this.currentAnimation = null;
        this.currentFrame = 0;
        this.frameTimer = 0;
        this.isPlaying = false;
        this.onAnimationComplete = null;
    }

    /**
     * アニメーションを再生
     * @param {string} animationName - アニメーション名
     * @param {function} onComplete - 完了時コールバック（ループしない場合）
     */
    play(animationName, onComplete = null) {
        const anim = this.spriteData.animations[animationName];
        if (!anim) {
            console.warn(`Animation not found: ${animationName}`);
            return;
        }

        this.currentAnimation = anim;
        this.currentFrame = 0;
        this.frameTimer = 0;
        this.isPlaying = true;
        this.onAnimationComplete = onComplete;
    }

    stop() {
        this.isPlaying = false;
    }

    update(deltaTime = 16) {
        if (!this.isPlaying || !this.currentAnimation) return;

        const anim = this.currentAnimation;
        const frameDuration = 1000 / (anim.fps || 10);

        this.frameTimer += deltaTime;

        if (this.frameTimer >= frameDuration) {
            this.frameTimer -= frameDuration;
            this.currentFrame++;

            if (this.currentFrame >= anim.frames.length) {
                if (anim.loop !== false) {
                    this.currentFrame = 0;
                } else {
                    this.currentFrame = anim.frames.length - 1;
                    this.isPlaying = false;
                    if (this.onAnimationComplete) {
                        this.onAnimationComplete();
                    }
                }
            }
        }
    }

    render(ctx) {
        if (!this.spriteData || !this.spriteData.image) return;

        const frameIndex = this.currentAnimation
            ? this.currentAnimation.frames[this.currentFrame]
            : 0;

        const { image, frameWidth, frameHeight, cols } = this.spriteData;

        const srcX = (frameIndex % cols) * frameWidth;
        const srcY = Math.floor(frameIndex / cols) * frameHeight;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);
        ctx.scale(this.scaleX, this.scaleY);
        ctx.globalAlpha = this.alpha;

        ctx.drawImage(
            image,
            srcX, srcY, frameWidth, frameHeight,
            -frameWidth * this.anchorX,
            -frameHeight * this.anchorY,
            frameWidth,
            frameHeight
        );

        ctx.restore();
    }

    // 単一フレームを表示（静止画として使用）
    setFrame(frameIndex) {
        this.isPlaying = false;
        this.currentAnimation = { frames: [frameIndex], fps: 1, loop: false };
        this.currentFrame = 0;
    }
}

/* ========================================
   犬キャラクター用のスプライト設定
   ======================================== */
const DogSpriteConfig = {
    // スプライトシート（3行×6列）
    // 画像サイズに合わせて調整してください
    imagePath: 'assets/sprites/dog_sprite.png',
    frameWidth: 128,   // 各フレームの幅
    frameHeight: 100,  // 各フレームの高さ
    animations: {
        'idle': {
            frames: [0],
            fps: 1,
            loop: false
        },
        'walk': {
            // 1行目: 歩き（フレーム 0-5）
            frames: [0, 1, 2, 3, 4, 5],
            fps: 8,
            loop: true
        },
        'listen': {
            frames: [0, 1],
            fps: 4,
            loop: true
        },
        'happy': {
            // 2行目: 嬉しい（フレーム 6-11）
            frames: [6, 7, 8, 9, 10, 11],
            fps: 10,
            loop: true
        },
        'celebrate': {
            // 3行目: お祝い（フレーム 12-17）
            frames: [12, 13, 14, 15, 16, 17],
            fps: 12,
            loop: true
        }
    }
};

/* ========================================
   スプライトシート作成ガイド
   ======================================== */
/*
┌─────────────────────────────────────────────────────────────────────┐
│  スプライトシートの作り方                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 各フレームを同じサイズで並べる（例: 128×96ピクセル）                │
│                                                                      │
│  ┌────┬────┬────┬────┬────┬────┐                                    │
│  │ 0  │ 1  │ 2  │ 3  │ 4  │ 5  │  ← walk (歩き)                     │
│  ├────┼────┼────┼────┼────┼────┤                                    │
│  │ 6  │ 7  │ 8  │ 9  │ 10 │ 11 │  ← listen(6-7) + happy(8-11)      │
│  ├────┼────┼────┼────┼────┼────┤                                    │
│  │ 12 │ 13 │ 14 │ 15 │    │    │  ← celebrate (お祝い)              │
│  └────┴────┴────┴────┴────┴────┘                                    │
│                                                                      │
│  2. 推奨フォーマット: PNG（透過対応）                                  │
│                                                                      │
│  3. 配置場所: assets/sprites/dog_sprite.png                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

アニメーション定義の説明:
- frames: フレーム番号の配列（左上から右へ、上から下へ数える）
- fps: 1秒あたりのフレーム数
- loop: ループするかどうか（true/false）
*/

// グローバルインスタンス
const spriteManager = new SpriteManager();
