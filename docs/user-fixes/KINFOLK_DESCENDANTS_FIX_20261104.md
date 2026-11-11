# 引导兽嫡后代觉醒 · 修复记录（2026-11-04）

## 现象

决议「引导兽嫡子女觉醒」不在决议列表显示；把未成年后代改到 15 岁、再到 16 岁，也没有首次化形。

## 根因

1. **决议只扫描“直接子女”。**
   原 `is_shown`、`is_valid` 使用 `any_child`，effect 使用 `every_child`。玩家的直接子女已经成年时，符合条件的是**孙辈/更后代**，决议就不会显示，也不会补旗标。
   已改为 `mm_pod_has_eligible_kinfolk_descendant_trigger`，覆盖子女、孙辈、曾孙辈、玄孙辈；effect 用同名四层 `every_child` 标记所有符合条件的后代。
2. **脚本文件缺少 UTF-8 BOM。**
   当前日志中 `mm_pod_kinfolk_first_change_decisions.txt` 和 `mm_pod_kinfolk_first_change.txt` 都有 `should be in utf8-bom encoding` 警告。已补齐 BOM。
3. **16 岁生日桥接缺失。**
   部分玩法组合会定义自己的 `on_16th_birthday`，POD 原始事件列表可能不执行；已新增 `on_birthday` / `on_16th_birthday` 桥接事件，显式排队 `POD_fera_maintenance.2`，且条件与 POD 原事件一致。
4. **原有逻辑本身没有错**：孩子必须是 `kinfolk`，且不是 `fera` / `changeling` / `revenant`，也未拥有 `fera_first_change` 旗标。这个条件保留，避免把已化形或非兽嫡角色强行加入。

## 修改文件

```text
common/decisions/mm_pod_kinfolk_first_change_decisions.txt
common/scripted_triggers/mm_pod_kinfolk_first_change.txt
common/scripted_effects/mm_pod_kinfolk_first_change_effects.txt   # 新增
localization/simp_chinese/mm_pod_kinfolk_first_change_l_simp_chinese.yml
localization/english/mm_pod_kinfolk_first_change_l_english.yml
```

决议仍不消耗金币/虔诚，效果只加 `fera_first_change` 旗标；16 岁首次化形沿用 POD 原版 `POD_fera_maintenance.2`，不立即改种族。

## 备份

```text
E:\Documents\Paradox Interactive\Crusader Kings III\mod_backups\VOTC_Wyvern_POD_Compatibility_kinfolk_descendants_20261104
```

## 当前 16 岁后代的即时补行（不用重启）

如果「熠煌」已经是 16 岁但没化形，可在当前局控制台执行：

```text
run first_change_now.txt
```

这会补旗标并直接排队 `POD_fera_maintenance.2`；执行后关闭/重开角色窗。

## 测试

1. **完全退出 CK3 再启动**（脚本改动不能热重载）。
2. 打开玩家决议列表，应出现「引导兽嫡后代觉醒」。
3. 确认 15 岁后代是 `kinfolk`，不是已经 `fera` / `changeling` / `revenant`。
4. 使用决议，等其自然 16 岁生日；不要在控制台直接把年龄跳到 16，否则 `on_16th_birthday` 不一定触发。
5. 日志出现 `MM_POD_KINFOLK_DESCENDANTS_MARKED` 表示决议 effect 已执行。

如果仍不显示，请提供：玩家角色是否有 **直接子女/孙辈**、15 岁后代的 traits（是否 `kinfolk`）、是否已 `fera`，以及 `logs/error.log` 中 `mm_pod` 相关行。
