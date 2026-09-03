# v0.1.7

## 条件有効化方針
- レイヤー単位で停止していた大きさPOP・表情POPを含め、実装可能な挙動条件を原則すべて再有効化。
- `unimplemented` 条件は未実装のため引き続き無効。
- POCHO LABで直前に個別OFFしていた13条件のみ `disabled` として本家でも無効化。

### 個別OFF 13条件
- expression-36
- color-50
- color-56
- color-18
- expression-19
- size-3
- color-65
- size-10
- size-9
- expression-22
- expression-16
- expression-27
- color-25

## 速度判定
- LAB v0.4と同じ厳密な速度語判定へ更新。
- 低速接触/高速衝突/接触速度は相対速度で判定。
- 自分/相手/両方と明示された条件のみ各Bodyの絶対速度を使用。
- 履歴系の速度句が汎用速度判定に誤って拾われないよう修正。
