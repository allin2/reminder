# 三项证据脚本缺口独立复验

- run：20260922T114349-independent-evidence-gaps-recheck
- 仓库：/Users/qlyf/Developer/reminder
- HEAD / origin/main：3574824357dc7beb04cbd3e32aa413cd508e8484
- 对象：20260922T1130-evidence-script-gaps 对 T1–T3 的修复
- 角色：独立验收方
- 总结论：**PASS**

## 1. 裁决

上一轮 20260922T110036-independent-p2cr2-recheck 留下的三项证据工程缺口均已关闭：

| 缺口 | 独立结果 | 核心反例 |
| --- | --- | --- |
| T1：Bash 变量紧邻非 ASCII 标点导致 set -u 中断 | PASS | UTF-8 locale 下真机完整跑完 1 轮，exit 0 / OVERALL=PASS |
| T2：WAL 只看第一条新增 record | PASS | 首条空批次 + 第二条真实 put 被判 HAS_OPERATIONS，OPS=1，exit 2 |
| T3：restore verify 不拒绝目录额外文件 | PASS | 多余文件与清单缺失两方向均 VERIFY=FAIL / exit 1；精确清理后 VERIFY=PASS |

因此，P2-C-R 上一轮的产品 PASS 不变，证据交付的 PASS_WITH_FOLLOWUP 可收口为 **PASS**。这三项不再阻挡冻结可复算 checkpoint。

## 2. 身份与只读边界

实施方证据清单中的 57 个对象全部重新验算：57/57 OK。三个脚本当前哈希与交付清单一致：

- p2cr-coldstart-rounds.sh：bc07734c72388b15e28d1813d5fcf89f3bf5020ee8931232a79d76172f59823f
- idb-wal-delta.py：7c4973f398384655355deabd52dde7339836c23fe2ff501b0fde469b5fc608cc
- p2cr-idb-fault-inject.sh：8c1a6d93a582c2fcce92ef4438350ddda6ba8334e4ca283d7e006862ac2428d1

九个产品与测试文件的哈希均与实施方 R2 参照值一致。本轮未改产品源码、测试或上述三个脚本，只新增此独立证据目录。工作区保持原脏现场；未 checkout、stash、reset、commit 或 push。

证据：

- evidence/implementer-artifact-hash-summary.txt
- evidence/current-script-hashes.txt
- evidence/script-hash-diff.txt
- evidence/final-repo-state.txt

## 3. T1：Bash 可移植性

静态扫描两个相关 Bash 脚本，未发现 $NAME 后紧邻非 ASCII 字符的裸引用；bash -n 均通过。

随后在 LC_ALL=en_US.UTF-8 下对测试包 space.alliswell.inbox.exportrecheck 真机执行 1 轮完整 force-stop → 冷启动：

- 脚本 exit 0，未出现 unbound variable；
- OVERALL=PASS；
- 记录级哈希 A/C 均为 0625aacabcd5068a；
- 页面恒为 loaded / authoritative / idb，writesAllowed=true；
- 冷启动只增加 19 B 空 WriteBatch，OPS=0 / EMPTY_MARKER。

证据：

- evidence/t1-static-scan.txt
- evidence/t1-device-coldstart-exit.txt
- evidence/t1-device-coldstart-utf8.txt
- device-coldstart/wal-delta-round-1.txt

## 4. T2：WAL 全记录汇总与 fail closed

对归档的 12 组夹具直接调用当前解析器，结果 12/12 PASS：

- marker-then-1put：HAS_OPERATIONS / OPS=1 / records=2 / exit 2；
- marker-then-real5put：HAS_OPERATIONS / OPS=5 / records=2 / exit 2；
- 独立方原 43 B 反例作为真实增量：HAS_OPERATIONS / OPS=1 / records=2 / exit 2；
- 只有空标记：NO_OPERATIONS / OPS=0 / exit 0；
- 截断、短残尾、前缀重写、WAL 变小、无基线：均 INCONCLUSIVE / exit 3；
- 无变化：NO_OPERATIONS / exit 0。

这同时证明“第二条真实写不能被第一条空标记遮住”和“无法判断必须 fail closed”两条要求均成立。冷启动脚本也会按退出码与 VERDICT 双向核对并在不一致时判失败。

证据：

- evidence/t2-all-archived-fixtures.txt
- evidence/t2-independent-cases.txt
- evidence/t2-semantic-assertions.txt
- evidence/t2-two-record-real-op.json
- evidence/t2-truncated.json
- evidence/t2-rotated-prefix.json
- evidence/t2-no-baseline.json

## 5. T3：恢复目录双向闭合

在应用停止状态备份当前真机 IDB 后执行：

1. 干净目录：5/5 文件逐字节一致，VERIFY=PASS。
2. 向目录加入固定名 INDEPENDENT-RESIDUE-20260922T1224：当前 6 个、清单 5 个，新逻辑点名额外文件，VERIFY=FAIL、exit 1。
3. 只删除该固定名文件：再次 5/5 一致，VERIFY=PASS。
4. 用仅多一项的本地清单模拟设备缺失文件：点名 INDEPENDENT-MISSING-20260922，VERIFY=FAIL、exit 1。

测试结束后设备目录只剩原 5 个普通文件及运行期 LOCK。重新启动应用后：

- 记录级哈希仍为 0625aacabcd5068a（2443 字节）；
- items=2 / projects=1；
- loaded / authoritative / idb；
- writesAllowed=true / blockedWriteCount=0；
- 恢复面板不可见。

证据：

- evidence/t3-backup.txt
- evidence/t3-clean-before.txt
- evidence/t3-extra-rejected.txt
- evidence/t3-missing-rejected.txt
- evidence/t3-clean-after.txt
- evidence/t3-exits.txt
- evidence/device-final-health.txt

## 6. 复验过程说明

两次不构成被测对象失败的操作错误均原样保留：

- 首次哈希校验在实施方 run 子目录执行，而清单使用仓库相对路径，产生“文件不存在”；回到仓库根目录后 57/57 通过。原输出为 evidence/implementer-artifact-hash-check.txt，校正结果为 evidence/implementer-artifact-hash-check-corrected.txt。
- 首次调用 fixtures/make-and-test.py 未传其三个必需参数，产生 IndexError；随后不重新生成夹具，直接对已归档且哈希验真的 12 组 before/after 调用当前解析器，12/12 通过。原输出保留为 evidence/t2-fixture-suite.txt。

## 7. NOT_PERFORMED 与边界

- 本轮未重跑 2320 条产品自动化；九个产品与测试文件哈希未变，产品结论继承上一轮独立验收。
- 未从原始真机 WAL 重新生成 12 组夹具；归档夹具已通过交付哈希核验，并由当前解析器逐组独立重放。
- 导入格式安全面、P2 后续、P3/P4、发布、提交和推送均不属于本轮。
- 后台回收等上一轮既有 NOT_PERFORMED 不因本轮证据脚本复验而改变。
