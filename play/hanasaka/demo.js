/* ========================================
   ポートフォリオ掲載用デモ制限
   あ行（ステージ1）だけ遊べるようにする。
   ゲーム本体のコードは変更せず、このファイルだけで制御する。
   ======================================== */
(function () {
    // BGMは鳴らさない（効果音はそのまま）
    // game.js の DOMContentLoaded より先に無効化する必要があるため、読み込み時点で即上書き
    if (typeof audioManager !== 'undefined') {
        audioManager.playBGM = async function () { };
        if (audioManager.stopBGM) audioManager.stopBGM();
    }

    // ステージ2以降は解放しない
    ProgressStore.unlockStage = function () { };

    // ステージ選択画面は「あ行」だけ表示
    const origShowStageSelect = GameEngine.prototype.showStageSelect;
    GameEngine.prototype.showStageSelect = function () {
        origShowStageSelect.call(this);
        const buttons = this.stageGrid.querySelectorAll('.stage-button');
        buttons.forEach((btn, i) => { if (i > 0) btn.remove(); });
        if (!document.getElementById('demo-note')) {
            const note = document.createElement('p');
            note.id = 'demo-note';
            note.textContent = 'たいけんばんは「あぎょう」だけ あそべるよ';
            note.style.cssText = 'margin-top:14px;font-size:14px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.4);text-align:center;';
            this.stageGrid.parentNode.appendChild(note);
        }
    };

    // あ行クリア後は次のステージへ進まず、お祝い演出→ステージ選択へ戻る
    GameEngine.prototype.transitionToNextStage = function () {
        this.showGameComplete();
    };
})();
