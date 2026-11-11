# 黑暗亲王＋飞龙兼容

独立维护的CK3兼容Mod。无需Voices of the Court（VOTC）桌面应用或Workshop模组；无需另一个兼容仓库；无需Git子模块、符号链接或原VOTC的`.build`。Node只用于开发和打包，游戏运行不需要Node。

版本：1.3.22源码迁移候选。源自最后安装版本的全部运行模型、贴图、游戏脚本和本地化保留；本次不宣称完成CK3实机验收。已知未解决问题见[迁移与验收](docs/MIGRATION.md)。

## 游戏依赖

- CK3 Mythical Vanilla : Wyvern（3811316052）
- Princes of Darkness（2216659254）

不要同时启用东方王朝、汉番礼制和天家宗仪。

VOTC不在依赖列表中，也不会因为机器安装了VOTC自动加入对话桥。为兼容已有播放集和存档，安装目录继续使用`VOTC_Wyvern_POD_Compatibility`；旧文件名中的VOTC仅是历史标识。

## 下载源码后独立构建

使用Node.js 22或更新版本，无需`npm install`：

```powershell
npm test
npm run plan
npm run build
npm run install-mod
```

`npm run build`输出本仓库`.build/package-*`和本地最新构建指针。`install-mod`从Windows系统文档目录寻找CK3用户目录；也可明确指定：

```powershell
npm run install-mod -- --user-dir="E:/Documents/Paradox Interactive/Crusader Kings III"
```

安装前关闭CK3。安装器核对全部文件SHA-256、备份改变的旧文件，移除旧包中可选VOTC对话桥，保留其他自定义文件；不会修改启动器播放集。安装后在启动器启用兼容Mod，放在上述前置Mod后加载。

只想手动安装时，将生成包内`mod/`目录的内容复制到CK3用户目录的`mod/`下，并修改外部`.mod`的`path`为实际安装路径。可选`npm run release`使用Python3生成本地`dist/`安装ZIP（不提交Git）；旧发行ZIP已按用户要求删除。

## 源码与素材

`modules.json`、`patches/`和`mod/`是运行包的全部源码；`scripts/`自包含构建和安装工具；`tests/`保存当前离线检查与历史专项；`artwork/`保存参考图、来源声明和在用素材构建输入。

运行资源已经提交，正常组包不需要Blender、CK3本体文件、Workshop源文件或任何Python依赖。只有重做素材才需要`pip install -r requirements-artwork.txt`，重新生成上游合并层才需要对应版本的CK3／Workshop输入。原稿及历史ZIP已经删除；未发布的重建材质大文件只在迁移档案保留，来源和三视图仍在仓库。历史模型重建脚本不属于正常组包流程。

本仓库只负责兼容与衍生内容；上游Mod须自行安装，素材归属见各来源清单。原始项目历史状态见[迁移前记录](docs/PRE_SPLIT_HISTORY.md)。
