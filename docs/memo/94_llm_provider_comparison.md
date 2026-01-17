# LLM Provider 比較（Google / OpenAI / DeepSeek）

> このファイルはToDo/探索メモ（SoT外）。決定事項は `.specs/06_tech_stack_plan.md` を正とし、必要なら `.specs/` へ反映する。  
> 料金/規約は変動し得るため、運用前に一次情報URLで再確認する（本メモは法務判断ではない）。

更新: 2026-01-17

## 0) 目的（このメモで決めたいこと）

学童向けの「マスコットLLM」で、外側/内側LLMをクラウド優先で採用する際に、

- **規約上使えるか**（未成年/子ども向けアプリの可否）
- **運用コストを抑えつつ低遅延を出せるか**
- **安全に“壊れない”制御（JSON/検証/フォールバック）が組めるか**

を、Google / OpenAI / DeepSeek の一次情報とチェックリストで比較する。

## 1) 前提（このプロジェクト固有）

- 端末: 常設の単機（Apple Silicon）
- 体験: 子どもが相手。返答の自然さ/低遅延が重要
- 入力UX: PTTはSTAFF側（hold-to-talk）で操作し、KIOSK側は子どもの入力で収録/送信を開始しない
- データ方針: 音声/映像/会話全文を保存しない（SoT準拠）
- アーキテクチャ: Orchestrator（決定的コード）が状態機械と検証を担当。LLM出力は**スキーマ固定JSON**で受ける
  - 外側LLM（会話）は `text + affect(enum)` 程度の最小構造に留め、壊れたら `neutral` にフォールバック
  - 内側LLM（抽出/分類）はバッチ化や遅延許容（会話ループを止めない）

## 2) 判断用チェックリスト（MVP）

### 2.1 規約/契約（最優先・ブロッカー判定）

- [ ] **未成年（特に18歳未満、13歳未満）が会話の主対象になる用途が許可されるか**（子どもが直接操作しなくても該当し得る）
- [ ] 「子ども向けアプリ」や「未成年に向けたチャットボット」を明示的に禁止していないか
- [ ] 未成年が使う場合の要件（保護者同意、年齢制限、年齢確認、告知、停止手段）
- [ ] 学童/学校など教育文脈での追加条件（別プロダクト扱い、例外契約の有無）

### 2.2 データ/プライバシー（実装境界に直結）

- [ ] 入出力が**モデル学習に利用されない**設定/契約があるか（既定/オプトアウト/有償）
- [ ] ログ保持（期間/内容/削除手段）が明記されているか
- [ ] データ所在地/越境（例: サーバ所在地、法域）を許容できるか
- [ ] 子どもの個人情報（音声/テキストを含む）に関する取り扱いを満たせるか（保護者同意、目的限定、最小化）

### 2.3 モデル挙動の安全（実測でスコア化する）

最低限、**日本語**で以下を評価する（拒否/言い換え/誘導の質も含む）。

- [ ] 自傷/希死念慮
- [ ] 性（未成年/児童性的コンテンツ、グルーミング誘導）
- [ ] 暴力/違法行為/危険行為
- [ ] 個人情報の聞き出し（住所/学校/連絡先など）
- [ ] いじめ/差別/ハラスメント
- [ ] 「先生には内緒」などの典型脱獄でポリシーが崩れない
- [ ] 過剰拒否で日常会話が崩れない

### 2.4 システム統制（“失敗しても無害”にする）

- [ ] JSONスキーマ（またはツール呼び出し）で構造化出力を強制できる
- [ ] Orchestrator側で `parse → validate → allowlist → fallback` ができる
- [ ] 入力/出力の安全フィルタ（モデレーション/ルール）を前後段に置ける
- [ ] タイムアウト/キャンセル/リトライ/フォールバック（強いモデルへのエスカレーション含む）がある

## 3) プロバイダ比較（2026-01-17時点 / 要再確認）

結論だけ先に：

- **Google（Gemini API / Vertex AI）**: 規約上「未成年向け/未成年がアクセスし得る」用途がブロッカーになり得る（PTTを職員側に寄せても解消しない可能性）
- **DeepSeek**: 規約上「18歳未満に特にアピールするチャットボット」等を禁じる趣旨に読め、学童向けはブロッカーになり得る（PTTを職員側に寄せても解消しない可能性）
- **OpenAI**: 未成年は保護者同意が前提。契約形態（Services Agreement等）と運用設計で成立する可能性はあるが、COPPA等を含め要確認

### 3.1 Google（Gemini API / Vertex AI）

**コスト/速度の選択肢**

- `従量`: Vertex AIのGenerative AI pricing（モデルごとに入出力課金）
- `固定費寄り`: Vertex AI の **Provisioned Throughput（GSUコミット）**（週/1ヶ月/3ヶ月/1年など）

**規約（ブロッカー候補）**

- Gemini API Additional Terms では、利用年齢が **18歳以上**、かつ「18歳未満に向けた利用ではない」旨の記載がある（要確認）。  
  - https://ai.google.dev/gemini-api/terms
- Google Cloud の Service Specific Terms（Generative AI）では、**18歳未満がアクセスし得るアプリでの利用を禁じる**趣旨の条項がある（要確認）。  
  - https://cloud.google.com/terms/service-terms

**所感（このプロジェクトへの適合）**

- 技術的には魅力（高速/低コスト/スループットコミット）でも、学童向け（子どもが会話の主対象）だと**契約/規約が最初の壁**になりやすい。
- もしGeminiを使うなら、教育向けの別プロダクト/別契約の有無を含めて先に確認した方が安全。

### 3.2 OpenAI

**コスト/速度の選択肢**

- `従量`: API pricing（モデル別）
  - https://openai.com/api/pricing/
- `固定費寄り`: **Scale Tier（TPMコミット）** / **Reserved Capacity（予約インスタンス）**
  - https://openai.com/api-scale-tier/
  - https://openai.com/reserved-capacity/
- `従量だがコスト削減`: Prompt Caching（入力の静的prefixを効かせる）
  - https://platform.openai.com/docs/guides/prompt-caching

**規約/データ**

- Terms of Use（年齢/保護者同意など）
  - https://openai.com/policies/terms-of-use/
- OpenAI Services Agreement（Customer Contentの取扱い、未成年利用の同意要件など。契約形態によって適用が変わる）
  - https://openai.com/policies/services-agreement
- （参考）Business Terms（過去版/アーカイブ）
  - https://openai.com/policies/business-terms
- Usage Policies（安全上の禁止事項）
  - https://openai.com/policies/usage-policies/

**技術（“壊れない”実装のしやすさ）**

- Structured Outputs（JSON Schema）で `text` と `affect(enum)` のような最小構造を固定しやすい
  - https://platform.openai.com/docs/guides/structured-outputs

**所感（このプロジェクトへの適合）**

- 低遅延は「モデル選定＋Prompt Caching＋短い出力＋フォールバック」で調整しやすい。
- 未成年が主利用者になる設計は、保護者同意/告知/運用（スタッフの監督、停止手段、データ最小化）を含めた全体設計で成立させる必要がある。

### 3.3 DeepSeek（DeepSeek Open Platform API）

**コスト**

- 入力（cache miss）/入力（cache hit）/出力で単価が分かれている（価格は改定され得る）
  - https://api-docs.deepseek.com/quick_start/pricing/
- KV cache の挙動（prefix一致で cache hit）
  - https://api-docs.deepseek.com/guides/kv_cache

**規約/データ（ブロッカー候補）**

- Terms of Use では「18歳未満は法定後見人の同意が必要」と読める記載がある（要確認）。
  - https://www.deepseek.com/terms_of_use
- Terms of Use に「18歳未満へのアピールを目的としたチャットボット」等を禁止する趣旨の記載があり、学童向けにそのまま適用すると**不適合の可能性**がある（要確認）。  
  - https://www.deepseek.com/terms_of_use
- DeepSeek Privacy Policy では、サーバ所在地（PRC）や保持、モデル改善のための利用等が記載されている（要確認）。  
  - https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html
- Open Platform Terms（開発者向け）
  - https://cdn.deepseek.com/policies/deepseek-open-platform-terms-of-service.html

**技術**

- OpenAI互換のAPI形状で、既存のProvider抽象に載せやすい（ただし安全/規約が先）

**所感（このプロジェクトへの適合）**

- 単価面の魅力は大きい一方で、**未成年向けの禁止条項**と、**データ/法域**が主要リスクになり得る。

## 4) 次にやると良いこと（短期）

1) **規約ブロッカーの解消方針を先に決める**  
   - 「子どもが直接会話する」前提を維持するなら、利用規約上OKな提供形態/契約が必要  
   - もしNGなら、(a) 外側LLMをローカルに寄せる、(b) スタッフ介在（大人が利用者）に寄せる、などの設計変更が必要
2) **日本語安全テスト（短い台本）を固定**し、候補を同条件で実測（schema準拠率、P95レイテンシ、危険追従率）
3) Orchestratorの実装では、LLM出力は常に `parse → validate → allowlist → fallback`（affectは任意）を必須にする
