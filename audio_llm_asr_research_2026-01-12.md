# 音声認識に強いLLM / ローカルLLM（Mac mini M4）調査まとめ（2026-01-12）

## 成果物
- **(1) 音声認識（Speech-to-Text / ASR）が強く、利用料を抑えやすいクラウドLLM/音声API候補の比較**
- **(2) Mac mini M4（16GB RAM / 256GB）で運用しやすいローカル音声認識（+ ローカルLLM後処理）候補の比較と推奨構成**

---

## 0. 状況整理（要点）
- 実務的には「**音声→テキスト（ASR/STT）**」と「**テキスト処理（要約・抽出・QAなどのLLM）**」を分離すると、**精度・コスト・運用性が最適化**しやすい。
- 「LLMで音声認識」と言っても、以下の2タイプがある。
  - **A. ASR専用（Speech-to-Text）モデル/API**（文字起こしに強い）
  - **B. 音声入力の“マルチモーダルLLM”**（会話/推論もできるが、文字起こし専用より重い/高価になりがち）

---

## 1. 方針設計（推奨の考え方）
- **大量の文字起こし × 低コスト**が主目的なら：  
  **クラウドASRは分課金が明確なもの**（OpenAIのtranscribe系）を優先。
- **ローカル運用**は：  
  まず **Whisper系（whisper.cpp / MLX）**で固め、必要なら日本語特化モデルを追加検証。
- **話者分離（誰が話したか）が必要**なら：  
  クラウド（gpt-4o-transcribe-diarize 等）または別途 diarization を組み合わせる。

---

## 2. 具体化（成果物）

### 2.1 (1) クラウド：音声認識が強く、利用料を抑えやすい候補

#### 2.1.1 OpenAI Audio API（Speech-to-Text）
**特徴**
- Speech-to-text（transcriptions / translations）を提供。
- **アップロード上限：25MB**。対応形式：mp3, mp4, mpeg, mpga, m4a, wav, webm。  
- モデル別に出力フォーマットが異なる（whisper-1は字幕形式も対応、4o系はjson/text中心、diarizeはdiarized_json対応）。

**価格（目安）**
- `gpt-4o-mini-transcribe`：**$0.003 / minute（推定）**
- `gpt-4o-transcribe`：**$0.006 / minute（推定）**
- `gpt-4o-transcribe-diarize`：**$0.006 / minute（推定）**（話者分離込み）
- `whisper-1`：モデルページ上では「Transcription cost $0.006」と表示（単位表記はページ上で明示されないが、一般に$0.006/分として扱われることが多い）

> 注：OpenAIの価格は変更される可能性があるため、運用前に公式 Pricing ページで再確認する。

**話者分離（diarization）の注意**
- `gpt-4o-transcribe-diarize` は **Transcription API 専用**で、話者に紐づくセグメントを返す。
- 音声が長い場合（>30秒）、**`chunking_strategy` が必須**。  
  また、プロンプト/ログ確率などの一部機能は非対応。

**費用のラフ見積もり（例）**
- 50時間/月（=3,000分）
  - mini-transcribe：$0.003×3,000 = **$9/月**
  - transcribe：$0.006×3,000 = **$18/月**
- 200時間/月（=12,000分）
  - mini-transcribe：**$36/月**
  - transcribe：**$72/月**

#### 2.1.2 Google Gemini API（音声入力はトークン課金）
- Geminiは **audio input を「1M tokensあたり」**で課金する形が中心。  
- したがって **「1分いくら」換算が環境・音声内容で変動**しやすい。  
- 既存でGeminiに寄せている場合や、**ネイティブ音声（Live API）**を重視する場合は候補。

---

### 2.2 (2) ローカル：Mac mini M4（16GB/256GB）で音声認識が強い候補

#### 2.2.1 Whisper系（本命）
##### a) whisper.cpp（C/C++実装、Apple Silicon最適化）
- Apple Siliconでは Encoder 推論を **Core ML 経由でANE（Neural Engine）**に載せられ、**CPU-onlyより >3倍速**になり得る。  
- 量子化や軽量運用もしやすい（モデルサイズや精度のトレードオフが取りやすい）。

##### b) モデル選択の目安（Whisper）
- OpenAI公式リポジトリ記載の目安（VRAM相当・相対速度）：
  - `large`：~10GB / 相対 1x
  - `turbo`：~6GB / 相対 ~8x（large-v3最適化、精度劣化は小さめという説明）
- Mac mini M4（16GB）では、まず **turbo** で速度を確保し、必要に応じて上位モデルへ。

##### c) Distil-Whisper（速度×精度の改善）
- distil-large-v3 は、暫定ベンチで **Mac M1で large-v3 より >5x高速**、かつ **WER差 0.8%以内**（長尺音声）という記載がある。
- 「速度を上げたいが精度は落としたくない」場合の候補。

##### d) faster-whisper（CTranslate2）
- openai/whisper 実装に比べて **最大4倍高速**、かつ **低メモリ**を謳う。  
- INT8量子化でさらに効率化可能。

#### 2.2.2 MLX（Apple Silicon向け）でWhisperを回す選択肢
- `mlx-whisper`（Pythonパッケージ）等で、Apple Silicon最適化のWhisper推論を回す構成がある。
- 実運用では **速度/導入容易性**の観点で、whisper.cppと比較して選定。

#### 2.2.3 GUIで手早く（ローカル）
- **Aiko（macOS/iOS）**：Whisperをローカル実行し、「デバイス外に出ない」ことを明記。
  - 精度寄り（速度より精度優先）
  - 録音しながらのライブ文字起こしは非対応
  - 話者検出（speaker detection）は現時点で非対応

#### 2.2.4 日本語特化の代替：NVIDIA Parakeet（ASR）
- `nvidia/parakeet-tdt_ctc-0.6b-ja`：日本語音声を **句読点付き**で書き起こす ASR。
- NeMo（PyTorch周辺）前提で、Whisper系より導入・運用が重めになりがち（環境が整っているなら有力候補）。

---

## 3. ローカル「音声対応LLM」（ASRなしで会話もするタイプ）について
- 例：**Qwen2-Audio** は「voice chat（ASRなしで音声指示）」と「audio analysis」を掲げ、**8+言語（日本語含む）**に対応するという説明がある。
- ただし、Mac mini M4（16GB）での推論は
  - モデルサイズが大きい
  - 実装・推論基盤（PyTorch/Transformers等）依存が重い
  - 文字起こし“専用”としてはWhisper系が安定しやすい  
  ため、**「文字起こし用途」はまずWhisper系を優先**するのが現実的。

---

## 4. 推奨構成（使い分け）

### 4.1 クラウド（低コスト優先）
1. 文字起こし：`gpt-4o-mini-transcribe`（$0.003/分）  
2. （必要なら）話者分離：`gpt-4o-transcribe-diarize`（$0.006/分）  
3. 後処理（要約/議事録/ToDo抽出）：テキストLLM（クラウドorローカル）

### 4.2 ローカル（Mac mini M4）
1. 文字起こし：`whisper.cpp` + CoreML（まずは `turbo`）  
2. 精度が足りない場合：
   - `large` / distil-large-v3 を検証  
3. 速度が足りない場合：
   - faster-whisper / MLX系を検証  
4. GUIで済ませたい場合：
   - Aiko（制約：ライブ文字起こし/話者分離なし）

---

## 5. リスク・注意点（失敗パターン）
- **クラウド**
  - 25MB制限により、長尺音声は分割が必要。
  - diarizeモデルは `chunking_strategy` 等の追加パラメータ要件があり、実装が少し複雑。
- **ローカル**
  - 大きいモデルほど速度低下・メモリ圧迫が起きやすい。
  - ノイズ/重なり発話/固有名詞は誤認識しやすいので、サンプル音声での事前評価が必須。

---

## 6. 次アクション（最短ルート）
1. 代表音声（10〜30分）で **OpenAI mini-transcribe** と **ローカルWhisper（turbo）**を比較。
2. 「話者分離が必要か」を確定し、必要なら diarize を併用。
3. ローカルで精度不足なら distil-large-v3 / large を追加検証。
4. 運用要件（リアルタイム性、オフライン必須、保存形式、字幕出力など）を決めて構成を確定。

---

## 7. 参照（公式中心 / 2026-01-12アクセス）

### OpenAI
```text
https://platform.openai.com/docs/pricing
https://platform.openai.com/docs/guides/speech-to-text
https://platform.openai.com/docs/models/gpt-4o-transcribe-diarize
https://platform.openai.com/docs/models/whisper-1
https://github.com/ggml-org/whisper.cpp
https://github.com/openai/whisper
https://github.com/SYSTRAN/faster-whisper
https://huggingface.co/distil-whisper/distil-large-v3
```

### Google
```text
https://ai.google.dev/gemini-api/docs/pricing
```

### ローカルGUI
```text
https://apps.apple.com/us/app/aiko/id1672085276
```

### 日本語ASR（NVIDIA）
```text
https://huggingface.co/nvidia/parakeet-tdt_ctc-0.6b-ja
```

### 音声LLM（参考）
```text
https://qwenlm.github.io/blog/qwen2-audio/
https://huggingface.co/Qwen/Qwen2-Audio-7B
```
