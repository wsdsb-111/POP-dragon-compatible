# 飞龙战利品图标

生成方式：内置 `image_gen`，四次独立生成，透明背景。下列为生成规格的归档整理；原始 PNG 保留生成的透明通道，仅在导出游戏图标时缩放及转换格式。

共同提示：Use case: stylized-concept. Asset type: square transparent inventory icon for an original medieval grand strategy game artifact, readable at 240×240. Detailed hand-painted medieval treasure illustration, restrained realism, muted aged ivory, olive, dark brown and antique bronze. Upper-left highlights. One centered isolated object occupying 75–80% of the canvas with generous transparent padding. No text, frame, logo or watermark. Transparent background.

| 输出 | 追加主体提示 | 游戏资源 |
|---|---|---|
| `fang.png` | A curved aged-ivory dragon fang with a small antique bronze band around the root; weathered texture and a clearly readable silhouette. | `mm_wyvern_trophy_fang.dds` |
| `eye.png` | An amber dragon eye with a vertical pupil, displayed in an antique bronze reliquary cup on a small leather base; jewel-like and non-gory. | `mm_wyvern_trophy_eye.dds` |
| `scale.png` | Three overlapping dark emerald dragon scales on an antique bronze backing; thick textured scales, a compact treasure silhouette. | `mm_wyvern_trophy_scale.dds` |
| `head.png` | An olive-green taxidermy dragon head, three-quarter view facing left, horned with closed mouth, mounted on a wooden shield; non-gory. | `mm_wyvern_trophy_head.dds` |

原图均为 1254×1254 RGBA；游戏图标为 240×240 DXT5 DDS。PNG 和 DDS 的一致性由测试检查尺寸、透明通道及文件指纹。宫廷三维展示复用原生独角鲸牙、宝石、兽皮和狮首实体，并非新建的飞龙三维模型。

上述陈列说明记录 v1.1.2/v1.1.3 的旧实现。自 v1.1.4 起，五件模型全部替换为原创程序化网格，见[模型与重建说明](models/README.md)。新增 `claw.png` 来自爪部网格渲染，未调用新的图像生成服务；上述四张原图标保留。
