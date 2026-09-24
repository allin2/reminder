# NOT_PERFORMED — run `20260921T1425-g01g02-import-reliability`

| 项 | 状态 | 说明 |
| --- | --- | --- |
| G01/G02 修复的独立复验 | NOT_PERFORMED | 本 run 是实施方自测；等复验方独立确认 |
| 修复后真实 Chrome 导入链重放 | NOT_PERFORMED | 复验方 8/8 导入探针是修复前基线；unit 层已覆盖三态 save，但真浏览器重放未做 |
| Android WebView 导出落地（E1–E4） | NOT_PERFORMED | 产品决策待裁决，代码未动（缺陷逐字保留） |
| Android SAF 实机验收（saved/cancelled/failed/unavailable/stale） | NOT_PERFORMED | 需真机 |
| 备份 schema / app 身份校验 | NOT_PERFORMED | 导入仍只验 `items` 数组形状 |
| notes/projects/settings 逐项外部输入形状校验 | NOT_PERFORMED | 同上 |
| P2 剩余（诊断/引导/内容视图/表单 + 拆 `bind()`） | NOT_PERFORMED | 下一支：诊断 |
| P3 / P4 / 离线升级实测 / APK / 打包逐字节 cmp / 实机 | NOT_PERFORMED | — |

红线重申：自测 ≠ 独立验收；本 run 不得作为 G01/G02 修复的 PASS 依据。
