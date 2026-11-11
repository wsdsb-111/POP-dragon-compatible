# 飞龙＋黑暗亲王兼容候选（2026-11-02）

2026-11-03 用户实测发现龙模型缺失及人物窗闪退，上一轮候选未通过实机。现已安装六文件渲染热修复，独立包共 486 个文件，等待用户重启复测；详见[热修复与证据](wyvern-pod-rendering-hotfix-20261103.md)。下方 480 文件安装记录保留为上一轮历史，不代表当前包已实机通过。

此项新增第二套组包配置。现有东方王朝＋汉番礼制＋天家宗仪组合继续使用原来的默认包；新配置复用同一份龙族机制，仅替换环境相关的覆盖文件。当前仍是 1.3.22 工作树上的兼容候选，不代表已完成黑暗亲王实机验收。

## 使用范围

- 必需：CK3 1.20、CK3 Mythical Vanilla : Wyvern（3811316052）、Princes of Darkness（2216659254）。
- 新配置不要求东方王朝、汉番礼制、天家宗仪、人格经验、功绩显示、宫帐、中华大庄园、Weight of Crown 或生于斯土。
- 保留定制真龙、龙王、初代种、S/A/B/C、黑血及相关特质、化形、羁绊、繁育、强制孵化、龙之信条与六礼仪、升格、圣物和能力。圣物重铸继续关闭。
- 龙血是在既有人物身上的额外血统；不删除黑暗亲王的吸血鬼、狼人等种族，不改其种族判定，不给龙族添加 PoD 的 `splat` 标记，也不解除吸血鬼等种族原有的生育限制。混血等级仍走现有混血继承脚本，PoD 血统走 PoD 自己的出生规则。
- 真龙仍按既有龙蛋机制繁育，不改成普通妊娠。半龙蛋保留真实父母、血源和既有孵化规则；强制孵化保留成功后才支付 100 金币、250 虔诚的规则。

## 组包与检测

在仓库根目录运行：

```powershell
# 现有东方组合：保持原命令和默认模块。
node scripts/build-package.js

# 飞龙＋黑暗亲王：不带东方兼容。
node scripts/build-package.js --profile=wyvern-pod

# 同时启用 VOTC 时，额外装入原有对话桥。
node scripts/build-package.js --profile=wyvern-pod --modules=wyvern-votc-dialogue

# 根据当前播放集自动选包，并按 VOTC 是否启用选择对话桥。
node scripts/build-package.js "--playset=E:/Documents/Paradox Interactive/Crusader Kings III/dlc_load.json"

# 只检查组包清单、依赖和哈希，不复制模型/贴图或安装任何内容。
node scripts/build-package.js --profile=wyvern-pod --dry-run
```

检测读取 `enabled_mods` 所指向的 `.mod` 描述文件中的 Workshop ID。仅下载但未启用的 Mod 不算已加载；兼容包的 `dependencies` 不会替用户启用任何 Mod。PoD 与上述任一东方 Mod 同时启用时，自动组包明确拒绝这套未适配组合；不会猜测加载优先级。

自动组包是启动前的文件选择，不是游戏运行中热切换。切换播放集后须重新组包/选择对应候选包并重启游戏。此命令不修改 `dlc_load.json`、Workshop 文件、存档或现有东方版安装。

新包目录和描述符为 `VOTC_Wyvern_POD_Compatibility`，显示名为“多 Mod 兼容 Mod - 飞龙与黑暗亲王”。在 PoD 播放集中放在 PoD 和飞龙之后；与原“多 Mod 兼容 Mod”二选一启用。原东方组合继续使用原包。两套组合分别建立新档验证，不将跨世界观切换旧存档列为支持范围。

## 合并原则与来源

`package-profiles.json` 列出新配置复用的模块、排除的旧覆盖和新桥接目录；旧模块源码不为 PoD 而重写。

- 人物、交互、查找、地图与信仰界面以 PoD/游戏为底合入飞龙及六礼仪界面；保留 PoD 自身的入口。
- 婚配、骑士、派系、宗教战争、性行为、求爱、灵感、宝物质量与人口清理以 PoD 定义为底，仅接入已有龙族增量。
- 不带汉番专属派系、东方服饰基因整文件、东方宫帐和年号界面；文化历史仅移除三个来自东方/天家的创新。1.20 本体的中国文化、地域、服饰、创新及十处圣地数据继续保留。
- 保留 PoD 的自然出生订阅与种族赋予，仅为已有真龙排除默认 `mortal` 回退；混血仍允许保留普通人分类。出生回调顺序、蛋创建与 PoD 角色初始化的实际交互仍需实测。
- 将龙之信条登记为受支持的自定义宗教，避免被 PoD 当作原版宗教隐藏或清理；PoD 对吸血鬼等种族的改信限制继续保留。
- 新配置带入当前安装版已由用户确认正常的人形修复：MYV 同路径肖像覆盖、人形时屏蔽颜色/体型龙体层、单一 `on_send` 切换入口。现有东方安装及其工作树源码不受此候选包影响。

来源及输出 SHA-256 记录于 `patches/wyvern-pod/ui-sources.json`、`mechanics-sources.json`、`core-sources.json` 和 `human-form-sources.json`。PoD/飞龙更新后须重新比对这些来源；不能只更新依赖名就认定兼容。

## 验证状态

本轮完成记录：

- 候选已组包并独立安装至 `E:/Documents/Paradox Interactive/Crusader Kings III/mod/VOTC_Wyvern_POD_Compatibility`，显示名“多 Mod 兼容 Mod - 飞龙与黑暗亲王”；480 个安装文件逐一匹配组包清单 SHA-256，依赖仅飞龙和 PoD。没有替用户启用它。
- 原东方版安装的 522 个文件、外部描述符及当前 `dlc_load.json` 在安装前后哈希完全一致。默认东方组包的 515 个文件与本轮开始时的模块来源、内容和描述符生成规则一致；这不等于宣称源码包与旧安装目录完全一致，后者含安装目录独有的人形热修复及停用备份。
- 7 组专项检查通过：`test-wyvern-pod-independent-qa.js`、`test-wyvern-v132-lineage.js`、`test-v1311-lineage.js`、`test-wyvern-human-form.js`、`test-wyvern-v130-kings.js`、`test-v139-dragon-creed.js`、`test-v1320-relics.js`。所有检查串行，Node 堆上限 384 MB；没有运行完整发布回归。
- 102 项来源哈希及 27 项桥接输出哈希匹配；21 份新增脚本/历史/肖像数据通过有限 PDX 解析。构建、检测与机制生成脚本的 JavaScript 语法检查通过。
- 单独核对了 VOTC 可选配置，清单正确增加 VOTC 对话桥及第三项依赖；实际安装的是两模组基础候选。当前真实播放集自动识别为东方配置，检测没有修改播放集。
- 组包结果及安装回执：`.build/pod-compatibility-20261102/build-result.json`、`deployment.json`；检查日志与来源验证记录在同目录。安装前已确认 CK3 未运行。未启动 CK3、未读写存档、未验证本轮游戏日志。

静态语法、来源哈希或有限脚本模拟均不等于 CK3 成功加载或存档验证。

实机待验收：无东方三 Mod 的 PoD 新档加载及 `error.log`、PoD 专属人物入口、真龙与化形肖像、龙王沉睡与移动、既有家族混血分配、普通/半龙蛋孵化、PoD 种族与龙血共存及出生继承、六礼仪/圣地地图、圣物装备和主动能力。东方组合的本轮回归也要独立签署，不以旧日志代替。
