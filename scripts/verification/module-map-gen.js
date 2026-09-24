#!/usr/bin/env node
/**
 * module-map-gen.js —— 由「行区间 → 目标模块」映射生成 P0 职责分配表（Markdown）
 *
 * 依据 core-inventory.js 产出的符号表，把每个顶层符号归到计划 §4 的目标模块。
 * 输出即 docs/.../module-map.md 的表格部分，保证「搬移表」是可复算的、
 * 不是手抄的：区间改动后重跑即可刷新。
 *
 * 用法：node scripts/verification/module-map-gen.js --root <repo> --run <run-dir>
 */
"use strict";

const fs = require("fs");
const path = require("path");

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--root") args.root = process.argv[++i];
  else if (a === "--run") args.run = process.argv[++i];
  else if (a === "--inv") args.inv = process.argv[++i];
}
const root = path.resolve(args.root || path.join(__dirname, "..", ".."));
const runDir = path.resolve(root, args.run || "docs/reviews/verification-runs/20260921T0230-app-core-modularization");
const invPath = path.resolve(root, args.inv || path.join(runDir, "00-baseline/core-inventory-before.json"));
const inv = JSON.parse(fs.readFileSync(invPath, "utf8"));

/**
 * 行区间 → 目标归属。
 * 「删除」表示该符号是重复实现，按计划 §3 直接移除，不搬移。
 */
const REGIONS = [
  [1, 47, "（入口）常量 / 依赖句柄 / 状态声明", "app-core.js + lib/app-model.js"],
  [48, 105, "通用工具：id / 补零 / 日期基础 / 相对时间 / HTML 文本转义", "lib/date-utils.js + lib/app-ui.js"],
  [106, 177, "属性转义 / 危险链接 / 本地时间输入 / 历史分组标签", "lib/app-ui.js + lib/date-utils.js"],
  [178, 231, "日历原语：applyClock / 月末 / 第 N 个星期几", "lib/date-utils.js"],
  [240, 259, "解析用日历原语：下周 X / 每月 N 号", "lib/date-utils.js"],
  [261, 283, "周期标签与预览（重复实现）", "删除（唯一来源 lib/repeat.js）"],
  [284, 300, "浏览器下载", "lib/app-backup.js（平台分支）"],
  [302, 336, "极简 Markdown 渲染", "lib/app-ui.js"],
  [338, 592, "中文时间解析器副本 + CN_NUM + cnInt", "删除（唯一来源 lib/parse-cn.js）"],
  [593, 656, "项目配色 / 初始 state", "lib/app-model.js"],
  [657, 1217, "持久化：快照 / 提交链 / 重放 / 加载 / 模型规范化", "lib/app-persistence.js + lib/app-model.js"],
  [1218, 1310, "截止阶段身份 / 终态 / rev / 整理设置", "lib/app-model.js"],
  [1311, 1392, "模糊内容判定 / 整理窗口规则", "lib/app-model.js + lib/app-review.js"],
  [1393, 1710, "整理会话：通知 / 会话 / 卡片 / 出口命令", "lib/app-review.js"],
  [1711, 2083, "首页告知条 / 渲染入口 / 周期推进 / 派生 / ACK", "lib/app-views.js + lib/app-items.js"],
  [2084, 2536, "事项命令：稍后 / 完成 / 撤销 / 删除 / 恢复 / 停止周期", "lib/app-items.js"],
  [2537, 3020, "视图：卡片 / 首页 / 日历 / 归档 / 未来 / 笔记 / 统计", "lib/app-views.js"],
  [3021, 3154, "用户模式 / 个人页 / PWA 状态", "lib/app-views.js + lib/app-platform.js"],
  [3155, 3472, "AI 请求与结果归一 / 表单协作", "lib/app-ai.js"],
  [3473, 3560, "弹层 / 确认框 / toast --- 共用展示能力", "lib/app-ui.js"],
  [3561, 4000, "表单会话 / 保存反馈 / 有限撤销", "lib/app-capture.js"],
  [4001, 4328, "捕获 / 编辑表单：打开 / 复位 / 草稿 / 相似提示", "lib/app-capture.js"],
  [4329, 4628, "表单保存命令（唯一落库边界）", "lib/app-capture.js"],
  [4629, 4835, "详情 / 笔记 / 搜索 / 项目", "lib/app-content.js"],
  [4836, 5133, "原生状态漏斗 / 两套三态台账 / 送达证据落盘", "lib/app-native.js"],
  [5134, 5566, "原生对账调度 / 闹钟动作路由", "lib/app-native.js"],
  [5567, 6202, "平台桥获取 / 通知实验室 / 系统设置诊断", "lib/app-platform.js + lib/app-diagnostics.js"],
  [6203, 6379, "自启动引导 + 实验室绑定", "lib/app-diagnostics.js + lib/app-setup.js"],
  [6380, 6540, "即将到来行 / 送达证据读取", "lib/app-views.js + lib/app-native.js"],
  [6541, 7018, "首次引导 / 自检 run / 用户反馈 / 设置步骤", "lib/app-setup.js"],
  [7019, 7165, "Web 弹条与 tick", "lib/app-alerts.js"],
  [7166, 7504, "备份导出 / 导入 / 演示预览 / 示例数据", "lib/app-backup.js"],
  [7505, 8047, "bind()：全部事件绑定逐功能拆分", "各模块 bindX() + app-core.js 装配"],
  [8048, 8140, "PWA 注册与安装提示", "lib/app-platform.js"],
  [8141, 8272, "活动闹钟面板 / 网络 / query 动作", "lib/app-alerts.js + lib/app-platform.js"],
  [8273, 8387, "init / startApp：依赖验证 + 唯一启动", "app-core.js"],
  [8388, 8558, "wrapUserOp 装配 + __ATTENTION_INBOX__ 兼容入口", "app-core.js + lib/app-test-api.js"],
];

const byRegion = REGIONS.map(([from, to, content, target]) => ({
  from, to, content, target,
  symbols: inv.symbols.filter((s) => s.line >= from && s.line <= to),
}));

const assigned = new Set();
byRegion.forEach((r) => r.symbols.forEach((s) => assigned.add(s.name)));
const unassigned = inv.symbols.filter((s) => !assigned.has(s.name));

let md = "";
md += "## 顶层符号 → 目标模块分配表（自动生成）\n\n";
md += "来源：`app-core.js` @ " + inv.totalLines + " 行 / " + inv.bytes + " 字节，" +
  inv.functionCount + " 个函数 + " + inv.stateCount + " 个状态，共 " + inv.topLevelSymbolCount + " 个顶层符号。\n";
md += "生成器：`scripts/verification/module-map-gen.js`（改区间后重跑即可刷新本表）。\n\n";
md += "| 原行区间 | 负责的内容 | 目标归属 | 顶层符号数 | 符号 |\n| --- | --- | --- | --- | --- |\n";
byRegion.forEach((r) => {
  const names = r.symbols.map((s) => s.name).join(", ") || "—";
  md += "| " + r.from + "–" + r.to + " | " + r.content + " | " + r.target + " | " + r.symbols.length + " | " + names + " |\n";
});
md += "\n";
if (unassigned.length) {
  md += "### 未被区间覆盖的符号（需补区间）\n\n";
  md += unassigned.map((s) => "- L" + s.line + " `" + s.name + "`").join("\n") + "\n";
} else {
  md += "区间覆盖检查：**" + inv.topLevelSymbolCount + " / " + inv.topLevelSymbolCount +
    " 个顶层符号全部落入区间**，无遗漏。\n";
}

const out = path.join(runDir, "00-baseline/module-assignment-table.md");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md);
process.stdout.write("已写出 " + path.relative(root, out) + "（覆盖 " + assigned.size + "/" + inv.topLevelSymbolCount + "）\n");
