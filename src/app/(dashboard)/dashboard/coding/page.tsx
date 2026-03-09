"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Code2,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  KeyRound,
  BookOpen,
  Lightbulb,
  BarChart3,
  Terminal,
  Globe,
  Boxes,
  Image as ImageIcon,
  AlertTriangle,
  Copy,
  TrendingUp,
  PieChart,
  Activity,
  Palette,
  Layout,
  FileText,
  Mail,
  Cpu,
  Dices,
  Music,
  Map,
  Gauge,
  Calculator,
  FlaskConical,
  GraduationCap,
  Gamepad2,
  type LucideIcon,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface UseCase {
  icon: LucideIcon;
  iconColor: string;
  title: string;
  desc: string;
  prompt: string;
  tool: "python" | "js" | "html" | "multi";
}

interface UseCaseCategory {
  titleKey: string;
  cases: UseCase[];
}

const USE_CASE_CATEGORIES: UseCaseCategory[] = [
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
        desc: "Parse, transform, and restructure complex nested JSON — a task that proves sandboxed code execution.",
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
        desc: "A classic Snake game playable in the browser with score, speed progression, and game over screen.",
        prompt: "Build a classic Snake game in a single HTML file. Use canvas for rendering. Features: arrow key controls, growing snake, random food spawning, score counter, speed increases every 5 points, game over screen with final score and restart button, subtle grid background, smooth movement animation. Retro pixel style with a modern twist.",
        tool: "html",
      },
      {
        icon: Palette,
        iconColor: "text-rose-500",
        title: "Generative Art: Spiral Galaxy",
        desc: "Generate a beautiful spiral galaxy image with thousands of stars using mathematical curves.",
        prompt: "Write Python code to generate a spiral galaxy image using matplotlib. Create 2 spiral arms with 5000 stars each using logarithmic spiral equations with random scatter. Add a bright central core (2D gaussian), background stars (random dots), and use a dark background with warm golden/blue star colors. Use scatter plot with varying sizes and alphas. Make it look like a real galaxy photograph. Output as a high-quality PNG.",
        tool: "python",
      },
    ],
  },
];

type Language = "python" | "javascript" | "html";

interface CodeResult {
  text?: string;
  png?: string;
  html?: string;
}

interface ExecutionOutput {
  stdout: string;
  stderr: string;
  results: CodeResult[];
  error?: string;
  previewUrl?: string;
  executionTimeMs: number;
}

export default function CodingPage() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<"e2b" | "github">("e2b");

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  const [language, setLanguage] = useState<Language>("python");
  const [code, setCode] = useState(t("coding.codePlaceholderPython"));
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<ExecutionOutput | null>(null);

  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [useCasesOpen, setUseCasesOpen] = useState(false);

  

  const checkConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/coding/e2b");
      const data = await res.json();
      setConfigured(data.configured ?? false);
    } catch {
      toast.error(t("coding.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    checkConfig();
  }, [checkConfig]);

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    if (lang === "python") setCode(t("coding.codePlaceholderPython"));
    else if (lang === "javascript") setCode(t("coding.codePlaceholderJS"));
    else setCode(t("coding.codePlaceholderHTML"));
    setOutput(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/coding/e2b", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(t("coding.e2bTestSuccess"));
      } else {
        toast.error(t("coding.e2bTestFailed", { error: data.error || "Unknown" }));
      }
    } catch {
      toast.error(t("coding.e2bTestFailed", { error: "Network error" }));
    } finally {
      setTesting(false);
    }
  };

  const handleSaveApiKey = async () => {
    const key = apiKeyInput.trim();
    if (!key) {
      toast.error(t("coding.e2bKeyRequired"));
      return;
    }
    setSavingKey(true);
    try {
      const res = await fetch("/api/admin/secrets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key_name: "E2B_API_KEY", value: key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(t("coding.e2bKeySaved"));
      setApiKeyInput("");
      setConfigured(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("coding.e2bKeySaveFailed"));
    } finally {
      setSavingKey(false);
    }
  };

  const handleRunCode = async () => {
    if (!code.trim()) return;
    setRunning(true);
    setOutput(null);
    try {
      const res = await fetch("/api/admin/coding/e2b/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Execution failed");
        return;
      }
      setOutput(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("coding.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("coding.subtitle")}</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        <button
          onClick={() => setActiveTab("e2b")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "e2b"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Code2 className="inline-block mr-1.5 size-4" />
          {t("coding.tabs.e2b")}
        </button>
        <button
          onClick={() => setActiveTab("github")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === "github"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("coding.tabs.github")}
        </button>
      </div>

      {activeTab === "github" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted">
              <Boxes className="size-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">{t("coding.tabs.github")}</p>
          </CardContent>
        </Card>
      )}

      {activeTab === "e2b" && (
        <div className="flex flex-col gap-6">
          {/* Configuration status card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <KeyRound className="size-5 text-muted-foreground" />
                <CardTitle>{t("coding.e2bConfigTitle")}</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {configured === null ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t("common.loading")}
                </div>
              ) : configured ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="secondary" className="gap-1 text-green-600 dark:text-green-400">
                      <CheckCircle2 className="size-3.5" />
                      {t("coding.e2bConfigured")}
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleTestConnection}
                      disabled={testing}
                    >
                      {testing ? (
                        <>
                          <Loader2 className="mr-1 size-3.5 animate-spin" />
                          {t("coding.e2bTesting")}
                        </>
                      ) : (
                        t("coding.e2bTestConnection")
                      )}
                    </Button>
                  </div>
                  {/* Allow updating the key even when already configured */}
                  <div className="flex items-end gap-2">
                    <div className="flex flex-col gap-1.5 flex-1 max-w-sm">
                      <Label className="text-xs text-muted-foreground">{t("coding.e2bUpdateKey")}</Label>
                      <Input
                        type="password"
                        placeholder={t("coding.e2bKeyPlaceholder")}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveApiKey}
                      disabled={savingKey || !apiKeyInput.trim()}
                    >
                      {savingKey ? t("common.saving") : t("common.save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="size-3.5" />
                      {t("coding.e2bNotConfigured")}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("coding.e2bConfigGuideInline")}
                  </p>
                  <div className="flex items-end gap-2">
                    <div className="flex flex-col gap-1.5 flex-1 max-w-md">
                      <Label>{t("coding.e2bKeyLabel")}</Label>
                      <Input
                        type="password"
                        placeholder={t("coding.e2bKeyPlaceholder")}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                      />
                    </div>
                    <Button
                      onClick={handleSaveApiKey}
                      disabled={savingKey || !apiKeyInput.trim()}
                    >
                      {savingKey ? (
                        <>
                          <Loader2 className="mr-1.5 size-4 animate-spin" />
                          {t("common.saving")}
                        </>
                      ) : (
                        t("coding.e2bSaveKey")
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("coding.e2bKeyHint")}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tutorial card (collapsible) */}
          <Card>
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => setTutorialOpen(!tutorialOpen)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="size-5 text-muted-foreground" />
                  <CardTitle>{t("coding.tutorialTitle")}</CardTitle>
                </div>
                {tutorialOpen ? (
                  <ChevronUp className="size-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-5 text-muted-foreground" />
                )}
              </div>
            </CardHeader>
            {tutorialOpen && (
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-medium text-sm flex items-center gap-1.5">
                    <KeyRound className="size-4 text-primary" />
                    {t("coding.tutorialGetKey")}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("coding.tutorialGetKeyDesc")}
                  </p>
                  <a
                    href="https://e2b.dev/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    e2b.dev/dashboard <ExternalLink className="size-3" />
                  </a>
                </div>
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-medium text-sm flex items-center gap-1.5">
                    <AlertTriangle className="size-4 text-amber-500" />
                    {t("coding.tutorialHobbyLimits")}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("coding.tutorialHobbyLimitsDesc")}
                  </p>
                </div>
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-medium text-sm flex items-center gap-1.5">
                    <Globe className="size-4 text-blue-500" />
                    {t("coding.tutorialServerless")}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("coding.tutorialServerlessDesc")}
                  </p>
                </div>
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-medium text-sm flex items-center gap-1.5">
                    <Lightbulb className="size-4 text-yellow-500" />
                    {t("coding.tutorialUseCases")}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t("coding.tutorialUseCasesDesc")}
                  </p>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Code Playground */}
          {configured && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="size-5 text-muted-foreground" />
                    <div>
                      <CardTitle>{t("coding.playgroundTitle")}</CardTitle>
                      <CardDescription>{t("coding.playgroundDesc")}</CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {/* Language selector + run button */}
                <div className="flex items-end gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>{t("coding.language")}</Label>
                    <Select
                      value={language}
                      onValueChange={(v) => handleLanguageChange(v as Language)}
                    >
                      <SelectTrigger id="coding-language-trigger" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="python">{t("coding.python")}</SelectItem>
                        <SelectItem value="javascript">{t("coding.javascript")}</SelectItem>
                        <SelectItem value="html">{t("coding.html")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={handleRunCode} disabled={running || !code.trim()}>
                    {running ? (
                      <>
                        <Loader2 className="mr-1.5 size-4 animate-spin" />
                        {t("coding.running")}
                      </>
                    ) : (
                      <>
                        <Play className="mr-1.5 size-4" />
                        {t("coding.runCode")}
                      </>
                    )}
                  </Button>
                </div>

                {/* Code editor */}
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full min-h-[200px] max-h-[400px] resize-y rounded-lg border bg-muted/30 p-4 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
                  spellCheck={false}
                />

                {/* Output */}
                {output && (
                  <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm">{t("coding.output")}</h4>
                      <span className="text-xs text-muted-foreground">
                        {t("coding.executionTime", { ms: String(output.executionTimeMs) })}
                      </span>
                    </div>

                    {/* stdout */}
                    {output.stdout && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t("coding.stdout")}</Label>
                        <pre className="rounded-md bg-background p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto border">
                          {output.stdout}
                        </pre>
                      </div>
                    )}

                    {/* stderr / error */}
                    {(output.stderr || output.error) && (
                      <div className="space-y-1">
                        <Label className="text-xs text-destructive">{t("coding.stderr")}</Label>
                        <pre className="rounded-md bg-destructive/5 border border-destructive/20 p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto text-destructive">
                          {output.error || output.stderr}
                        </pre>
                      </div>
                    )}

                    {/* Charts / Images */}
                    {output.results.some((r) => r.png) && (
                      <div className="space-y-2">
                        <Label className="text-xs flex items-center gap-1">
                          <ImageIcon className="size-3.5" />
                          {t("coding.artifacts")}
                        </Label>
                        <div className="flex flex-wrap gap-3">
                          {output.results
                            .filter((r) => r.png)
                            .map((r, i) => (
                              <img
                                key={i}
                                src={`data:image/png;base64,${r.png}`}
                                alt={`Chart ${i + 1}`}
                                className="rounded-lg border max-w-full max-h-80 object-contain"
                              />
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Result text */}
                    {output.results.some((r) => r.text && !r.png) && (
                      <div className="space-y-1">
                        <pre className="rounded-md bg-background p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto border">
                          {output.results
                            .filter((r) => r.text && !r.png)
                            .map((r) => r.text)
                            .join("\n")}
                        </pre>
                      </div>
                    )}

                    {/* HTML preview (local srcdoc) */}
                    {output.results.some((r) => r.html) && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs flex items-center gap-1">
                            <Globe className="size-3.5" />
                            {t("coding.preview")}
                          </Label>
                          {output.previewUrl && (
                            <div className="flex items-center gap-1.5">
                              <a
                                href={output.previewUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <ExternalLink className="size-3" />
                                {t("coding.openPreview")}
                              </a>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1.5"
                                onClick={() => {
                                  navigator.clipboard.writeText(output.previewUrl!);
                                  toast.success(t("coding.previewLinkCopied"));
                                }}
                              >
                                <Copy className="size-3" />
                              </Button>
                            </div>
                          )}
                        </div>
                        <iframe
                          srcDoc={output.results.find((r) => r.html)?.html}
                          className="w-full h-80 rounded-lg border bg-white"
                          sandbox="allow-scripts"
                          title="HTML Preview"
                        />
                      </div>
                    )}

                    {/* No output at all */}
                    {!output.stdout &&
                      !output.stderr &&
                      !output.error &&
                      output.results.length === 0 && (
                        <p className="text-xs text-muted-foreground">{t("coding.noOutput")}</p>
                      )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Use Case Gallery (collapsible) */}
          <Card>
            <CardHeader
              className="cursor-pointer select-none"
              onClick={() => setUseCasesOpen(!useCasesOpen)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="size-5 text-muted-foreground" />
                  <div>
                    <CardTitle>{t("coding.useCasesTitle")}</CardTitle>
                    {useCasesOpen && (
                      <CardDescription className="mt-1">{t("coding.useCasesSubtitle")}</CardDescription>
                    )}
                  </div>
                </div>
                {useCasesOpen ? (
                  <ChevronUp className="size-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-5 text-muted-foreground" />
                )}
              </div>
            </CardHeader>
            {useCasesOpen && (
              <CardContent className="space-y-8">
                {USE_CASE_CATEGORIES.map((cat) => (
                  <div key={cat.titleKey}>
                    <h3 className="text-sm font-semibold mb-3 text-foreground/80">
                      {t(cat.titleKey as Parameters<typeof t>[0])}
                    </h3>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {cat.cases.map((uc) => {
                        const Icon = uc.icon;
                        const toolKey = `coding.toolBadge${uc.tool === "python" ? "Python" : uc.tool === "js" ? "JS" : uc.tool === "html" ? "HTML" : "Multi"}` as const;
                        const badgeVariant = uc.tool === "python" ? "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950"
                          : uc.tool === "js" ? "text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-950"
                          : uc.tool === "html" ? "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-950"
                          : "text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-950";

                        return (
                          <div
                            key={uc.title}
                            className="group rounded-lg border p-4 space-y-2.5 hover:border-primary/30 hover:shadow-sm transition-all"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <h4 className="font-medium text-sm flex items-center gap-1.5">
                                <Icon className={`size-4 shrink-0 ${uc.iconColor}`} />
                                {uc.title}
                              </h4>
                              <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded ${badgeVariant}`}>
                                {t(toolKey as Parameters<typeof t>[0])}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {uc.desc}
                            </p>
                            <div className="flex items-center gap-2 pt-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs gap-1 opacity-70 group-hover:opacity-100 transition-opacity"
                                onClick={() => {
                                  navigator.clipboard.writeText(uc.prompt);
                                  toast.success(t("coding.promptCopied"));
                                }}
                              >
                                <Copy className="size-3" />
                                {t("coding.copyPrompt")}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
