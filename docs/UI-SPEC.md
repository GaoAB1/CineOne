# CineOne UI 重构规范 —— Forward「新视界」风格映射

> 本文档是本次前端 UI 重构的**唯一设计契约**。前端实现时所有数值直接照抄本文档；
> 所有颜色一律引用 `tokens.css` 变量，组件内禁止出现硬编码色值（唯一例外：`#FFFFFF`/`#000000` 与基于 Token 色值的 rgba 透明度叠加）。
> 图标库已锁定 **remixicon**（`ri-*` class），全项目统一，不得引入其他图标方案，禁止任何 emoji 作为功能图标。

---

## 1. 设计理念：Forward 风格 → CineOne 映射

Forward 的核心气质是「**内容即视觉**」：近黑沉浸背景上，电影海报墙本身就是主视觉，UI 只做最轻量的容器（毛玻璃导航、悬浮胶囊、大圆角海报）。CineOne 是影视聚合 Web 应用，与 Forward 同属媒体库品类，映射关系如下：

| Forward（iOS 媒体库播放器） | CineOne（Web 影视聚合） | 说明 |
|---|---|---|
| 近黑沉浸背景 + 海报墙第一主视觉 | 深色为默认主题，`#0A0A0C` 背景，海报卡片占据页面主体 | 内容优先，UI 退后 |
| 首页 Hero 精选大图（backdrop + 渐变遮罩） | 首页顶部新增 Hero 精选区（取每周热门第 1 项） | 数据来自现有 `fetchHome('week')`，无需新接口 |
| 横滑卡片流（移动）+ 网格墙（宽屏） | `< lg` 横滑行 + scroll-snap；`≥ lg` 转网格海报墙 | 见 §4.3 响应式策略 |
| 毛玻璃底部 Tab 栏 | 移动端悬浮毛玻璃 TabBar；桌面端毛玻璃 Sidebar | 保留现有双导航结构，仅重塑材质 |
| 海报上半透明评分胶囊 | TMDB 评分胶囊叠加在海报左下角 | 复用 `RatingBadge` 视觉语言但改为玻璃深色胶囊 |
| 大圆角海报卡（16-20px） | `--radius-card: 18px`，Hero 容器 24px | 全项目统一 |
| 克制精致动效（hover 浮起 / 按压回弹 / 页面淡入） | 保留 `--ease-spring` 轻回弹，新增页面淡入与骨架屏微光 | 全部支持 reduced-motion |
| 亮 / 暗 / 跟随系统三模式 | 保持现有 light/dark 双主题机制不变 | 仅修订色值与材质参数 |

**设计基调三关键词**：沉浸（Immersive）、内容即装饰（Content-as-Visual）、克制的精致（Quiet Polish）。

---

## 2. Design Token 定义（修订后 tokens.css 目标内容）

以下代码块为 `client/src/styles/tokens.css` 的**完整目标内容**，前端可直接整体替换落地。

要点说明：
- 新增 `--color-bg-elevated`（浮层底）、`--surface-warm`（三级表面）、`--overlay-capsule-*`（海报上的玻璃胶囊）、`--scrim-hero`（Hero 渐变遮罩）、`--focus-ring`、`--duration-slow`、`--ease-emphasized`、毛玻璃参数变量组。
- Hero 渐变使用 `color-mix()` 基于 Token 色值生成透明度叠加（符合「基于 Token 色值的 rgba 允许」规则），避免硬编码 hex。
- `--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)` 为允许的轻微回弹，**保留不动**；禁止出现 `cubic-bezier(0.68, -0.55, 0.265, 1.55)` 一类过冲弹跳曲线。

```css
/**
 * 设计令牌 CSS 变量（深浅双主题完整定义）—— Forward 风格重构版。
 * 组件内禁止硬编码色值，一律引用本文件变量。
 */

:root {
  /* ===== 色彩（浅色模式）===== */
  --color-bg-primary:   #F5F5F7;             /* 页面底：浅灰白，衬托海报 */
  --color-bg-secondary: #EDEDF2;             /* 二级表面：骨架屏/占位 */
  --color-bg-card:      #FFFFFF;             /* 卡片底 */
  --color-bg-elevated:  #FFFFFF;             /* 浮层/菜单底 */
  --color-accent:       #0071E3;             /* 品牌蓝（纯色，不做渐变） */
  --color-danger:       #E5484D;
  --color-success:      #30A46C;
  --text-primary:       #17171B;
  --text-secondary:     #6E6E76;
  --text-tertiary:      #9A9AA2;
  --nav-bg:             rgba(245, 245, 247, 0.68);   /* 毛玻璃导航底色 */
  --border-light:       rgba(23, 23, 27, 0.10);
  --border-strong:      rgba(23, 23, 27, 0.16);
  --surface-warm:       rgba(23, 23, 27, 0.04);      /* hover 行/次级填充 */

  /* ===== 海报叠层材质（双主题一致：保证图片上可读性）===== */
  --overlay-capsule-bg:     rgba(12, 12, 16, 0.55);  /* 评分胶囊玻璃底 */
  --overlay-capsule-border: rgba(255, 255, 255, 0.14);
  --overlay-capsule-text:   #FFFFFF;
  --scrim-hero: linear-gradient(
    to top,
    color-mix(in srgb, var(--color-bg-primary) 92%, transparent) 0%,
    color-mix(in srgb, var(--color-bg-primary) 55%, transparent) 38%,
    transparent 72%
  );
  --scrim-hero-dim: rgba(0, 0, 0, 0.22);    /* backdrop 整体压暗层 */

  /* ===== 毛玻璃材质参数 ===== */
  --glass-blur:     24px;
  --glass-saturate: 180%;
  --glass-tint:     var(--nav-bg);

  /* ===== 字体栈 ===== */
  --font-system: -apple-system, BlinkMacSystemFont, 'SF Pro Display',
                 'SF Pro Text', 'Helvetica Neue', 'PingFang SC',
                 'Microsoft YaHei', Arial, sans-serif;

  /* ===== 圆角 ===== */
  --radius-sm:   12px;    /* 小元素 / Tab 卡 / 分段控件 */
  --radius-md:   14px;    /* 输入框 / 列表容器 */
  --radius-card: 18px;    /* 影视海报卡（Forward 主视觉） */
  --radius-lg:   24px;    /* Hero 区 / 弹层 / 登录卡 */
  --radius-pill: 999px;   /* 评分胶囊 / 过滤 chips */

  /* ===== 间距（4pt 网格；响应式页边距由下方 media query 接管）===== */
  --margin-page: 16px;
  --gap-card:    12px;
  --padding-card: 16px;

  /* ===== 阴影 ===== */
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 6px 20px rgba(0, 0, 0, 0.14);
  --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.20);

  /* ===== 动效时长与缓动 ===== */
  --duration-fast: 150ms;  /* hover / 按压 / 变色 */
  --duration-base: 250ms;  /* 页面过渡 / 浮层 */
  --duration-slow: 350ms;  /* Hero 图切换 / 大区块进入 */
  --ease-out:        cubic-bezier(0.25, 0.1, 0.25, 1);
  --ease-emphasized: cubic-bezier(0.32, 0.72, 0, 1);   /* 进入型动画 */
  --ease-spring:     cubic-bezier(0.34, 1.56, 0.64, 1); /* 轻回弹（允许，保留） */

  /* ===== 焦点环（键盘可达性）===== */
  --focus-ring: 0 0 0 3px color-mix(in srgb, var(--color-accent) 45%, transparent);
}

html[data-theme="dark"] {
  /* ===== 色彩（深色模式 · 默认）===== */
  --color-bg-primary:   #0A0A0C;             /* 近黑沉浸背景（Forward 基调） */
  --color-bg-secondary: #16161B;
  --color-bg-card:      #1B1B21;
  --color-bg-elevated:  #22222A;             /* 浮层比卡片再亮一级 */
  --color-accent:       #0A84FF;
  --color-danger:       #FF5D5D;
  --color-success:      #46C78A;
  --text-primary:       #F5F5F7;
  --text-secondary:     #98989F;
  --text-tertiary:      #63636B;
  --nav-bg:             rgba(10, 10, 12, 0.66);
  --border-light:       rgba(255, 255, 255, 0.10);
  --border-strong:      rgba(255, 255, 255, 0.16);
  --surface-warm:       rgba(255, 255, 255, 0.05);
  --scrim-hero: linear-gradient(
    to top,
    color-mix(in srgb, var(--color-bg-primary) 92%, transparent) 0%,
    color-mix(in srgb, var(--color-bg-primary) 55%, transparent) 38%,
    transparent 72%
  );

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.40);
  --shadow-md: 0 6px 24px rgba(0, 0, 0, 0.50);
  --shadow-lg: 0 12px 44px rgba(0, 0, 0, 0.60);
}

/* ===== 响应式页边距 ===== */
@media (min-width: 768px) {
  :root { --margin-page: 24px; }
}
@media (min-width: 1024px) {
  :root { --margin-page: 32px; }
}
```

### Tailwind 配置同步项

在现有 `tailwind.config.ts` 的 `extend` 中追加（其余保持不变）：

```ts
colors: {
  // …现有映射保留…
  elevated: 'var(--color-bg-elevated)',
  warm: 'var(--surface-warm)',
  lineStrong: 'var(--border-strong)',
},
boxShadow: {
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
},
transitionDuration: {
  fast: 'var(--duration-fast)',
  base: 'var(--duration-base)',
  slow: 'var(--duration-slow)',
},
```

---

## 3. 全局样式调整（global.css）

1. `.glass` 改用参数化变量：
   ```css
   .glass {
     background: var(--glass-tint);
     -webkit-backdrop-filter: saturate(var(--glass-saturate)) blur(var(--glass-blur));
     backdrop-filter: saturate(var(--glass-saturate)) blur(var(--glass-blur));
   }
   ```
2. 新增 `.page-fade`：路由内容进入动画。`opacity 0→1 + translateY(8px)→0`，`var(--duration-base)` `var(--ease-emphasized)`，挂在 `AppShell` 的 `<main>` 上（key 用 pathname 触发重放）。
3. 新增 `.skeleton-shimmer`：骨架屏微光。底色 `var(--color-bg-secondary)`，其上一层 `linear-gradient(100deg, transparent, var(--surface-warm), transparent)` 从左向右扫过 1200ms 循环；reduced-motion 下静止。
4. 新增全局 `:focus-visible` 样式：`:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: inherit; }`（对已有 outline-none 的按钮/链接生效，保证键盘可达）。
5. `.hover-lift:hover` 数值修订为 `translateY(-4px) scale(1.02)` 不变，阴影升级为 `var(--shadow-md)`；`.hover-lift:active` 维持 `scale(0.98)`。

---

## 4. 组件级规范

### 4.1 Hero 精选区（新增组件 `components/media/Hero.tsx`）

数据源：首页 sections 中第一个分区的第 1 个条目（有 `backdropPath` 时才渲染 Hero，否则整区不渲染、列表顶到页首）。

| 属性 | 规格 |
|---|---|
| 容器 | 相对定位，`overflow-hidden`，`border-radius: var(--radius-lg)` (24px)，`margin-bottom: 24px` |
| 尺寸比例 | 移动端：`aspect-ratio: 3 / 4`（竖构图更沉浸），`max-height: 520px`；`≥ md`：`aspect-ratio: 21 / 9`；`≥ xl`：`max-height: 480px` |
| 背景图 | `https://image.tmdb.org/t/p/w1280{backdropPath}`，`object-cover` 全覆盖；`≥ lg` 可换 `w780` 以上原图 |
| 压暗层 | `absolute inset-0`，`background: var(--scrim-hero-dim)` |
| 底部渐变遮罩 | `absolute inset-x-0 bottom-0 h-[70%]`，`background: var(--scrim-hero)` |
| 文字排布 | 左下角对齐，`padding: 20px`（md 及以上 28px）。层级自下而上：标题（`type-large-title`，白色 `#FFFFFF`，`text-shadow: 0 2px 8px rgba(0,0,0,0.35)`）→ 元信息行（年份 · 类型，13px，rgba(255,255,255,0.8)）→ 评分胶囊 → 入口按钮 |
| 评分胶囊 | 见 §4.2 玻璃胶囊样式 |
| 入口按钮 | 「查看详情」filled 按钮（accent 底白字），点击跳 `/detail/{type}/{id}`；整张 Hero 图片区域也可点击（Link 包裹，aria-label 为「查看《片名》详情」） |
| 图片切换 | 若做轮播（可选增强）：多张精选轮播，`--duration-slow` + `--ease-emphasized` 淡切，指示点为 6px 圆点（激活态 accent 色）；P1 可只做单张静态 |
| 无障碍 | 背景图 `alt=""` `aria-hidden`；文字对比度由压暗层保证 ≥ 4.5:1 |

### 4.2 海报卡片（MediaCard 重塑）

| 断点 | 卡片宽度 | 布局方式 |
|---|---|---|
| `< md` | 固定 `128px` | MediaRow 内横滑 |
| `md – lg` | 固定 `148px` | MediaRow 内横滑 |
| `≥ lg`（网格模式） | 由网格列数决定（见 §4.3） | 自动撑满 |

结构规格：

1. **海报容器**：`position relative`，`aspect-ratio: 2 / 3`，`overflow-hidden`，`border-radius: var(--radius-card)` (18px)，底色 `var(--color-bg-secondary)`，`box-shadow: var(--shadow-sm)`。
2. **海报图**：`w342` 尺寸不变；hover 时 `scale(1.05)`（`--duration-base` `--ease-out`）；无海报走 `PosterFallback`（圆角同步改 `var(--radius-card)`）。
3. **评分胶囊（新增，核心 Forward 元素）**：
   - 位置：`absolute left-2 bottom-2`（8px）。
   - 材质：`background: var(--overlay-capsule-bg)` + `backdrop-filter: blur(12px)` + `border: 1px solid var(--overlay-capsule-border)`，`border-radius: var(--radius-pill)`，`padding: 3px 8px`。
   - 内容：`ri-star-fill` 图标 11px（颜色 `#FFB800`？否——用 `var(--overlay-capsule-text)` 白色或语义色，见下）+ 分值文本 11px `font-semibold tabular-nums`。
   - 分值语义色（沿用 RatingBadge 规则，但胶囊内文字默认白色）：≥8.0 用 `var(--color-success)`、<6.0 用 `var(--color-danger)`、其余 `var(--overlay-capsule-text)`。
   - 条目无评分时不渲染胶囊（不要显示空壳）。
4. **标题/元信息**：海报下方保留现有「标题 + 年份」两行结构不变（横滑模式下这是主要文字信息）；网格模式下同样适用。
5. **交互**：外层 Link 保留 `hover-lift`；新增 `focus-visible` 时给海报容器加 `var(--focus-ring)`。
6. **触控目标**：整卡可点已满足 44×44。

### 4.3 MediaRow 横滑行 ↔ 桌面网格（响应式策略）

同一组件内做断点切换，不拆两个组件：

```
<section>
  <header> 分区标题(type-headline) + 更多入口 </header>

  <!-- < lg：横滑流 -->
  <div class="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-2
              snap-x snap-mandatory
              lg:grid lg:snap-none lg:overflow-visible lg:mx-0 lg:px-0
              lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
    {items.slice(0, lg ? 10 : Infinity).map(MediaCard)}
  </div>
</section>
```

- 移动端横滑必须加 `scroll-snap`（`snap-x snap-mandatory` + 卡片 `snap-start`），模拟 Forward 原生翻页手感；每页吸附间距 = 卡宽 + `--gap-card`。
- `≥ lg` 转为网格：`lg:grid-cols-4`、`xl:grid-cols-5`、`2xl:grid-cols-6`，`gap: 16px 16px`；此时隐藏横向滚动行为（`lg:overflow-visible`），卡片宽度自适应。
- 桌面端每个分区最多渲染 10 个条目，超出部分交给右侧「更多」入口（`ri-arrow-right-s-line` 20px + 「更多」，跳搜索页并带关键词预填，P1 可先只展示不跳转）。
- 分区标题行：标题左侧新增 4px×16px accent 竖条？**否——禁止侧条纹边框**。改为：标题保持纯文字 `type-headline`，「更多」入口用 `text-txt-secondary hover:text-txt-primary transition-colors duration-fast`。

### 4.4 底部 TabBar（移动端）与桌面 Sidebar

**TabBar**（`< md` 显示）：

- 结构不变（fixed 悬浮 + 安全区 padding），材质升级：
  - 外形容器：`mx-4 mb-4`（原 mx-3 mb-3），`rounded-pill`（全胶囊形，更贴近 Forward 悬浮 Dock），`padding: 6px`。
  - 玻璃：`.glass` + `border: 1px solid var(--border-light)` + `box-shadow: var(--shadow-md)`。
- 每个 Tab：`flex-1 flex-col items-center gap-0.5 py-2 min-h-[52px]`；图标 24px（fill 态）/ line 态 24px；文字 10px。
- 激活态：图标+文字 `var(--color-accent)`；非激活 `var(--text-secondary)`。激活 Tab 增加一个 `background: var(--surface-warm)` 圆角胶囊底（`rounded-pill`），过渡 `--duration-fast`。
- 每个图标配 `aria-hidden`，NavLink 自身文字即无障碍名称。

**Sidebar**（`≥ md` 显示）：

- 宽度维持 232px；GlassPanel 材质不变，内部调整：
  - 品牌行：`ri-film-fill` 24px accent 色 + 「CineOne」`type-headline`，不变。
  - 导航项激活态：`background: color-mix(in srgb, var(--color-accent) 14%, transparent)`（替代现在的 `var(--nav-bg)`，激活感更强），文字与图标 accent 色；非激活 hover 用 `var(--surface-warm)`。
  - 高度 44px、图标 20px、圆角 `var(--radius-sm)` 维持。
  - 底部用户区维持现状（头像字母块 + 用户名 + 登出按钮）。

**TopBar**：

- 保持 sticky 毛玻璃。修订：滚动超过 80px 后增加 `border-bottom: 1px solid var(--border-light)`（监听 scroll 或用 IntersectionObserver sentinel），未滚动时无边框——让内容从 TopBar 下方穿过时更有层次。
- 其余（搜索/主题/用户菜单按钮 36px 圆形）维持。

### 4.5 基础组件调整清单

| 组件 | 调整项 |
|---|---|
| Button | 五态变体保留；`filled` hover 改为亮度变化而非 opacity：`hover:bg-[color:color-mix(in_srgb,var(--color-accent)_88%,_black)]`（或封装 `--accent-hover` 变量）；高度维持 44px；圆角 `var(--radius-md)`→改 `var(--radius-sm)` (12px) 更贴 Forward 按钮 |
| InputField | label 取消 `uppercase tracking-wide`（中文场景大写无意义），改 `text-[13px] font-medium text-txt-secondary`；输入框高度 44px、`bg: var(--color-bg-card)`、`border-color: var(--border-light)`，focus 边框 accent + `box-shadow: var(--focus-ring)` 双反馈 |
| ProgressBar | 轨道高度 1.5→`6px`，轨道色 `var(--surface-warm)`；填充色保留 accent，末端加 `border-radius: var(--radius-pill)` 不变；百分比数字 `tabular-nums` 维持 |
| RatingBadge | 详情页四源胶囊维持现逻辑；仅视觉统一：`border-color: var(--border-light)`、`bg: var(--color-bg-card)`、高度 `28px`、字号 13px 不变 |
| SegmentedControl | 容器 `bg: var(--surface-warm)`（替代 bg-surface 更轻）；选中滑块 `bg: var(--color-bg-elevated)` + `var(--shadow-sm)`；高度 36px 维持 |
| Switch | iOS 开关尺寸不变；开启色从 success 绿改为 accent 蓝（`checked ? var(--color-accent)`），更符合品牌单强调色策略 |
| Spinner | 维持 |
| GlassPanel | 增加 `radiusClass?: string` prop（默认 `rounded-lg`），供 TabBar 传 pill；其余不变 |
| PosterFallback | 圆角改 `var(--radius-card)`；图标换 `ri-film-line` 28px；背景加一层 `var(--surface-warm)` 内描边质感 |

---

## 5. 各页面改造要点清单

### 5.1 HomePage（首页）
- **新增 Hero 区**（§4.1）：sections[0].items[0] 有 backdropPath 时渲染于页面顶部，位于所有 MediaRow 之上。
- Hero 之下按原有四大分区渲染 MediaRow；首个分区若已被 Hero 消费第 1 项，剩余条目照常渲染（不移除，避免列表缺首项的突兀）。
- Loading 态从单一 Spinner 改为**骨架屏组合**：Hero 骨架（21/9 圆角 24px 色块 shimmer）+ 每分区标题条（120×16px）+ 卡片骨架 ×6（128px 宽 2/3 比例），全部套 `.skeleton-shimmer`。
- 引导分支（未配置 Key）与错误分支：GlassPanel 卡片圆角自动继承新 token，文案不变。

### 5.2 DetailPage（详情页）
- **头图区升级为 Hero 化**：现有 200px minHeight 横幅改为 `aspect-ratio 21/9`（`< md` 为 `4/3`），复用 `--scrim-hero` + `--scrim-hero-dim` 双层遮罩；海报图从 `hidden sm:block w-[160px]` 改为 `w-[120px] md:w-[160px]` 并加 `var(--shadow-lg)` 投影浮出感。
- 标题排布：标题移到遮罩层内左下角（同 Hero 规范），类型 pills 改为玻璃小胶囊（`var(--overlay-capsule-bg)` 底 + 白字，11px）。
- 四源评分卡 / 追剧卡：GlassPanel 圆角随 token；追剧状态 SegmentedControl 按 §4.5 更新。
- 演职员头像：圆角 `var(--radius-md)`，hover 加 `translateY(-2px)` 微浮。
- `window.prompt/alert` 的管理员修正交互保持不变（功能性，不在本次范围）。

### 5.3 SearchPage（搜索页）
- 搜索框：高度 44px 维持，`border-radius: var(--radius-pill)` 改为**胶囊形搜索框**（Forward 感更强），左图标 `ri-search-line` 18px 维持。
- 结果网格列数与 MediaCard 网格策略对齐：`grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6`，`gap-x-4 gap-y-6`（原来是 2 列起步，手机上海报太小）。
- 空态/初始态插画卡维持 GlassPanel 结构，图标换 `ri-search-eye-line` 不变，文案维持。

### 5.4 WatchlistPage（追剧页）
- 状态过滤 chips：维持 pill 形态；激活态从实心 accent 改为 `background: var(--surface-warm)` + 文字 accent + `border: 1px solid var(--color-accent)` 描边款（降低大面积强调色占比，符合每屏 ≤2 处 accent 原则——此处与进度条形成两处）。
- 列表卡片：海报宽 80px 维持；卡片圆角随 token；进度条按 §4.5 更新为 6px。
- 空态文案与「去逛逛 →」入口维持（箭头字符属于文案标点，不是图标，可接受；如需严格化可换 `ri-arrow-right-line` 14px inline）。

### 5.5 SettingsPage（设置页）
- Switch 开启色改 accent 蓝（§4.5）。
- 外观分区：将「深色模式」开关扩展为三选项 SegmentedControl（浅色 / 深色 / 跟随系统）——需 ThemeContext 支持 system 档；P1 若不改 Context，则保留开关，仅更新配色。
- 各 Section 卡片圆角随 token；notice 提示条维持。

### 5.6 LoginPage（登录页）
- 登录卡维持居中布局；卡片圆角 `var(--radius-lg)`、`var(--shadow-lg)`。
- **氛围增强（低成本高感知）**：卡片背后加一层模糊光斑装饰——两个大尺寸 `blur(80px)` 色块（accent 色 opacity 0.10 与 success 色 opacity 0.08，均通过 `color-mix(in srgb, var(--color-accent) 10%, transparent)` 实现），营造影院灯光氛围但不喧宾夺主；reduced-motion 下无动画即可。
- 表单控件按 §4.5 InputField 更新。

### 5.7 SetupPage（初始化页）
- 左侧面板：PosterFallback 占位替换为一段静态「海报墙拼贴」装饰（3 张 2/3 比例色块错位排列，`var(--color-bg-card)` 与 `var(--surface-warm)` 交替，纯装饰 `aria-hidden`），比单个占位图更贴合媒体库主题。
- 右侧表单区按 InputField/Button 新规范；「欢迎来到 CineOne」标题文案保留（具体动作导向，非空洞占位）。

---

## 6. 移动端 ↔ 桌面端适配策略汇总表

| 维度 | 移动端 `< md (<768px)` | 平板 `md–lg (768–1023px)` | 桌面 `≥ lg (≥1024px)` |
|---|---|---|---|
| 导航 | 底部悬浮胶囊 TabBar（毛玻璃 + safe-area） | Sidebar 出现（232px），TabBar 隐藏 | Sidebar，TopBar 吸顶加滚动态描边 |
| 页边距 | `--margin-page: 16px` | 24px | 32px |
| Hero | 3/4 竖构图，max-h 520px | 21/9 | 21/9，max-h 480px |
| 内容流 | MediaRow 横滑 + snap | 横滑 + snap（卡宽 148px） | 转网格：lg 4 列 / xl 5 列 / 2xl 6 列，gap 16px |
| 海报卡宽 | 128px 固定 | 148px 固定 | 网格自适应 |
| 搜索结果 | 3 列网格 | 4 列 | 5–6 列 |
| 触控目标 | 全部 ≥44×44，Tab 高 52px | 同左 | hover 态接管（仍保 focus-visible 键盘可达） |
| 弹层/菜单 | 跟手浮层（用户菜单维持 absolute 下拉） | 同左 | 同左 |

通用约束：无横向页面级滚动（横滑仅发生在 MediaRow 内部）；viewport meta 已含；图片全部 `loading="lazy"` + 固定 `aspect-ratio` 防 CLS。

---

## 7. 动效规范

| 场景 | 时长 | 缓动 | 备注 |
|---|---|---|---|
| hover 变色 / 图标切换 | 150ms (`--duration-fast`) | `--ease-out` | 颜色/opacity 类属性 |
| 按压反馈（press-spring） | 150ms | `--ease-spring` | scale 0.96–0.98，轻微回弹允许 |
| 卡片 hover 浮起 | 200–250ms | `--ease-out` | translateY(-4px)+scale(1.02)+shadow 升级；禁用 width/height 动画 |
| 页面进入（page-fade） | 250ms (`--duration-base`) | `--ease-emphasized` | opacity+translateY(8px)；仅路由切换时触发一次 |
| 浮层/下拉菜单出现 | 200ms | `--ease-emphasized` | opacity + translateY(-4px)→0 |
| Hero 图切换（如做轮播） | 350ms (`--duration-slow`) | `--ease-emphasized` | 交叉淡入淡出 |
| 骨架屏微光 | 1200ms 循环 | linear | shimmer 扫光 |
| 主题切换 | 250ms | `--ease-out` | 沿用现有 theme-transition |

强制项：
- 所有动画组件必须在 `prefers-reduced-motion: reduce` 下降级（现有 global.css 的全局 reduce 块保留即可覆盖）。
- 禁止弹跳过冲曲线 `cubic-bezier(0.68, -0.55, 0.265, 1.55)`；`--ease-spring` 仅用于按压反馈，不得用于页面转场。
- 动效只传达含义（层级、空间、状态），不加纯装饰循环动画（骨架屏 shimmer 除外，它传达加载状态）。

---

## 8. P0 合规自查声明

1. **无 emoji 功能图标**：全文图标均为 remixicon 名称（`ri-star-fill`、`ri-arrow-right-s-line` 等）。
2. **无紫→粉渐变**：主色为 iOS 蓝 `#0071E3`/`#0A84FF` 纯色；Hero 遮罩为「背景色→透明」的同色系渐变，登录页光斑为 accent/success 低透明度模糊色块，均不含 Indigo→Pink 组合。
3. **无空洞占位文案**：所有示例文案均为现有真实业务文案。
4. **无硬编码颜色**：除 `#FFFFFF`（Hero 标题、胶囊文字、Button filled 前景）与基于 Token 的 `rgba()/color-mix()` 透明度叠加外，全部经 CSS 变量引用。
5. **无过冲弹跳缓动**：`--ease-spring` 为任务明确允许保留的轻回弹。
