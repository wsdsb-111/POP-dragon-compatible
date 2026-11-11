# 1.3.2 六系精确配色源

正式生产源是原MYV 2048×2048 albedo及本目录`recipes.json`、`mask-evidence.json`、`mask-*.png`。用户于2026-10-27明确授权：**“允许脚本精确配色，保留原纹理细节”。** 六张`*-imagegen.png`是此前严格atlas编辑尝试的拒收参考，不参与生产；它们返回1254分辨率并重描纹理，不能满足原纹理细节要求。

运行`python scripts/build-royal-palettes.py`生成六张DDS和定义；`--definitions-only`只重建定义/清单。运行`python scripts/render-royal-palettes.py`生成原始mesh绑定姿态的离线比较。依赖NumPy/Pillow；本阶段不调用Node或游戏。最终指纹见`manifest.json`；原依赖仅被读取，不复制重导出mesh或clip。

## 分区证据

`native-uv-coverage.png`由原19,543个三角形的u0坐标直接光栅化，坐标无翻转或重新排布。`native-uv-bone-regions.png`按原skin中各顶点主权重骨骼及每三角面多数分类，颜色图例为：

| 颜色 | 主骨影响区域 |
|---|---|
| 蓝 `#4e91b5` | 翼指、翼瓣、腕/肘/肩等翼与前肢 |
| 紫 `#8b70b4` | 尾和尾棘 |
| 橙 `#d99849` | 眼、眼睑、眉、鼻 |
| 粉 `#bb7188` | 颌与舌 |
| 绿 `#77ac79` | 头颈 |
| 黄褐 `#a69563` | 髋、膝、踝、足/爪等后肢 |
| 棕 `#ae856c` | 躯干和其他骨 |

这张图是可复核的**骨影响分类**，不冒称精准的鳞片/角/腹部材质分割。翼权重来自该图并只在mask上柔化6像素，配合原red/green逐像素差分确认原生可着色区域。浅色权重结合原图低饱和高明度，覆盖腹侧与浅色角质，不能独称“腹部精确mask”；深棘权重来自原图原有蓝色暗部。眼睛/口腔通过原图橙眼与粉色口腔HSV地标保护，72,909个像素保留原RGB。

## 细节与通道不变量

每个输出像素从同坐标原像素计算，没有纹理重采样、位移、重绘、锐化、颜色图模糊或生成式补细节。原亮度以正增益单调曲线映射，保留原鳞片、褶皱及暗缝的空间结构；只有区域混色权重使用软边。输出DDS复用原128字节头与原BGRA布局，alpha逐像素/逐字节保留。normal、properties、shader、完整mesh、compact mesh、骨骼、UV和15个clips均是原依赖。

`deterministic-albedo-contact.png`是同坐标atlas比较；`native-bind-comparison.png`及各`*-native-bind-preview.png`从原12,278顶点/19,543三角面/原UV及normal/properties软件采样，不是新模型或生成图。它们只展示**离线绑定姿态和近似材质光照**，未模拟原生动画或CK3宫廷照明，不能签署实机PASS。

六类配色按fire/earth/sea/sky/white/black保存，双生及同系合一共用同张albedo。普通六色和宫廷龙首战利品不变。新ascension身体仅在当前龙形且持有合法血源快照时进入六系；family0使用实际源龙原色。常规人形、仅血脉祖源及普通龙创造归属不授权王族配色。
