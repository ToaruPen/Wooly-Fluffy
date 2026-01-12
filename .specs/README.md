# .specs/（SoT）

このディレクトリは、学童向け「マスコットLLM」プロジェクトの Source of Truth（SoT）です。  
実装・設計の判断は原則ここを正とし、仕様が動いたらこの中を更新します。

## 運用ルール

- 決定事項は「決定」と明示する
- 未確定は「未確定」として残す（後で差し替えやすくする）
- 安全・データ最小化・現場運用の破綻しにくさを優先する

## ファイル一覧

- `01_principles.md`: 価値観・優先順位・ガードレール（何を守るか）
- `02_usecases_and_mvp.md`: ユースケース分解と段階的MVP（A→B0→B→C）
- `03_modes_identification_and_consent.md`: モード設計、識別（音声名乗り→将来NFC）、同意（職員Confirm）フロー
- `04_data_policy_and_memory_model.md`: データ最小化方針、保存対象、簡易データモデル案
- `05_architecture_approach.md`: 同期会話と非同期処理を分けた全体アーキテクチャ案（Provider境界/失敗時フォールバック含む）
- `06_tech_stack_options.md`: 技術スタック候補メモ（境界と候補、探索項目）
- `90_open_questions.md`: 未確定事項（次の議論の入口）

## 参考（SoT外）

- `gakudo_plush_llm_plan_context.md`（repo root）: これまでの議論まとめ（広めの検討範囲。SoTではない）
- `.specs.zip`（repo root）: 外部調査/共有用のスナップショット（最新性は `.specs/` を優先）
- `docs/memo/`（repo root）: 引き継ぎ向けの要点メモ（最新性は `.specs/` を優先）
