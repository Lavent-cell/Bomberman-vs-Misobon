# Bomberman vs Misobon / ボンバーマン vs みそボン

ブラウザで遊べる、ボンバーマンとみそボンの対戦ゲームです。日本語の説明を先に、英語の説明を後に掲載しています。

A browser-based multiplayer game featuring Bomberman and Misobon. Japanese instructions come first, followed by English.

## 日本語

### ゲームについて
- ボンバーマンとみそボンに分かれて対戦するブラウザゲームです。
- WebSocketを使用したネット対戦に対応しています。空いている枠はNPCが担当します。
- 対戦ルールや操作方法はゲーム画面の「?」から確認できます（マウスを合わせるか、キーボードでフォーカスしてください）。

### 基本操作
- **ボンバーマン**：WASD／矢印キーで移動、Space短押しで爆弾、長押しでチャージショット。
- **みそボン**：Spaceでジャンプ、F／B短押しでレーザー、長押しでチャージレーザー。
- 操作の詳細はゲーム内のヘルプを参照してください。

### ローカル起動（開発・確認用）
Node.js 20以降が必要です。

```bash
npm install
npm start
```

起動後、ブラウザで `http://localhost:8080/?room=main` を開いてください。

テスト：`npm test`

### 使用素材・クレジット
- **BGM**：*16-bit - Battle Theme I* — [OpenGameArt](https://opengameart.org/content/16-bit-battle-theme-i)（CC0）
- **効果音**：*explosion-9* — [Pixabay](https://pixabay.com/sound-effects/film-special-effects-explosion-9-340460/)
- **効果音**：*boss激光炮射击* — [Pixabay](https://pixabay.com/sound-effects/film-special-effects-boss%E6%BF%80%E5%85%89%E7%82%AE%E5%B0%84%E5%87%BB-572015/)

素材の権利は各配布元のライセンスに従います。素材が含まれていることは、素材自体の権利を第三者に譲渡するものではありません。

---

## English

### About the game
- A browser-based battle game featuring Bomberman and Misobon.
- Supports online play via WebSocket; unoccupied player slots are controlled by NPCs.
- See the **?** help panel in the game for rules and controls (hover or keyboard focus).

### Basic controls
- **Bomberman**: Move with WASD / arrow keys. Tap Space to place a bomb; hold Space for a charged shot.
- **Misobon**: Space to jump. Tap F / B to fire a laser; hold for a charged laser.
- Refer to the in-game help for details.

### Run locally
Requires Node.js 20 or later.

```bash
npm install
npm start
```

Open `http://localhost:8080/?room=main` in your browser.

Tests: `npm test`

### Third-party assets and credits
- **Music**: *16-bit - Battle Theme I* — [OpenGameArt](https://opengameart.org/content/16-bit-battle-theme-i) (CC0)
- **Sound effect**: *explosion-9* — [Pixabay](https://pixabay.com/sound-effects/film-special-effects-explosion-9-340460/)
- **Sound effect**: *boss激光炮射击* — [Pixabay](https://pixabay.com/sound-effects/film-special-effects-boss%E6%BF%80%E5%85%89%E7%82%AE%E5%B0%84%E5%87%BB-572015/)

Third-party assets remain subject to their respective licenses. Inclusion in this project does not transfer ownership of those assets.
