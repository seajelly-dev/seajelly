"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Pencil,
  BookOpen,
  FolderOpen,
  FileText,
  Sparkles,
  Zap,
  Search,
  Loader2,
  ChevronRight,
  ChevronLeft,
  ArrowLeft,
  Info,
  Settings2,
  AlertCircle,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import type { KnowledgeBase, KnowledgeArticle, Provider } from "@/types/database";

interface ModelItem {
  model_id: string;
  label: string;
  provider_id: string;
}

type KBWithChildren = KnowledgeBase & { children: KnowledgeBase[] };

function buildTree(bases: KnowledgeBase[]): KBWithChildren[] {
  const roots = bases.filter((b) => !b.parent_id);
  return roots.map((root) => ({
    ...root,
    children: bases.filter((b) => b.parent_id === root.id),
  }));
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  chunking: "bg-blue-100 text-blue-700",
  chunked: "bg-green-100 text-green-700",
  chunk_failed: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待切分",
  chunking: "切分中",
  chunked: "已切分",
  chunk_failed: "切分失败",
};

const EMBED_MODELS = [
  { id: "gemini-embedding-001", label: "Gemini Embedding 001" },
  { id: "gemini-embedding-2-preview", label: "Gemini Embedding 2 Preview" },
] as const;

const PAGE_SIZE = 20;

type TabKey = "manage" | "search" | "settings";

interface SearchChunk {
  id: string;
  article_id: string;
  chunk_text: string;
  similarity: number;
  article_title: string;
  knowledge_base_name: string;
}

interface SearchArticle {
  article_id: string;
  title: string;
  content: string;
  knowledge_base_name: string;
  max_similarity: number;
  matched_chunks: number;
}

export default function KnowledgePage() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<TabKey>("manage");
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [selectedBase, setSelectedBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [articleLoading, setArticleLoading] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  // Dialogs
  const [baseDialogOpen, setBaseDialogOpen] = useState(false);
  const [editBase, setEditBase] = useState<KnowledgeBase | null>(null);
  const [baseForm, setBaseForm] = useState({ name: "", description: "", parent_id: "" });

  const [articleDialogOpen, setArticleDialogOpen] = useState(false);
  const [editArticle, setEditArticle] = useState<KnowledgeArticle | null>(null);
  const [articleForm, setArticleForm] = useState({ title: "", content: "", source_url: "" });

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDesc, setConfirmDesc] = useState("");
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);

  // Processing states
  const [chunkingIds, setChunkingIds] = useState<Set<string>>(new Set());
  const [vectorizingIds, setVectorizingIds] = useState<Set<string>>(new Set());

  // Model config — global
  const [allProviders, setAllProviders] = useState<Provider[]>([]);
  const [allModels, setAllModels] = useState<ModelItem[]>([]);
  const [chunkProviderId, setChunkProviderId] = useState("");
  const [chunkModelId, setChunkModelId] = useState("");
  const [embedModelId, setEmbedModelId] = useState(EMBED_MODELS[0].id);

  // Embedding key config
  const [customEmbedKey, setCustomEmbedKey] = useState("");
  const [hasCustomEmbedKey, setHasCustomEmbedKey] = useState(false);
  const [savingEmbedKey, setSavingEmbedKey] = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchChunks, setSearchChunks] = useState<SearchChunk[]>([]);
  const [searchArticles, setSearchArticles] = useState<SearchArticle[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchTopK, setSearchTopK] = useState(10);

  const fetchBases = useCallback(async () => {
    const res = await fetch("/api/admin/knowledge/bases");
    const data = await res.json();
    if (data.bases) setBases(data.bases);
    setLoading(false);
  }, []);

  const fetchArticles = useCallback(async (kbId: string) => {
    setArticleLoading(true);
    const res = await fetch(`/api/admin/knowledge/articles?knowledge_base_id=${kbId}`);
    const data = await res.json();
    if (data.articles) setArticles(data.articles);
    setArticleLoading(false);
  }, []);

  const GOOGLE_PROVIDER_ID = "00000000-0000-0000-0000-000000000003";

  const fetchModels = useCallback(async () => {
    const [provRes, modRes, secretsRes, googleKeysRes] = await Promise.all([
      fetch("/api/admin/providers").then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/models").then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/secrets").then((r) => r.json()).catch(() => ({})),
      fetch(`/api/admin/providers/keys?provider_id=${GOOGLE_PROVIDER_ID}`).then((r) => r.json()).catch(() => ({})),
    ]);
    const providers: Provider[] = provRes.providers ?? [];
    const models: ModelItem[] = (modRes.models ?? []).map((m: ModelItem & Record<string, unknown>) => ({
      model_id: m.model_id,
      label: m.label,
      provider_id: m.provider_id,
    }));
    setAllProviders(providers);
    setAllModels(models);
    const google = providers.find((p) => p.id === GOOGLE_PROVIDER_ID);
    if (google) {
      setChunkProviderId(google.id);
      const flashModel = models.find((m) => m.provider_id === google.id && m.model_id.includes("flash"));
      setChunkModelId(flashModel?.model_id || models.find((m) => m.provider_id === google.id)?.model_id || "");
    } else if (providers.length > 0) {
      setChunkProviderId(providers[0].id);
      const firstModel = models.find((m) => m.provider_id === providers[0].id);
      setChunkModelId(firstModel?.model_id || "");
    }
    const googleKeys: { is_active: boolean }[] = googleKeysRes.keys ?? [];
    setHasGeminiKey(googleKeys.some((k) => k.is_active));

    const secrets: { key_name: string }[] = secretsRes.secrets ?? [];
    setHasCustomEmbedKey(secrets.some((s) => s.key_name === "EMBEDDING_API_KEY"));
  }, []);

  useEffect(() => {
    fetchBases();
    fetchModels();
  }, [fetchBases, fetchModels]);

  useEffect(() => {
    if (selectedBase) {
      fetchArticles(selectedBase);
      setCurrentPage(1);
    } else {
      setArticles([]);
    }
  }, [selectedBase, fetchArticles]);

  const tree = buildTree(bases);
  const selectedBaseName = bases.find((b) => b.id === selectedBase)?.name;

  const chunkProviderName = allProviders.find((p) => p.id === chunkProviderId)?.name ?? "";
  const chunkModelLabel = allModels.find((m) => m.model_id === chunkModelId && m.provider_id === chunkProviderId)?.label ?? chunkModelId;
  const filteredChunkModels = allModels.filter((m) => m.provider_id === chunkProviderId);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
  const paginatedArticles = articles.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // ─── Confirm helper ───

  const showConfirm = (desc: string, action: () => void) => {
    setConfirmDesc(desc);
    setConfirmAction(() => action);
    setConfirmOpen(true);
  };

  // ─── Knowledge Base CRUD ───

  const handleSaveBase = async () => {
    const method = editBase ? "PUT" : "POST";
    const payload = editBase
      ? { id: editBase.id, name: baseForm.name, description: baseForm.description }
      : { name: baseForm.name, description: baseForm.description, parent_id: baseForm.parent_id || null };

    const res = await fetch("/api/admin/knowledge/bases", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) { toast.error(data.error); return; }
    toast.success(editBase ? t("knowledge.baseUpdated") : t("knowledge.baseCreated"));
    setBaseDialogOpen(false);
    setEditBase(null);
    setBaseForm({ name: "", description: "", parent_id: "" });
    fetchBases();
  };

  const handleDeleteBase = (id: string) => {
    showConfirm(t("knowledge.confirmDeleteBase"), async () => {
      const res = await fetch(`/api/admin/knowledge/bases?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) { toast.error(data.error); return; }
      toast.success(t("knowledge.baseDeleted"));
      if (selectedBase === id) setSelectedBase(null);
      fetchBases();
    });
  };

  // ─── Article CRUD ───

  const handleSaveArticle = async () => {
    const method = editArticle ? "PUT" : "POST";
    const payload = editArticle
      ? { id: editArticle.id, title: articleForm.title, content: articleForm.content, source_url: articleForm.source_url || null }
      : { knowledge_base_id: selectedBase, title: articleForm.title, content: articleForm.content, source_url: articleForm.source_url || null };

    const res = await fetch("/api/admin/knowledge/articles", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) { toast.error(data.error); return; }
    toast.success(editArticle ? t("knowledge.articleUpdated") : t("knowledge.articleCreated"));
    setArticleDialogOpen(false);
    setEditArticle(null);
    setArticleForm({ title: "", content: "", source_url: "" });
    if (selectedBase) fetchArticles(selectedBase);
  };

  const handleDeleteArticle = (id: string) => {
    showConfirm(t("knowledge.confirmDeleteArticle"), async () => {
      const res = await fetch(`/api/admin/knowledge/articles?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) { toast.error(data.error); return; }
      toast.success(t("knowledge.articleDeleted"));
      if (selectedBase) fetchArticles(selectedBase);
    });
  };

  // ─── Chunk & Vectorize ───

  const handleChunk = async (articleId: string) => {
    setChunkingIds((prev) => new Set(prev).add(articleId));
    try {
      const res = await fetch("/api/admin/knowledge/articles/chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article_id: articleId,
          model_id: chunkModelId || undefined,
          provider_id: chunkProviderId || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) toast.error(data.error);
      else toast.success(t("knowledge.chunkSuccess", { count: data.chunks_count }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Chunk failed");
    }
    setChunkingIds((prev) => { const s = new Set(prev); s.delete(articleId); return s; });
    if (selectedBase) fetchArticles(selectedBase);
  };

  const handleVectorize = async (articleId: string) => {
    setVectorizingIds((prev) => new Set(prev).add(articleId));
    try {
      const res = await fetch("/api/admin/knowledge/articles/vectorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ article_id: articleId, embed_model: embedModelId }),
      });
      const data = await res.json();
      if (data.error) toast.error(data.error);
      else toast.success(t("knowledge.vectorizeSuccess", { embedded: data.embedded, failed: data.failed }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Vectorize failed");
    }
    setVectorizingIds((prev) => { const s = new Set(prev); s.delete(articleId); return s; });
    if (selectedBase) fetchArticles(selectedBase);
  };

  // ─── Search ───

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch("/api/admin/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery, top_k: searchTopK }),
      });
      const data = await res.json();
      if (data.error) toast.error(data.error);
      else {
        setSearchChunks(data.chunks ?? []);
        setSearchArticles(data.articles ?? []);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    }
    setSearching(false);
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64 col-span-2" />
        </div>
      </div>
    );
  }

  const tabs: { key: TabKey; icon: typeof BookOpen; labelKey: string }[] = [
    { key: "manage", icon: BookOpen, labelKey: "knowledge.tabManage" },
    { key: "search", icon: Search, labelKey: "knowledge.tabSearch" },
    { key: "settings", icon: Settings2, labelKey: "knowledge.tabSettings" },
  ];

  return (
    <div className="flex flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("knowledge.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("knowledge.subtitle")}</p>
      </div>

      {/* Agent mount hint */}
      <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
        <Info className="size-4 mt-0.5 shrink-0" />
        <span>{t("knowledge.agentMountHint")}</span>
      </div>

      {/* Tab bar (voice-style) */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {tabs.map(({ key, icon: Icon, labelKey }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="inline-block mr-1.5 size-4" />
            {t(labelKey as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {/* ─── Manage Tab ─── */}
      {activeTab === "manage" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Category Tree */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t("knowledge.categories")}</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditBase(null);
                    setBaseForm({ name: "", description: "", parent_id: "" });
                    setBaseDialogOpen(true);
                  }}
                >
                  <Plus className="size-4 mr-1" />
                  {t("knowledge.addCategory")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              {tree.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t("knowledge.noCategories")}
                </p>
              )}
              {tree.map((root) => (
                <div key={root.id}>
                  <div
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors group ${
                      selectedBase === root.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                    }`}
                    onClick={() => setSelectedBase(root.id)}
                  >
                    <FolderOpen className="size-4 shrink-0" />
                    <span className="flex-1 truncate text-sm">{root.name}</span>
                    <div className="hidden group-hover:flex gap-1">
                      <Button variant="ghost" size="icon" className="size-6" onClick={(e) => {
                        e.stopPropagation();
                        setEditBase(root);
                        setBaseForm({ name: root.name, description: root.description, parent_id: "" });
                        setBaseDialogOpen(true);
                      }}>
                        <Pencil className="size-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-6" onClick={(e) => {
                        e.stopPropagation();
                        setEditBase(null);
                        setBaseForm({ name: "", description: "", parent_id: root.id });
                        setBaseDialogOpen(true);
                      }}>
                        <Plus className="size-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-6 text-destructive" onClick={(e) => {
                        e.stopPropagation(); handleDeleteBase(root.id);
                      }}>
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                  {root.children.map((child) => (
                    <div
                      key={child.id}
                      className={`flex items-center gap-2 px-3 py-2 pl-8 rounded-lg cursor-pointer transition-colors group ${
                        selectedBase === child.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                      }`}
                      onClick={() => setSelectedBase(child.id)}
                    >
                      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate text-sm">{child.name}</span>
                      <div className="hidden group-hover:flex gap-1">
                        <Button variant="ghost" size="icon" className="size-6" onClick={(e) => {
                          e.stopPropagation();
                          setEditBase(child);
                          setBaseForm({ name: child.name, description: child.description, parent_id: "" });
                          setBaseDialogOpen(true);
                        }}>
                          <Pencil className="size-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-6 text-destructive" onClick={(e) => {
                          e.stopPropagation(); handleDeleteBase(child.id);
                        }}>
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Right: Articles */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">
                    {selectedBase ? (
                      <span className="flex items-center gap-2">
                        <FileText className="size-4" />
                        {selectedBaseName}
                      </span>
                    ) : (
                      t("knowledge.selectCategory")
                    )}
                  </CardTitle>
                  {selectedBase && (
                    <CardDescription>{t("knowledge.articlesCount", { count: articles.length })}</CardDescription>
                  )}
                </div>
                {selectedBase && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditArticle(null);
                      setArticleForm({ title: "", content: "", source_url: "" });
                      setArticleDialogOpen(true);
                    }}
                  >
                    <Plus className="size-4 mr-1" />
                    {t("knowledge.addArticle")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!selectedBase && (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <ArrowLeft className="size-8 mb-2" />
                  <p>{t("knowledge.selectCategoryHint")}</p>
                </div>
              )}
              {selectedBase && articleLoading && (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
                </div>
              )}
              {selectedBase && !articleLoading && articles.length === 0 && (
                <p className="text-sm text-muted-foreground py-8 text-center">{t("knowledge.noArticles")}</p>
              )}
              {selectedBase && !articleLoading && articles.length > 0 && (
                <div className="space-y-3">
                  {paginatedArticles.map((article) => (
                    <div
                      key={article.id}
                      className="border rounded-xl p-4 flex items-start justify-between gap-4 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-medium text-sm truncate">{article.title}</h3>
                          <Badge variant="secondary" className={STATUS_COLORS[article.chunk_status] || ""}>
                            {STATUS_LABELS[article.chunk_status] || article.chunk_status}
                          </Badge>
                          {(article.total_chunks ?? 0) > 0 && (() => {
                            const total = article.total_chunks ?? 0;
                            const embedded = article.embedded_count ?? 0;
                            const allDone = embedded === total;
                            const partial = embedded > 0 && embedded < total;
                            return (
                              <Badge variant="outline" className={`text-xs ${allDone ? "bg-emerald-100 text-emerald-700 border-emerald-300" : partial ? "bg-amber-100 text-amber-700 border-amber-300" : "bg-gray-100 text-gray-600"}`}>
                                <Zap className="size-3 mr-0.5" />
                                {embedded}/{total}
                              </Badge>
                            );
                          })()}
                        </div>
                        {article.source_url && (
                          <p className="text-xs text-muted-foreground truncate">{article.source_url}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {article.content.slice(0, 120)}
                          {article.content.length > 120 ? "..." : ""}
                        </p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => {
                          setEditArticle(article);
                          setArticleForm({ title: article.title, content: article.content, source_url: article.source_url || "" });
                          setArticleDialogOpen(true);
                        }}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button size="sm" variant="outline" disabled={chunkingIds.has(article.id) || !article.content} onClick={() => handleChunk(article.id)}>
                          {chunkingIds.has(article.id) ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                          <span className="ml-1">{t("knowledge.chunk")}</span>
                        </Button>
                        <Button size="sm" variant="outline" disabled={vectorizingIds.has(article.id) || article.chunk_status !== "chunked"} onClick={() => handleVectorize(article.id)}>
                          {vectorizingIds.has(article.id) ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                          <span className="ml-1">{t("knowledge.vectorize")}</span>
                        </Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteArticle(article.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 pt-3">
                      <Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)}>
                        <ChevronLeft className="size-4" />
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        {currentPage} / {totalPages}
                      </span>
                      <Button size="sm" variant="outline" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Search Tab ─── */}
      {activeTab === "search" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="size-4" />
              {t("knowledge.ragSearch")}
            </CardTitle>
            <CardDescription>{t("knowledge.ragSearchDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Input
                placeholder={t("knowledge.searchPlaceholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1"
              />
              <div className="flex items-center gap-2">
                <Label className="text-sm whitespace-nowrap">Top K:</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={searchTopK}
                  onChange={(e) => setSearchTopK(parseInt(e.target.value) || 10)}
                  className="w-20"
                />
              </div>
              <Button onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
                {searching ? <Loader2 className="size-4 animate-spin mr-1" /> : <Search className="size-4 mr-1" />}
                {t("knowledge.search")}
              </Button>
            </div>

            {(searchChunks.length > 0 || searchArticles.length > 0) && (
              <div className="space-y-6">
                {/* Articles — full context */}
                <div className="space-y-3">
                  <p className="text-sm font-medium">
                    {t("knowledge.searchArticlesHit", { chunks: searchChunks.length, articles: searchArticles.length })}
                  </p>
                  {searchArticles.map((article, i) => (
                    <details key={article.article_id} className="border rounded-xl group" open={i === 0}>
                      <summary className="flex items-center gap-2 p-4 cursor-pointer select-none hover:bg-muted/30 transition-colors">
                        <Badge variant="secondary" className="text-xs shrink-0">#{i + 1}</Badge>
                        <Badge variant="outline" className="text-xs font-mono shrink-0">{(article.max_similarity * 100).toFixed(1)}%</Badge>
                        <span className="text-sm font-medium truncate">{article.title}</span>
                        <span className="text-xs text-muted-foreground ml-auto shrink-0">
                          {article.knowledge_base_name} · {article.matched_chunks} chunks
                        </span>
                      </summary>
                      <div className="px-4 pb-4 border-t">
                        <p className="text-sm whitespace-pre-wrap mt-3 max-h-96 overflow-y-auto">{article.content}</p>
                      </div>
                    </details>
                  ))}
                </div>

                {/* Chunks — retrieval detail */}
                <details className="border rounded-xl">
                  <summary className="flex items-center gap-2 p-4 cursor-pointer select-none text-sm text-muted-foreground hover:bg-muted/30 transition-colors">
                    {t("knowledge.searchChunkDetail", { count: searchChunks.length })}
                  </summary>
                  <div className="px-4 pb-4 space-y-2 border-t mt-0">
                    {searchChunks.map((chunk, i) => (
                      <div key={chunk.id} className="flex gap-3 py-2 border-b last:border-b-0">
                        <span className="text-xs text-muted-foreground shrink-0 w-6 text-right">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <Badge variant="outline" className="text-[10px] font-mono">{(chunk.similarity * 100).toFixed(1)}%</Badge>
                            <span className="text-xs text-muted-foreground truncate">{chunk.article_title}</span>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{chunk.chunk_text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
            {searchChunks.length === 0 && searchQuery && !searching && (
              <p className="text-sm text-muted-foreground text-center py-8">{t("knowledge.noSearchResults")}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Settings Tab ─── */}
      {activeTab === "settings" && (
        <div className="space-y-6">
          {/* Chunk model */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("knowledge.chunkModel")}</CardTitle>
              <CardDescription>{t("knowledge.chunkModelDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <Select value={chunkProviderId} onValueChange={(v) => {
                  setChunkProviderId(v ?? "");
                  const provModels = allModels.filter((m) => m.provider_id === v);
                  setChunkModelId(provModels[0]?.model_id || "");
                }}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Provider">{chunkProviderName}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {allProviders.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={chunkModelId} onValueChange={(v) => setChunkModelId(v ?? "")}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Model">{chunkModelLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {filteredChunkModels.map((m) => (
                      <SelectItem key={m.model_id} value={m.model_id}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Embedding config */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("knowledge.embedSettings")}</CardTitle>
              <CardDescription>{t("knowledge.embedSettingsDesc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Model selector */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t("knowledge.embedModel")}</Label>
                <Select value={embedModelId} onValueChange={(v) => setEmbedModelId(v ?? EMBED_MODELS[0].id)}>
                  <SelectTrigger className="w-80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMBED_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertCircle className="size-4 mt-0.5 shrink-0" />
                  <span>{t("knowledge.embedModelWarning")}</span>
                </div>
              </div>

              {/* API Key status & management */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">{t("knowledge.embedApiKey")}</Label>
                <p className="text-xs text-muted-foreground">{t("knowledge.embedApiKeyDesc")}</p>

                {/* Current status */}
                <div className={`rounded-lg border p-3 text-sm ${
                  hasCustomEmbedKey || hasGeminiKey
                    ? "border-green-200 bg-green-50/60 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300"
                    : "border-red-200 bg-red-50/60 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
                }`}>
                  <Info className="inline-block size-3.5 mr-1.5 -mt-0.5" />
                  {hasCustomEmbedKey
                    ? t("knowledge.statusUsingCustomKey")
                    : hasGeminiKey
                      ? t("knowledge.statusUsingGeminiKey")
                      : t("knowledge.statusNoKey")}
                </div>

                {/* Custom key input */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{t("knowledge.customKeyLabel")}</p>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder={hasCustomEmbedKey ? "••••••••••••••••" : t("knowledge.enterEmbedKey")}
                      value={customEmbedKey}
                      onChange={(e) => setCustomEmbedKey(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      disabled={!customEmbedKey.trim() || savingEmbedKey}
                      onClick={async () => {
                        setSavingEmbedKey(true);
                        try {
                          const res = await fetch("/api/admin/secrets", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ key_name: "EMBEDDING_API_KEY", value: customEmbedKey.trim() }),
                          });
                          const data = await res.json();
                          if (data.error) { toast.error(data.error); }
                          else {
                            toast.success(t("knowledge.embedKeySaved"));
                            setHasCustomEmbedKey(true);
                            setCustomEmbedKey("");
                          }
                        } catch {
                          toast.error("Failed to save key");
                        }
                        setSavingEmbedKey(false);
                      }}
                    >
                      {savingEmbedKey ? <Loader2 className="size-4 animate-spin" /> : t("common.save")}
                    </Button>
                    {hasCustomEmbedKey && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        onClick={() => showConfirm(t("knowledge.confirmDeleteEmbedKey"), async () => {
                          const secretsRes = await fetch("/api/admin/secrets").then((r) => r.json()).catch(() => ({}));
                          const secret = (secretsRes.secrets ?? []).find((s: { key_name: string; id: string }) => s.key_name === "EMBEDDING_API_KEY");
                          if (secret) {
                            await fetch(`/api/admin/secrets?id=${secret.id}`, { method: "DELETE" });
                          }
                          setHasCustomEmbedKey(false);
                          toast.success(t("knowledge.embedKeyDeleted"));
                        })}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{t("knowledge.customKeyHint")}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── Base Dialog ─── */}
      <Dialog open={baseDialogOpen} onOpenChange={setBaseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editBase ? t("knowledge.editCategory") : t("knowledge.addCategory")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("knowledge.categoryName")}</Label>
              <Input value={baseForm.name} onChange={(e) => setBaseForm({ ...baseForm, name: e.target.value })} placeholder={t("knowledge.categoryNamePlaceholder")} />
            </div>
            <div>
              <Label>{t("knowledge.categoryDesc")}</Label>
              <Textarea value={baseForm.description} onChange={(e) => setBaseForm({ ...baseForm, description: e.target.value })} placeholder={t("knowledge.categoryDescPlaceholder")} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBaseDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSaveBase} disabled={!baseForm.name.trim()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Article Dialog ─── */}
      <Dialog open={articleDialogOpen} onOpenChange={setArticleDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editArticle ? t("knowledge.editArticle") : t("knowledge.addArticle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("knowledge.articleTitle")}</Label>
              <Input value={articleForm.title} onChange={(e) => setArticleForm({ ...articleForm, title: e.target.value })} placeholder={t("knowledge.articleTitlePlaceholder")} />
            </div>
            <div>
              <Label>{t("knowledge.articleSourceUrl")}</Label>
              <Input value={articleForm.source_url} onChange={(e) => setArticleForm({ ...articleForm, source_url: e.target.value })} placeholder="https://..." />
            </div>
            <div>
              <Label>{t("knowledge.articleContent")}</Label>
              <Textarea
                value={articleForm.content}
                onChange={(e) => setArticleForm({ ...articleForm, content: e.target.value })}
                placeholder={t("knowledge.articleContentPlaceholder")}
                rows={25}
                className="font-mono text-sm min-h-[400px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArticleDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSaveArticle} disabled={!articleForm.title.trim()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Confirm Dialog ─── */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        description={confirmDesc}
        onConfirm={() => { confirmAction?.(); setConfirmOpen(false); }}
      />
    </div>
  );
}
