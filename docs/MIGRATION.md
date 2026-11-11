# 2026-11-11 独立仓库迁移

本仓库：黑暗亲王＋飞龙兼容。工作目录：`D:/CK3-Mods/POP-dragon-compatible`。迁移前源码位于VOTC工作区的`.build/compat-v111`；现在任何正常构建、打包、测试或安装均从本仓库内部读取源码，不回到旧路径。

## 保留与变化

- 导入所有尚未提交的当前玩法与资源，保留原始ID、变量、王族、继承、唤醒、圣物及模型资源。
- 每仓库拥有自己的共享模块副本，无跨仓库引用。PoD专用覆盖只进入PoD仓库，东方版不带PoD覆盖。
- 删除VOTC可选对话桥模块及其强制依赖；原`votc_celestial_office_*`等由兼容Mod自行定义的标识保留，不能按前缀误删。
- 先导入当前已安装、未回流旧源码的用户热修复，再将显示名称和VOTC依赖元数据独立化；其它运行文件须与最新安装基线逐项SHA-256一致。基线位于`tests/fixtures/migration-baseline.json`。
- 本地`.build`中的旧包、部署回执、一次性维护脚本和缓存作为历史迁移档案；不作为新仓库构建输入。Python模型依赖通过`requirements-artwork.txt`安装，不再导入旧`.build/model-deps`。
- 按用户要求删除原稿格式文件和旧发行ZIP；在用`patches/**/mod/gfx`模型与贴图不在删除范围。删除清单单独保留在本地迁移档案。

## 当前状态与验收边界

用户已在此前自行修复PoD兽嫡孙辈觉醒与16岁化形。本次只读核对当前已安装版本，发现7份热修复未同步回旧.build源码，现已原样导入PoD仓库。东方版同样纳入5份已安装人形修复。来源与SHA-256见migration/installed-fix-sources.json；原修复记录见docs/user-fixes。本次不重新实现或改写这些修复，也不冒称由迁移完成了游戏实测。部分圣物模型重铸仍停用，六礼仪后续玩法和旧版已记录的来源漂移失败也不因迁移被声明完成。

`npm test`的组数、安装模拟和迁移字节结果以本仓库最终验证报告为准。本次不启动CK3，不修改真实存档或播放集；游戏运行仍需用户在匹配前置Mod和版本下验收。

## 当前安装热修复同步

旧源码基线在migration/pre-installed-reconciliation-baseline.json保留；tests/fixtures/migration-baseline.json现在记录合并当前安装热修复后的完整运行包。每份非descriptor运行文件都已再次与真实安装逐字节核对。东方为517份，PoD为529份；不包含旧对话桥、.disabled备份和安装目录中的修复说明文档。
