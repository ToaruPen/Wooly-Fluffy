# UI リデザイン計画書: KIOSK / STAFF 画面

> 作成日: 2026-02-06
> 作成: SOS団 (古泉・長門・ハルヒ)
> ステータス: Draft（レビュー待ち）

---

## 0. 現状の課題サマリー

| カテゴリ | 問題 | 深刻度 |
|---------|------|--------|
| カラーパレット | アンバー/ベージュ単色で古臭い。子ども向けの楽しさがない | 高 |
| タイポグラフィ | Georgia/Times New Roman（セリフ体）は画面UIに不向き | 高 |
| インタラクション | hover/active/focus 状態が未定義。アニメーションゼロ | 高 |
| アクセシビリティ | フォーカス表示なし、ラベルのコントラスト比不足 | 高 |
| レイアウト | 余白が不規則、視覚的ヒエラルキー不明確 | 中 |
| レスポンシブ | ブレークポイント1つだけ（768px） | 中 |
| コンポーネント | ボタンサイズ不足、同意モーダルが誤操作を招く配置 | 中 |

---

## 1. デザインコンセプト

### テーマ: 「やわらかいガラスの教室」

学童の温かみ（子どもが安心できる場所）と、モダンなデジタル体験（洗練された操作感）を融合する。

- **KIOSK**: パステル × Glassmorphism で「楽しい・安心・キャラクターが主役」
- **STAFF**: ミニマル × カード型 で「一目で分かる・素早く操作できる」

### デザイン原則

1. **キャラクターファースト** — VRM アバターが画面の主役。UIはオーバーレイとして控えめに
2. **アクション明確** — 操作可能な要素は色・サイズ・動きで即座に判別可能
3. **安全第一** — 危険操作は物理的距離 + 確認ステップで誤操作を防止
4. **8px グリッド** — 全ての余白・サイズを 8px の倍数で統一

---

## 2. カラーパレット

### 2.1 KIOSK（子ども向け）

```
Background Gradient:
  #f0f4ff (薄い空色) → #e8f5e9 (薄いミントグリーン)
  もしくは Aurora 風: #dfe7fd → #e8f5e9 → #fef3c7

Surface (カード/バブル):
  rgba(255, 255, 255, 0.65)  ← Glassmorphism
  backdrop-filter: blur(12px)
  border: 1px solid rgba(255, 255, 255, 0.3)

Primary Accent:    #6366f1 (Indigo 500)
Secondary Accent:  #f472b6 (Pink 400)
Success:           #34d399 (Emerald 400)
Warning:           #fbbf24 (Amber 400)
Danger:            #f87171 (Red 400)

Text Primary:      #1e293b (Slate 800)
Text Secondary:    #64748b (Slate 500)
```

### 2.2 STAFF（職員向け）

```
Background:        #f8fafc (Slate 50)

Surface (カード):
  #ffffff
  border: 1px solid #e2e8f0
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08)

Primary Accent:    #3b82f6 (Blue 500)
Success/Approve:   #10b981 (Emerald 500)
Danger/Deny:       #ef4444 (Red 500)
Warning:           #f59e0b (Amber 500)

Text Primary:      #0f172a (Slate 900)
Text Secondary:    #64748b (Slate 500)

Status Colors:
  idle:             #94a3b8 (Slate 400)
  listening:        #3b82f6 (Blue 500) + pulse animation
  waiting_stt:      #8b5cf6 (Violet 500)
  waiting_chat:     #f59e0b (Amber 500) + spin animation
  asking_consent:   #f472b6 (Pink 400)
```

---

## 3. タイポグラフィ

### フォントスタック

```css
/* KIOSK — 子ども向け: 丸みのある親しみやすいフォント */
--font-display: "Nunito", "M PLUS Rounded 1c", system-ui, sans-serif;
--font-body: "Nunito", "M PLUS Rounded 1c", system-ui, sans-serif;

/* STAFF — 職員向け: 読みやすいモダンサンセリフ */
--font-display: "Inter", "Noto Sans JP", system-ui, sans-serif;
--font-body: "Inter", "Noto Sans JP", system-ui, sans-serif;
```

### フォントサイズスケール（8px グリッド準拠）

| トークン | サイズ | 行間 | 用途 |
|---------|--------|------|------|
| `--text-xs` | 12px | 16px | バッジ、キャプション |
| `--text-sm` | 14px | 20px | ラベル、サブテキスト |
| `--text-base` | 16px | 24px | 本文、ボタン |
| `--text-lg` | 18px | 28px | スピーチバブル |
| `--text-xl` | 20px | 28px | セクション見出し |
| `--text-2xl` | 24px | 32px | ページタイトル |
| `--text-3xl` | 32px | 40px | KIOSK大見出し |

### Google Fonts 読み込み

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700&family=M+PLUS+Rounded+1c:wght@400;500;700&family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
```

---

## 4. KIOSK 画面のリデザイン

### 4.1 全体レイアウト

```
┌─────────────────────────────────────────┐
│ [ステータスバッジ群]  (左上, 半透明)       │  ← overlay
│                                         │
│                                         │
│           ┌─────────────┐               │
│           │             │               │
│           │  VRM Avatar │               │  ← 画面の主役
│           │             │               │
│           └─────────────┘               │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ 🔴 録音中...                        │ │  ← Recording pill (pulse)
│ └─────────────────────────────────────┘ │
│                                         │
│ ╭─────────────────────────────────────╮ │
│ │  💬 「こんにちは！今日はいい天気...」 │ │  ← Speech bubble (glassmorphism)
│ ╰─────────────────────────────────────╯ │
└─────────────────────────────────────────┘
```

### 4.2 主な変更点

#### 背景
```css
/* Before */
background: radial-gradient(circle at top left, #fff7e2 0%, #f4e3bf 45%, #e9d2a7 100%);

/* After: Aurora gradient（柔らかい空色 → ミント） */
background: linear-gradient(135deg, #dfe7fd 0%, #e8f5e9 50%, #fef3c7 100%);
```

#### ステージ（VRM 表示領域）
```css
/* Before: 固定ベージュの枠線付きボックス */
border: 1px solid #d8c39a;
background: radial-gradient(...ベージュ系);
aspect-ratio: 16 / 9;

/* After: 枠線を除去してフルブリードに近い表示、背景は Three.js 側で淡い色に */
border: none;
border-radius: 24px;
overflow: hidden;
box-shadow: 0 8px 32px rgba(99, 102, 241, 0.1);
/* aspect-ratio はレスポンシブで可変にする（後述） */
```

Three.js 側の `scene.background` も `#efe7d8` → `#f0f4ff`（薄い空色）に変更。

#### ステータスバッジ
```css
/* After: Glassmorphism バッジ */
.kioskBadge {
  font-family: var(--font-body);
  font-size: var(--text-xs);   /* 12px */
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: var(--text-secondary);
  font-weight: 500;
  transition: opacity 0.2s ease;
}
```

#### 録音インジケーター
```css
/* After: パルスアニメーション付き */
.recordingPill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.9);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: 600;
  animation: pulse 1.5s ease-in-out infinite;
}

.recordingPill::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  animation: blink 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

#### スピーチバブル
```css
/* After: Glassmorphism + フェードインアニメーション */
.speechBubble {
  margin-top: auto;
  align-self: center;
  max-width: min(680px, calc(100% - 32px));
  pointer-events: none;
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 20px;
  padding: 16px 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
  animation: slideUp 0.3s ease-out;
}

.speechText {
  font-family: var(--font-body); /* Nunito + M PLUS Rounded 1c */
  font-size: var(--text-lg);     /* 18px */
  line-height: 1.6;
  color: var(--text-primary);
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

#### 同意モーダル（「覚えていい？」）
```css
/* After: 縦並びボタン + 大きなサイズ + アイコン */
.modalBackdrop {
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease-out;
}

.modal {
  width: min(440px, calc(100% - 32px));
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 24px;
  padding: 24px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.12);
  animation: scaleIn 0.25s ease-out;
}

.modalTitle {
  font-family: var(--font-display);
  font-size: var(--text-2xl);  /* 24px */
  font-weight: 700;
  color: var(--text-primary);
  text-align: center;
}

/* ボタンを縦並びに変更（誤操作防止） */
.modalActions {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
```

**TSX 側変更**: ボタンテキストにアイコンを追加
```tsx
<button className={styles.primaryButton}>
  ⭕ おぼえて！
</button>
<button className={styles.secondaryButton}>
  ❌ やめておく
</button>
```

### 4.3 レスポンシブ対応

```css
/* モバイル (デフォルト) */
.kioskStage {
  aspect-ratio: 3 / 4;
  border-radius: 24px;
}

/* タブレット縦 (768px) */
@media (min-width: 768px) {
  .kioskStage {
    aspect-ratio: 4 / 3;
  }
}

/* タブレット横 / デスクトップ (1024px) */
@media (min-width: 1024px) {
  .kioskStage {
    aspect-ratio: 16 / 9;
    max-height: 75vh;
  }
}
```

---

## 5. STAFF 画面のリデザイン

### 5.1 全体レイアウト

```
┌─────────────────────────────────────┐
│  STAFF  ──────────────  [🔒 Lock]  │  ← ヘッダー（ミニマル）
├─────────────────────────────────────┤
│                                     │
│  ┌──────┐ ┌──────┐ ┌──────┐        │
│  │ Mode │ │Phase │ │Pend. │        │  ← ステータスカード群
│  │ ROOM │ │ idle │ │  3   │        │
│  └──────┘ └──────┘ └──────┘        │
│                                     │
│  ╭─────────────────────────────╮    │
│  │                             │    │
│  │   Session Control Panel    │    │  ← Reset/Resume/Emergency操作
│  │                             │    │
│  ╰─────────────────────────────╯    │
│                                     │
│  [Reset Session]  [Resume]            │  ← セカンダリ操作
│                                     │
│  ╔═══════════════════════════════╗  │
│  ║ ⚠️  EMERGENCY STOP           ║  │  ← 緊急停止（分離配置）
│  ╚═══════════════════════════════╝  │
│                                     │
│  ── Pending (3) ─────── [Refresh] ─│
│                                     │
│  ┌─ 田中くん / likes / サッカー ──┐ │
│  │ 「サッカーが好きなんだって」    │ │  ← 承認カード
│  │ [✓ Confirm]    [✗ Deny]       │ │
│  └────────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

### 5.2 主な変更点

#### 全体背景
```css
/* Before */
background: radial-gradient(circle at top left, #fff7e2 0%, #f4e3bf 45%, #e9d2a7 100%);

/* After: クリーンなライトグレー */
background: #f8fafc;
```

#### ヘッダー
```css
/* After: ミニマルヘッダー */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 24px;
}

.header h1 {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}
```

注: 現在 header に表示されている `Stream: /api/v1/staff/stream` や `TTS: VOICEVOX / 四国めたん` の技術情報は開発者向けなので、本番UIからは非表示にする（`NODE_ENV === 'development'` の場合のみ表示）。

#### ステータスカード
```css
/* After: 個別カード + セマンティックカラー + ライブインジケーター */
.staffStatusGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.statusCard {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 16px;
  text-align: center;
}

.statusCardLabel {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.statusCardValue {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
}

/* Phase に応じた色付きドット */
.statusDot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}

.statusDot[data-phase="idle"] { background: #94a3b8; }
.statusDot[data-phase="listening"] {
  background: #3b82f6;
  animation: pulse 1.5s infinite;
}
.statusDot[data-phase="waiting_stt"] { background: #8b5cf6; }
.statusDot[data-phase="waiting_chat"] {
  background: #f59e0b;
  animation: pulse 1.5s infinite;
}
```

#### Push-to-Talk ボタン
```css
/* After: 大型円形ボタン + リップル効果 */
.pttButton {
  width: 100%;
  max-width: 280px;
  aspect-ratio: 1;
  margin: 0 auto;
  border-radius: 50%;
  border: 4px solid rgba(59, 130, 246, 0.2);
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #fff;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: 700;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  box-shadow: 0 8px 24px rgba(59, 130, 246, 0.3);
  transition: all 0.15s ease;
}

.pttButton::before {
  content: '🎙️';
  font-size: 32px;
}

.pttButtonActive {
  /* 押下中 */
  composes: pttButton;
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  transform: scale(0.95);
  box-shadow:
    0 4px 12px rgba(59, 130, 246, 0.4),
    inset 0 2px 8px rgba(0, 0, 0, 0.15);
  border-color: rgba(59, 130, 246, 0.5);
}

/* 押下中のリップルリング */
.pttButtonActive::after {
  content: '';
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  border: 2px solid rgba(59, 130, 246, 0.4);
  animation: ripple 1s ease-out infinite;
}

@keyframes ripple {
  0% { transform: scale(1); opacity: 1; }
  100% { transform: scale(1.3); opacity: 0; }
}
```

デスクトップでは最大 280px に制限して無駄な横幅を防止。
モバイルでは `max-width: 200px` でコンパクトに。

#### 緊急停止ボタン（分離配置）
```css
/* After: 他のボタンから物理的に離して配置 + 明確な危険表示 */
.emergencySection {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #e2e8f0;
}

.dangerButton {
  width: 100%;
  min-height: 56px;
  border-radius: 12px;
  background: linear-gradient(180deg, #dc2626 0%, #b91c1c 100%);
  border: 2px solid #991b1b;
  color: #fff;
  font-size: var(--text-base);
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3);
  transition: all 0.15s ease;
}

.dangerButton:active {
  transform: translateY(2px);
  box-shadow: 0 2px 6px rgba(220, 38, 38, 0.3);
}
```

#### Pending 承認カード
```css
/* After: 左ボーダー色付き + hover エフェクト */
.pendingCard {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-left: 4px solid #3b82f6;
  border-radius: 12px;
  padding: 16px;
  transition: all 0.2s ease;
}

.pendingCard:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.pendingTitle {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
}

.pendingMeta {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-top: 2px;
}

.pendingQuote {
  margin-top: 8px;
  padding: 12px;
  border-radius: 8px;
  background: #f1f5f9;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-style: italic;
  border-left: 3px solid #cbd5e1;
}

.pendingActions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}

/* Confirm = 緑系 */
.approveButton {
  flex: 1;
  min-height: 44px;
  border-radius: 8px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: #fff;
  font-weight: 600;
  border: none;
  transition: all 0.15s ease;
}

.approveButton:hover {
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
}

/* Deny = 赤アウトライン */
.denyButton {
  flex: 1;
  min-height: 44px;
  border-radius: 8px;
  background: #fff;
  color: #ef4444;
  border: 2px solid #ef4444;
  font-weight: 600;
  transition: all 0.15s ease;
}

.denyButton:hover {
  background: #fef2f2;
}
```

#### Pending リストのスクロール
```css
.pendingList {
  max-height: 50vh;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #cbd5e1 transparent;
}
```

### 5.3 ログイン画面
```css
/* After: 中央寄せカード + クリーンなフォーム */
.loginCard {
  max-width: 400px;
  margin: 80px auto 0;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 24px;
  padding: 32px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  text-align: center;
}

.loginCard h2 {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: 700;
  margin-bottom: 24px;
}

.textInput {
  width: 100%;
  min-height: 48px;
  border-radius: 12px;
  border: 2px solid #e2e8f0;
  padding: 12px 16px;
  font-size: var(--text-base);
  transition: border-color 0.2s ease;
}

.textInput:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
```

---

## 6. 共通の改善（KIOSK / STAFF 両方）

### 6.1 ボタンのインタラクション状態

```css
/* 全ボタン共通のトランジション */
.primaryButton,
.secondaryButton,
.dangerButton {
  cursor: pointer;
  transition: all 0.15s ease;
}

/* フォーカス表示（キーボードナビゲーション対応） */
button:focus-visible,
input:focus-visible {
  outline: 3px solid #6366f1;
  outline-offset: 2px;
}

/* ホバー効果 */
.primaryButton:hover {
  filter: brightness(1.08);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.secondaryButton:hover {
  background: #f1f5f9;
}

/* アクティブ効果 */
.primaryButton:active {
  transform: translateY(1px);
  filter: brightness(0.95);
}
```

### 6.2 エラー表示の改善

```css
.errorBanner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  font-size: var(--text-sm);
  font-weight: 500;
  animation: slideDown 0.2s ease-out;
}

.errorBanner::before {
  content: '⚠';
  font-size: 16px;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

KIOSK の技術エラー（"SSE error", "Audio error"）は子ども向けに:
```tsx
// Before: "SSE error: Connection lost"
// After:  "つながらないよ... もう一回やってみてね"
```

### 6.3 レスポンシブブレークポイント

```css
/* モバイル: デフォルト (< 640px) */
/* タブレット縦: 640px */
/* タブレット横: 768px */
/* デスクトップ: 1024px */
/* ワイドスクリーン: 1280px */

@media (min-width: 640px) { /* タブレット縦 */ }
@media (min-width: 768px) { /* タブレット横 */ }
@media (min-width: 1024px) { /* デスクトップ */ }
@media (min-width: 1280px) { /* ワイドスクリーン */ }
```

### 6.4 アクセシビリティ

- 全てのテキストで WCAG AA コントラスト比 4.5:1 以上を確保
- `prefers-reduced-motion` メディアクエリでアニメーション無効化に対応
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```
- 全ボタンに `focus-visible` スタイルを定義
- 緊急停止ボタンに色だけでなくアイコン (`⚠️`) とテキストで危険度を表現

---

## 7. 実装ロードマップ

### Phase 1: 基盤整備（影響大・工数小）

| # | 変更内容 | 対象ファイル | 工数目安 |
|---|---------|-------------|---------|
| 1-1 | CSS変数（カラー/フォント/サイズ）の定義 | styles.module.css 先頭 | S |
| 1-2 | Google Fonts 読み込み追加 | index.html | S |
| 1-3 | ボタンの hover/active/focus-visible 状態追加 | styles.module.css | S |
| 1-4 | prefers-reduced-motion 対応 | styles.module.css | S |

### Phase 2: KIOSK 画面の刷新

| # | 変更内容 | 対象ファイル | 工数目安 |
|---|---------|-------------|---------|
| 2-1 | 背景グラデーション変更 | styles.module.css (.page) | S |
| 2-2 | スピーチバブルの Glassmorphism 化 + アニメーション | styles.module.css | S |
| 2-3 | 録音インジケーターのパルスアニメーション | styles.module.css | S |
| 2-4 | バッジの Glassmorphism 化 | styles.module.css | S |
| 2-5 | 同意モーダルのリデザイン（縦並び + アイコン） | kiosk-page.tsx, styles.module.css | M |
| 2-6 | VRM ステージの背景色変更 | vrm-avatar.tsx (scene.background) | S |
| 2-7 | エラーメッセージの日本語化・子ども向け表現 | kiosk-page.tsx | M |
| 2-8 | レスポンシブ対応（aspect-ratio 可変化） | styles.module.css | S |

### Phase 3: STAFF 画面の刷新

| # | 変更内容 | 対象ファイル | 工数目安 |
|---|---------|-------------|---------|
| 3-1 | 背景/ヘッダーのミニマル化 | styles.module.css, staff-page.tsx | S |
| 3-2 | ステータスカードの個別化 + セマンティックカラー | styles.module.css, staff-page.tsx | M |
| 3-3 | PTT ボタンの大型円形化 | styles.module.css | M |
| 3-4 | 緊急停止ボタンの分離配置 + 強調 | styles.module.css, staff-page.tsx | S |
| 3-5 | Pending カードのリデザイン（左ボーダー + hover） | styles.module.css | M |
| 3-6 | Pending リストのスクロール対応 | styles.module.css | S |
| 3-7 | ログイン画面の中央寄せカード化 | styles.module.css, staff-page.tsx | S |
| 3-8 | Reset Session / Resume ボタンの整理 | styles.module.css | S |

### Phase 4: 仕上げ

| # | 変更内容 | 対象ファイル | 工数目安 |
|---|---------|-------------|---------|
| 4-1 | 全ブレークポイントの追加と検証 | styles.module.css | M |
| 4-2 | コントラスト比の検証と修正 | styles.module.css | S |
| 4-3 | 既存テストの更新（クラス名変更等） | *.test.tsx | M |
| 4-4 | E2E テストの動作確認 | e2e/ | S |

工数目安: S = 30分以内, M = 1-2時間

---

## 8. 技術的な注意事項

### 制約
- **CSS Modules 維持**: 既存の `styles.module.css` 構造を維持（ファイル分割は任意）
- **既存テスト**: `data-testid` や `aria-label` を変更する場合はテストの更新が必要
- **backdrop-filter**: Safari では `-webkit-backdrop-filter` プレフィックスが必要
- **フォント読み込み**: Google Fonts の追加により初回表示時に FOUT (Flash of Unstyled Text) が発生する可能性 → `font-display: swap` で対応

### やらないこと（スコープ外）
- ダークモード対応（将来の拡張として記録）
- コンポーネントライブラリ（Shadcn/ui 等）の導入
- Tailwind CSS の導入
- ロジック・API の変更

---

## 変更履歴

- 2026-02-06: v1.0 初版作成（SOS団による調査・策定）
