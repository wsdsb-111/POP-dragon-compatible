# 飞龙＋黑暗亲王模型与界面热修复（2026-11-03）

## 用户实测与日志

上一轮兼容候选未通过实机：用户报告所有龙模型不显示，打开龙族人物界面闪退。崩溃证据在本机 `crashes/ck3_20261102_232802`，CK3 版本 1.20.1.2。异常为无函数符号的 `C0000005`；不能仅凭该堆栈认定闪退的唯一原因。

同一次崩溃日志末尾明确记录：

- `male_body_entity` / `female_body_entity` 缺少 `myv_wyvern_origin` 挂接点。
- `myv_wyvern_compact_portraits.gui` 无法创建 `myv_wyvern_outliner_cooltip`，伴随 malformed tooltip 错误。
- 初始化阶段缺少多个 `myv_rider_kneeling_*` 和 `myv_human_offscreen` 动画。

飞龙先于 PoD 加载；上一轮候选遗漏了双方共同覆盖的身体/头部资产及右侧栏、共享提示框文件。PoD 的文件覆盖了飞龙增加的渲染接口。源模型文件存在不代表其挂接点、动画和界面类型依赖完整。

## 修复与安装

以游戏文件为共同祖先，将 PoD 与飞龙做统一行尾的三方合并，新增到独立 PoD 桥接层：

1. `gfx/models/portraits/male_body/male_body.asset`
2. `gfx/models/portraits/female_body/female_body.asset`
3. `gfx/models/portraits/male_head/male_head.asset`
4. `gfx/models/portraits/female_head/female_head.asset`
5. `gui/hud_outliner.gui`
6. `gui/shared/cooltip.gui`

保留 PoD 原有骨架、模型、动画和界面增量，补回 MYV 的挂接点、共用动画、实体状态、龙族提示框类型及其调用。女体与儿童体使用的共用动画集由男体/男头资产声明，故一并核验其继承依赖；没有用整份飞龙资产覆盖 PoD。

生成脚本：`scripts/build-wyvern-pod-rendering.py`。18 项输入及 6 项输出哈希：`patches/wyvern-pod/rendering-sources.json`。

六份文件已安装到 `E:/Documents/Paradox Interactive/Crusader Kings III/mod/VOTC_Wyvern_POD_Compatibility`，现共 486 个文件。安装前确认 CK3 未运行；原 480 个文件、描述符、当前播放集及东方版文件哈希均未变。

回执：`.build/pod-render-crash-20261103-BgjSPi/deployment.json`；当前回执目录指针：`.build/current-pod-render-crash.txt`。本次六项此前均不存在于兼容包，回执记录 `beforeSha256 = null`；未删除任何用户文件。

## 验证边界

- 先新增 `test-wyvern-pod-rendering.js`，在旧候选上因缺少男体挂接资产而失败；合并后通过。检查挂接点、共用动画和实体状态、提示框实际类型定义与调用、输出哈希及冲突标记。
- `test-wyvern-pod-independent-qa.js` 再次通过，新组包 dry-run 包含六项输出。
- 四份资产逐一剔除新增 MYV 行后，与 PoD 原资产正文完全一致；18 项来源哈希匹配。六项安装文件哈希匹配，未改动其他安装内容。
- 独立代理审查因服务额度限制未完成，不计作通过。
- 未启动 CK3、未加载或写入存档、未进行人物窗实测。准备界面检查时用户明确表示自行测试，已停止所有游戏界面操作。

本次修复消除了日志中已知的渲染依赖缺项。模型恢复、反复打开人物窗是否仍闪退，须由用户重启游戏后复测；不将静态检查写成已消除闪退。
