import {
  Activity,
  BarChart3,
  Calculator,
  Cpu,
  Dices,
  FileText,
  FlaskConical,
  Gamepad2,
  Gauge,
  GraduationCap,
  Layout,
  Mail,
  Map,
  Music,
  Palette,
  PieChart,
  Terminal,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";

export interface UseCase {
  icon: LucideIcon;
  iconColor: string;
  title: string;
  desc: string;
  prompt: string;
  tool: "python" | "js" | "html" | "multi";
}

export interface UseCaseCategory {
  titleKey: string;
  cases: UseCase[];
}

const enUseCaseCategories: UseCaseCategory[] = [
  {
    titleKey: "coding.useCategoryDataViz",
    cases: [
      {
        icon: BarChart3,
        iconColor: "text-purple-500",
        title: "Stock Price Candlestick Chart",
        desc: "Generate a realistic 30-day candlestick chart with volume bars using matplotlib and mplfinance.",
        prompt: "Use Python to generate a 30-day simulated stock candlestick chart (OHLCV data) with volume bars at the bottom. Use mplfinance or matplotlib. Make it look professional with a dark background theme.",
        tool: "python",
      },
      {
        icon: PieChart,
        iconColor: "text-blue-500",
        title: "World GDP Pie Chart",
        desc: "Visualize the top 10 countries by GDP with a donut-style pie chart and percentage labels.",
        prompt: "Create a donut pie chart of the top 10 countries by GDP (use approximate 2024 data). Show percentage labels, use distinct colors for each country, and add a title. Use matplotlib.",
        tool: "python",
      },
      {
        icon: TrendingUp,
        iconColor: "text-green-500",
        title: "Multi-Line Trend Comparison",
        desc: "Compare the growth trends of 5 tech companies over 12 months with an annotated line chart.",
        prompt: "Plot a multi-line chart comparing the stock price trends of Apple, Google, Microsoft, Amazon, and Tesla over the past 12 months (use simulated realistic data). Add a legend, grid, and annotate the highest point for each company.",
        tool: "python",
      },
      {
        icon: Activity,
        iconColor: "text-red-500",
        title: "Real-Time Sensor Dashboard",
        desc: "Generate a 4-panel dashboard showing temperature, humidity, pressure, and wind speed over 24 hours.",
        prompt: "Use matplotlib to create a 2x2 subplot dashboard simulating 24 hours of IoT sensor data: temperature (°C), humidity (%), barometric pressure (hPa), and wind speed (km/h). Use different colors per panel, add grid lines, and make it look like a monitoring dashboard.",
        tool: "python",
      },
      {
        icon: Map,
        iconColor: "text-teal-500",
        title: "Heatmap Correlation Matrix",
        desc: "Build a seaborn heatmap showing correlations between 8 financial indicators.",
        prompt: "Generate a seaborn heatmap showing the correlation matrix of 8 financial indicators (GDP Growth, Inflation, Unemployment, Interest Rate, S&P 500, Gold Price, Oil Price, USD Index). Use simulated realistic correlation data. Annotate each cell with the correlation value.",
        tool: "python",
      },
    ],
  },
  {
    titleKey: "coding.useCategoryWebDev",
    cases: [
      {
        icon: Layout,
        iconColor: "text-indigo-500",
        title: "Responsive Pricing Page",
        desc: "A fully responsive SaaS pricing page with 3 tiers, feature comparison, and hover animations.",
        prompt: "Create a responsive SaaS pricing page with 3 tiers (Free, Pro, Enterprise). Include feature comparison checkmarks, a highlighted 'Most Popular' badge on Pro, hover scale animations, gradient header, and a modern dark theme. All CSS inline, no external dependencies.",
        tool: "html",
      },
      {
        icon: Palette,
        iconColor: "text-pink-500",
        title: "Interactive Color Palette Generator",
        desc: "A web app that generates harmonious color palettes with copy-to-clipboard hex codes.",
        prompt: "Build an interactive color palette generator in a single HTML file. It should: generate 5 harmonious colors on button click, display each as a large swatch with hex code, allow clicking any swatch to copy the hex to clipboard, show a toast notification on copy, and include a 'Regenerate' button with a smooth transition animation.",
        tool: "html",
      },
      {
        icon: FileText,
        iconColor: "text-orange-500",
        title: "Markdown Live Editor",
        desc: "A split-pane Markdown editor with real-time preview, syntax highlighting, and GitHub-flavored rendering.",
        prompt: "Create a split-pane Markdown editor in a single HTML page. Left side: textarea for writing Markdown. Right side: live rendered preview. Include GitHub-flavored Markdown support (tables, code blocks, task lists). Use a CDN library like marked.js. Add a dark/light theme toggle button. Style it beautifully.",
        tool: "html",
      },
      {
        icon: Gauge,
        iconColor: "text-cyan-500",
        title: "Animated KPI Dashboard",
        desc: "A dashboard with animated counters, progress rings, and sparkline mini-charts.",
        prompt: "Build a KPI dashboard in a single HTML file with: 4 metric cards (Revenue $2.4M, Users 18.5K, Conversion 3.2%, Growth +24%), each with an animated counting number on load, a circular SVG progress ring, and a tiny inline sparkline chart below. Use CSS animations, no external libraries. Dark glassmorphism theme.",
        tool: "html",
      },
    ],
  },
  {
    titleKey: "coding.useCategoryAutomation",
    cases: [
      {
        icon: Terminal,
        iconColor: "text-green-500",
        title: "JSON Data Transformer",
        desc: "Parse, transform, and restructure complex nested JSON in the sandbox.",
        prompt: "I have this nested JSON data representing an e-commerce order: {\"order\":{\"id\":\"ORD-2024-001\",\"items\":[{\"name\":\"Laptop\",\"price\":999,\"qty\":1},{\"name\":\"Mouse\",\"price\":29,\"qty\":2},{\"name\":\"Keyboard\",\"price\":79,\"qty\":1}],\"customer\":{\"name\":\"John Doe\",\"address\":{\"city\":\"San Francisco\",\"state\":\"CA\"}}}}. Write Python code to: 1) Calculate total order value, 2) Generate a formatted invoice text, 3) Convert to a flat CSV-friendly structure, 4) Print everything.",
        tool: "python",
      },
      {
        icon: Mail,
        iconColor: "text-yellow-500",
        title: "Email Template Generator",
        desc: "Generate a responsive HTML email template with dynamic placeholders.",
        prompt: "Generate a professional responsive HTML email template for a product launch announcement. Include: company logo placeholder, hero image area, product name 'SuperApp 2.0', 3 feature highlights with icons (use emoji), a prominent CTA button 'Get Started Free', footer with unsubscribe link. Must be email-client compatible (use tables for layout). Give me the preview link.",
        tool: "html",
      },
      {
        icon: Cpu,
        iconColor: "text-slate-500",
        title: "System Performance Report",
        desc: "Simulate a system benchmark, generate stats, and output a formatted report.",
        prompt: "Write Python code that simulates a system performance benchmark: 1) CPU test: time 1 million iterations of math operations, 2) Memory test: allocate and measure different sized arrays, 3) Sort benchmark: compare bubble sort vs Python's built-in sort on 10000 random numbers, 4) Print a beautifully formatted report with execution times, comparisons, and a verdict.",
        tool: "python",
      },
      {
        icon: FileText,
        iconColor: "text-amber-500",
        title: "CSV Report Generator",
        desc: "Generate a sales report CSV from raw data with aggregations and summary statistics.",
        prompt: "Write Python code that: 1) Creates a simulated sales dataset with 100 rows (Date, Product, Region, Quantity, UnitPrice, Total), 2) Uses pandas to calculate: total revenue by product, monthly trends, top region, best selling product, 3) Prints a well-formatted summary report with all insights. Make the output human-readable and insightful.",
        tool: "python",
      },
    ],
  },
  {
    titleKey: "coding.useCategoryMath",
    cases: [
      {
        icon: Calculator,
        iconColor: "text-violet-500",
        title: "Fractal Art Generator",
        desc: "Render a high-resolution Mandelbrot set fractal with custom color mapping.",
        prompt: "Generate a Mandelbrot set fractal image using Python and matplotlib. Use a 1000x1000 resolution, 100 max iterations, custom colormap (hot or twilight_shifted), and zoom into an interesting region like the seahorse valley (center: -0.75+0.1j, range: 0.3). The output should be a visually stunning PNG image.",
        tool: "python",
      },
      {
        icon: FlaskConical,
        iconColor: "text-emerald-500",
        title: "Physics Simulation Visualization",
        desc: "Simulate and plot projectile trajectories with different launch angles, including air resistance.",
        prompt: "Write Python code to simulate projectile motion with air resistance. Plot the trajectories of 5 projectiles launched at angles 15°, 30°, 45°, 60°, 75° with the same initial velocity of 50 m/s. Show both the ideal (no air resistance) and realistic (with drag coefficient 0.47) trajectories. Label each arc with its angle and range. Use matplotlib with a clean, publication-quality style.",
        tool: "python",
      },
      {
        icon: GraduationCap,
        iconColor: "text-sky-500",
        title: "Interactive Math Quiz",
        desc: "A web-based math quiz with timer, scoring, difficulty levels, and animated feedback.",
        prompt: "Build an interactive math quiz game in a single HTML page. Features: 3 difficulty levels (Easy: +/-, Medium: ×/÷, Hard: mixed with larger numbers), a 30-second countdown timer per question, score tracking with streak bonus, animated correct/wrong feedback (green flash / red shake), final score summary with grade (A-F). Beautiful gradient UI, responsive design.",
        tool: "html",
      },
      {
        icon: TrendingUp,
        iconColor: "text-rose-500",
        title: "Statistical Distribution Explorer",
        desc: "Visualize and compare Normal, Poisson, Binomial, and Exponential distributions side by side.",
        prompt: "Create a 2x2 subplot figure in Python showing 4 statistical distributions: Normal (μ=0, σ=1), Poisson (λ=5), Binomial (n=20, p=0.5), and Exponential (λ=1). For each: plot the histogram of 10000 samples overlaid with the theoretical PDF/PMF curve. Show mean and std in each subplot title. Use scipy.stats and matplotlib. Professional styling.",
        tool: "python",
      },
    ],
  },
  {
    titleKey: "coding.useCategoryCreative",
    cases: [
      {
        icon: Dices,
        iconColor: "text-fuchsia-500",
        title: "Conway's Game of Life",
        desc: "An interactive HTML implementation of Conway's Game of Life with play/pause, speed control, and patterns.",
        prompt: "Build Conway's Game of Life in a single HTML file. Features: a 40x40 grid rendered on canvas, click cells to toggle alive/dead, play/pause button, speed slider, step button, random fill button, clear button, generation counter, preset patterns (glider, blinker, pulsar) that can be placed by selecting from a dropdown. Minimal dark UI with neon green cells.",
        tool: "html",
      },
      {
        icon: Music,
        iconColor: "text-amber-500",
        title: "Audio Waveform Visualizer",
        desc: "A visual representation of different audio waveforms (sine, square, sawtooth, triangle).",
        prompt: "Create an HTML page that visualizes audio waveforms. Use Canvas to draw 4 different wave types side by side: Sine, Square, Sawtooth, and Triangle waves. Animate them scrolling horizontally. Let the user adjust frequency and amplitude with sliders. Use vibrant colors on a dark background. No Web Audio API needed — just mathematical visualization.",
        tool: "html",
      },
      {
        icon: Gamepad2,
        iconColor: "text-lime-500",
        title: "Snake Game",
        desc: "A classic Snake game playable in the browser with score, speed progression, and a game-over screen.",
        prompt: "Build a classic Snake game in a single HTML file. Use canvas for rendering. Features: arrow key controls, growing snake, random food spawning, score counter, speed increases every 5 points, game over screen with final score and restart button, subtle grid background, smooth movement animation. Retro pixel style with a modern twist.",
        tool: "html",
      },
      {
        icon: Palette,
        iconColor: "text-rose-500",
        title: "Generative Art: Spiral Galaxy",
        desc: "Generate a spiral galaxy image with thousands of stars using mathematical curves.",
        prompt: "Write Python code to generate a spiral galaxy image using matplotlib. Create 2 spiral arms with 5000 stars each using logarithmic spiral equations with random scatter. Add a bright central core (2D gaussian), background stars (random dots), and use a dark background with warm golden/blue star colors. Use scatter plot with varying sizes and alphas. Make it look like a real galaxy photograph. Output as a high-quality PNG.",
        tool: "python",
      },
    ],
  },
];

const zhUseCaseCategories: UseCaseCategory[] = [
  {
    titleKey: "coding.useCategoryDataViz",
    cases: [
      {
        icon: BarChart3,
        iconColor: "text-purple-500",
        title: "股票蜡烛图",
        desc: "用 matplotlib 或 mplfinance 生成逼真的 30 天 K 线图，并带成交量柱状图。",
        prompt: "请使用 Python 生成一张模拟的 30 天股票蜡烛图（OHLCV 数据），底部带成交量柱状图。可使用 mplfinance 或 matplotlib。整体视觉要专业，采用深色背景主题。",
        tool: "python",
      },
      {
        icon: PieChart,
        iconColor: "text-blue-500",
        title: "全球 GDP 环形图",
        desc: "用环形饼图展示 GDP 前 10 国家及其占比标签。",
        prompt: "请创建一张全球 GDP 前 10 国家环形饼图（使用近似的 2024 年数据）。显示百分比标签，每个国家使用不同颜色，并添加标题。使用 matplotlib。",
        tool: "python",
      },
      {
        icon: TrendingUp,
        iconColor: "text-green-500",
        title: "多公司趋势对比图",
        desc: "对比 5 家科技公司 12 个月增长趋势，并标注每条线的高点。",
        prompt: "请绘制一张多折线图，对比 Apple、Google、Microsoft、Amazon 和 Tesla 过去 12 个月的股价趋势（使用模拟但合理的数据）。添加图例、网格，并标注每家公司的最高点。",
        tool: "python",
      },
      {
        icon: Activity,
        iconColor: "text-red-500",
        title: "实时传感器监控面板",
        desc: "生成一个 4 面板仪表盘，展示 24 小时温度、湿度、气压和风速变化。",
        prompt: "请使用 matplotlib 创建一个 2x2 子图监控面板，模拟 24 小时 IoT 传感器数据：温度（°C）、湿度（%）、气压（hPa）和风速（km/h）。每个面板使用不同颜色并带网格线，整体像监控仪表盘。",
        tool: "python",
      },
      {
        icon: Map,
        iconColor: "text-teal-500",
        title: "相关性热力图矩阵",
        desc: "用 seaborn 热力图展示 8 个金融指标之间的相关性。",
        prompt: "请生成一个 seaborn 热力图，展示 8 个金融指标（GDP 增长、通胀、失业率、利率、标普 500、黄金价格、油价、美元指数）的相关性矩阵。使用模拟但合理的相关数据，并在每个单元格中标注相关系数。",
        tool: "python",
      },
    ],
  },
  {
    titleKey: "coding.useCategoryWebDev",
    cases: [
      {
        icon: Layout,
        iconColor: "text-indigo-500",
        title: "响应式价格页",
        desc: "一个完整响应式的 SaaS 价格页面，含 3 档套餐、功能对比和悬浮动画。",
        prompt: "请创建一个响应式 SaaS 价格页，包含 3 个套餐（Free、Pro、Enterprise）。需要有功能对比勾选项、Pro 套餐的“Most Popular”高亮徽章、hover 放大动画、渐变页头，以及现代深色主题。所有 CSS 内联，不使用外部依赖。",
        tool: "html",
      },
      {
        icon: Palette,
        iconColor: "text-pink-500",
        title: "交互式配色生成器",
        desc: "一个生成和复制和谐色板的网页工具。",
        prompt: "请用单个 HTML 文件构建一个交互式配色生成器。要求：点击按钮生成 5 个和谐颜色；每个颜色显示为大色块并展示十六进制值；点击任意色块可复制颜色值；复制后显示 toast 提示；包含一个“Regenerate”按钮并带平滑过渡动画。",
        tool: "html",
      },
      {
        icon: FileText,
        iconColor: "text-orange-500",
        title: "Markdown 实时编辑器",
        desc: "左右分栏的 Markdown 编辑器，带实时预览、代码高亮和 GitHub 风格渲染。",
        prompt: "请创建一个单页 Markdown 编辑器。左侧是 textarea 输入区，右侧是实时渲染预览。支持 GitHub Flavored Markdown（表格、代码块、任务列表）。使用 marked.js 之类的 CDN 库，并加入深色/浅色主题切换按钮。整体样式要精致。",
        tool: "html",
      },
      {
        icon: Gauge,
        iconColor: "text-cyan-500",
        title: "动态 KPI 仪表盘",
        desc: "一个带数字动效、进度环和迷你火花线图的仪表盘。",
        prompt: "请用单个 HTML 文件构建一个 KPI 仪表盘：包含 4 张指标卡（Revenue $2.4M、Users 18.5K、Conversion 3.2%、Growth +24%）；每张卡在加载时有数字增长动画、一个圆形 SVG 进度环，以及下方一条迷你 sparkline 图。仅使用 CSS 动画，不依赖外部库，整体为深色玻璃拟态风格。",
        tool: "html",
      },
    ],
  },
  {
    titleKey: "coding.useCategoryAutomation",
    cases: [
      {
        icon: Terminal,
        iconColor: "text-green-500",
        title: "JSON 数据转换器",
        desc: "在沙盒中解析、转换并重组复杂嵌套 JSON。",
        prompt: "我有一段表示电商订单的嵌套 JSON：{\"order\":{\"id\":\"ORD-2024-001\",\"items\":[{\"name\":\"Laptop\",\"price\":999,\"qty\":1},{\"name\":\"Mouse\",\"price\":29,\"qty\":2},{\"name\":\"Keyboard\",\"price\":79,\"qty\":1}],\"customer\":{\"name\":\"John Doe\",\"address\":{\"city\":\"San Francisco\",\"state\":\"CA\"}}}}。请编写 Python 代码来：1）计算订单总额；2）生成格式化发票文本；3）转换成适合 CSV 的扁平结构；4）打印所有结果。",
        tool: "python",
      },
      {
        icon: Mail,
        iconColor: "text-yellow-500",
        title: "邮件模板生成器",
        desc: "生成一个带动态占位符的响应式 HTML 邮件模板。",
        prompt: "请生成一个产品发布公告的专业响应式 HTML 邮件模板。包含：公司 Logo 占位、主视觉图区域、产品名 “SuperApp 2.0”、3 个功能亮点（图标可用 emoji）、醒目的 CTA 按钮 “Get Started Free”，以及带退订链接的页脚。需要兼容常见邮件客户端（使用 table 布局），并给我预览链接。",
        tool: "html",
      },
      {
        icon: Cpu,
        iconColor: "text-slate-500",
        title: "系统性能报告",
        desc: "模拟一套系统基准测试，生成统计信息并输出格式化报告。",
        prompt: "请编写 Python 代码模拟系统性能基准测试：1）CPU 测试：执行 100 万次数学运算并计时；2）内存测试：分配不同大小数组并测量耗时；3）排序测试：比较冒泡排序与 Python 内置排序在 10000 个随机数上的表现；4）打印一份格式美观、带结论的性能报告。",
        tool: "python",
      },
      {
        icon: FileText,
        iconColor: "text-amber-500",
        title: "CSV 销售报表生成器",
        desc: "从原始数据生成销售 CSV 报表，并给出汇总统计。",
        prompt: "请编写 Python 代码：1）创建一个 100 行的模拟销售数据集（Date、Product、Region、Quantity、UnitPrice、Total）；2）使用 pandas 计算产品总收入、月度趋势、最佳地区和畅销产品；3）输出一份可读性强、信息丰富的总结报告。",
        tool: "python",
      },
    ],
  },
  {
    titleKey: "coding.useCategoryMath",
    cases: [
      {
        icon: Calculator,
        iconColor: "text-violet-500",
        title: "分形艺术生成器",
        desc: "渲染高分辨率 Mandelbrot 集分形图，并支持自定义配色。",
        prompt: "请使用 Python 和 matplotlib 生成一张 Mandelbrot 集分形图像。分辨率为 1000x1000，最大迭代 100，使用 hot 或 twilight_shifted 自定义 colormap，并缩放到如 seahorse valley 一类的有趣区域（中心：-0.75+0.1j，范围：0.3）。输出应是一张视觉效果出色的 PNG 图像。",
        tool: "python",
      },
      {
        icon: FlaskConical,
        iconColor: "text-emerald-500",
        title: "物理抛体模拟可视化",
        desc: "模拟不同发射角度下含空气阻力的抛体轨迹。",
        prompt: "请编写 Python 代码模拟带空气阻力的抛体运动。绘制 5 个发射角度（15°、30°、45°、60°、75°）、相同初速度 50 m/s 下的轨迹。需要同时展示理想情况（无空气阻力）和现实情况（阻力系数 0.47），并在图中标注每条轨迹的角度和射程。使用 matplotlib，风格整洁、接近论文图表。",
        tool: "python",
      },
      {
        icon: GraduationCap,
        iconColor: "text-sky-500",
        title: "交互式数学测验",
        desc: "一个带倒计时、计分、难度选择和动画反馈的网页数学小游戏。",
        prompt: "请用单个 HTML 页面构建一个交互式数学测验游戏。功能包括：3 个难度等级（Easy：加减，Medium：乘除，Hard：混合大数）；每题 30 秒倒计时；带连击加成的分数统计；答对/答错动画反馈（绿色闪烁 / 红色抖动）；最终得分总结和 A-F 等级。界面要有漂亮的渐变风格，并适配移动端。",
        tool: "html",
      },
      {
        icon: TrendingUp,
        iconColor: "text-rose-500",
        title: "统计分布探索器",
        desc: "并排可视化 Normal、Poisson、Binomial 和 Exponential 分布。",
        prompt: "请创建一个 2x2 子图的 Python 图像，展示 4 种统计分布：Normal (μ=0, σ=1)、Poisson (λ=5)、Binomial (n=20, p=0.5)、Exponential (λ=1)。每个子图都画出 10000 个样本的直方图，并叠加理论 PDF/PMF 曲线，在标题中显示均值和标准差。使用 scipy.stats 和 matplotlib，整体风格要专业。",
        tool: "python",
      },
    ],
  },
  {
    titleKey: "coding.useCategoryCreative",
    cases: [
      {
        icon: Dices,
        iconColor: "text-fuchsia-500",
        title: "康威生命游戏",
        desc: "一个带播放/暂停、速度控制和预设图案的交互式生命游戏。",
        prompt: "请用单个 HTML 文件构建 Conway's Game of Life。功能包括：40x40 画布网格；点击切换细胞生死；播放/暂停按钮；速度滑杆；单步执行；随机填充；清空；世代计数器；可从下拉框选择 glider、blinker、pulsar 等预设图案并放置。界面风格为简洁深色 + 霓虹绿细胞。",
        tool: "html",
      },
      {
        icon: Music,
        iconColor: "text-amber-500",
        title: "音频波形可视化",
        desc: "展示正弦波、方波、锯齿波和三角波的动态可视化页面。",
        prompt: "请创建一个 HTML 页面来可视化音频波形。使用 Canvas 并排绘制 4 种波形：Sine、Square、Sawtooth、Triangle。让波形横向滚动动画，并允许用户通过滑杆调节频率和振幅。整体使用鲜艳颜色和深色背景。不需要 Web Audio API，只做数学可视化。",
        tool: "html",
      },
      {
        icon: Gamepad2,
        iconColor: "text-lime-500",
        title: "贪吃蛇游戏",
        desc: "浏览器可玩的经典贪吃蛇，带计分、速度升级和结束画面。",
        prompt: "请用单个 HTML 文件实现经典贪吃蛇。使用 canvas 渲染，要求包含：方向键控制、蛇身增长、随机食物、分数显示、每 5 分提速、游戏结束画面、最终得分和重新开始按钮、轻微网格背景、平滑移动动画。风格为复古像素 + 现代细节。",
        tool: "html",
      },
      {
        icon: Palette,
        iconColor: "text-rose-500",
        title: "生成艺术：螺旋星系",
        desc: "用数学曲线生成一张包含数千颗恒星的螺旋星系图。",
        prompt: "请编写 Python 代码生成一张螺旋星系图像。创建两条螺旋臂，每条 5000 颗恒星，使用对数螺旋方程并加入随机散点；加入明亮的中心核（2D 高斯）、背景星点，并使用深色背景和金色/蓝色星光配色。用 scatter 绘制，星点大小和透明度应有变化，整体要像真实星系照片。输出高质量 PNG。",
        tool: "python",
      },
    ],
  },
];

export function getUseCaseCategories(locale: Locale): UseCaseCategory[] {
  return locale === "zh" ? zhUseCaseCategories : enUseCaseCategories;
}
