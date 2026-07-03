/* ========================================
   もじのさんぽ - オーディオマネージャー
   BGMと効果音の管理
   ======================================== */

class AudioManager {
    constructor() {
        // オーディオコンテキスト（ユーザー操作後に初期化）
        this.audioContext = null;
        this.isInitialized = false;

        // 音源の管理
        this.sounds = {};
        this.bgm = null;
        this.bgmGainNode = null;
        this.sfxGainNode = null;

        // 音量設定
        this.bgmVolume = 0.3;
        this.sfxVolume = 0.5;
        this.isMuted = false;

        // 初期化待機
        this.initPromise = null;
    }

    // ユーザー操作後に呼び出す
    async init() {
        if (this.isInitialized) return;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // マスターゲイン
            this.masterGain = this.audioContext.createGain();
            this.masterGain.connect(this.audioContext.destination);

            // BGM用ゲイン
            this.bgmGainNode = this.audioContext.createGain();
            this.bgmGainNode.gain.value = this.bgmVolume;
            this.bgmGainNode.connect(this.masterGain);

            // 効果音用ゲイン
            this.sfxGainNode = this.audioContext.createGain();
            this.sfxGainNode.gain.value = this.sfxVolume;
            this.sfxGainNode.connect(this.masterGain);

            this.isInitialized = true;
            console.log('🔊 AudioManager initialized');

            // プリロード
            await this.preloadSounds();

        } catch (e) {
            console.warn('Audio initialization failed:', e);
        }
    }

    async preloadSounds() {
        // 効果音のプリロード（ファイルがあれば）
        const soundList = [
            { name: 'flower_bloom', path: 'assets/audio/flower_bloom.mp3' },
            { name: 'success', path: 'assets/audio/success.mp3' },
            { name: 'ink_draw', path: 'assets/audio/ink_draw.mp3' },
            { name: 'dog_happy', path: 'assets/audio/dog_happy.mp3' },
            { name: 'sparkle', path: 'assets/audio/sparkle.mp3' },
        ];

        for (const sound of soundList) {
            try {
                await this.loadSound(sound.name, sound.path);
            } catch (e) {
                // ファイルがなければスキップ（開発中は正常）
            }
        }
    }

    async loadSound(name, path) {
        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        this.sounds[name] = audioBuffer;
        return audioBuffer;
    }

    // BGM再生
    async playBGM(path, loop = true) {
        if (!this.isInitialized) await this.init();

        // 既存のBGMを停止
        this.stopBGM();

        try {
            const response = await fetch(path);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            this.bgm = this.audioContext.createBufferSource();
            this.bgm.buffer = audioBuffer;
            this.bgm.loop = loop;
            this.bgm.connect(this.bgmGainNode);
            this.bgm.start(0);

            console.log('🎵 Playing BGM:', path);
        } catch (e) {
            console.warn('BGM load failed:', path, e);
        }
    }

    stopBGM() {
        if (this.bgm) {
            try {
                this.bgm.stop();
            } catch (e) { }
            this.bgm = null;
        }
    }

    // 効果音再生
    playSFX(name, volume = 1.0) {
        if (!this.isInitialized || !this.sounds[name]) {
            // 音源がなければ代わりに合成音を鳴らす
            this.playSynthSound(name);
            return;
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = this.sounds[name];

        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = volume;

        source.connect(gainNode);
        gainNode.connect(this.sfxGainNode);
        source.start(0);
    }

    // 合成音（音源ファイルがない場合のフォールバック）
    playSynthSound(type) {
        if (!this.isInitialized) return;

        try {
            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();

            osc.connect(gain);
            gain.connect(this.sfxGainNode);

            const now = this.audioContext.currentTime;

            switch (type) {
                case 'flower_bloom':
                    // 優しいチャイム音
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(523.25, now);
                    osc.frequency.setValueAtTime(659.25, now + 0.1);
                    osc.frequency.setValueAtTime(783.99, now + 0.2);
                    gain.gain.setValueAtTime(0.3, now);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
                    osc.start(now);
                    osc.stop(now + 0.5);
                    break;

                case 'success':
                    // 成功のファンファーレ
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(392, now);
                    osc.frequency.setValueAtTime(523.25, now + 0.15);
                    osc.frequency.setValueAtTime(659.25, now + 0.3);
                    osc.frequency.setValueAtTime(783.99, now + 0.45);
                    gain.gain.setValueAtTime(0.25, now);
                    gain.gain.linearRampToValueAtTime(0.3, now + 0.3);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
                    osc.start(now);
                    osc.stop(now + 0.8);
                    break;

                case 'ink_draw':
                    // 柔らかい描画音
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(200 + Math.random() * 100, now);
                    gain.gain.setValueAtTime(0.1, now);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                    osc.start(now);
                    osc.stop(now + 0.1);
                    break;

                case 'sparkle':
                    // きらきら音
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(1000 + Math.random() * 500, now);
                    gain.gain.setValueAtTime(0.15, now);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
                    osc.start(now);
                    osc.stop(now + 0.2);
                    break;

                case 'retry':
                    // やさしい「もういちど」の音（責めない下降音）
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(440, now);
                    osc.frequency.linearRampToValueAtTime(330, now + 0.25);
                    gain.gain.setValueAtTime(0.12, now);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
                    osc.start(now);
                    osc.stop(now + 0.35);
                    break;

                case 'dog_happy':
                    // 犬の嬉しい声（合成）
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(300, now);
                    osc.frequency.linearRampToValueAtTime(500, now + 0.1);
                    osc.frequency.linearRampToValueAtTime(350, now + 0.2);
                    gain.gain.setValueAtTime(0.1, now);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
                    osc.start(now);
                    osc.stop(now + 0.25);
                    break;

                default:
                    // デフォルトのポン音
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(440, now);
                    gain.gain.setValueAtTime(0.2, now);
                    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
                    osc.start(now);
                    osc.stop(now + 0.2);
            }
        } catch (e) {
            console.warn('Synth sound error:', e);
        }
    }

    // BGMフェードイン
    fadeBGMIn(duration = 2) {
        if (!this.bgmGainNode) return;
        const now = this.audioContext.currentTime;
        this.bgmGainNode.gain.setValueAtTime(0, now);
        this.bgmGainNode.gain.linearRampToValueAtTime(this.bgmVolume, now + duration);
    }

    // BGMフェードアウト
    fadeBGMOut(duration = 2) {
        if (!this.bgmGainNode) return;
        const now = this.audioContext.currentTime;
        this.bgmGainNode.gain.linearRampToValueAtTime(0, now + duration);
    }

    // 音量設定
    setBGMVolume(volume) {
        this.bgmVolume = Math.max(0, Math.min(1, volume));
        if (this.bgmGainNode) {
            this.bgmGainNode.gain.value = this.isMuted ? 0 : this.bgmVolume;
        }
    }

    setSFXVolume(volume) {
        this.sfxVolume = Math.max(0, Math.min(1, volume));
        if (this.sfxGainNode) {
            this.sfxGainNode.gain.value = this.isMuted ? 0 : this.sfxVolume;
        }
    }

    // ミュート切り替え
    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.masterGain) {
            this.masterGain.gain.value = this.isMuted ? 0 : 1;
        }
        return this.isMuted;
    }
}

// AudioContext.GainNode の指数減衰ヘルパー
if (typeof GainNode !== 'undefined') {
    GainNode.prototype.exponentialDecayTo = function (value, endTime) {
        // exponentialRampToValueAtTime は 0 に直接行けないので小さい値を使う
        this.gain.exponentialRampToValueAtTime(Math.max(0.0001, value), endTime);
    };
}

// グローバルインスタンス
const audioManager = new AudioManager();
