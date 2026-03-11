"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  CreditCard,
  Clock,
  Hash,
  Gift,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Copy,
  ExternalLink,
  Info,
  Search,
  Check,
} from "lucide-react";
import { useT } from "@/lib/i18n";

interface AgentOption { id: string; name: string }

interface Plan {
  id: string;
  agent_id: string;
  name: string;
  type: "time" | "quota";
  duration_days: number | null;
  quota_amount: number | null;
  price_cents: number;
  currency: string;
  stripe_payment_link: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  agents?: { name: string } | null;
}

interface SubRow {
  id: string;
  channel_id: string;
  plan_id: string | null;
  type: "time" | "quota";
  starts_at: string | null;
  expires_at: string | null;
  quota_total: number | null;
  quota_used: number;
  payment_provider: string | null;
  status: string;
  created_at: string;
  channels?: {
    id: string;
    display_name: string | null;
    platform_uid: string;
    platform: string;
    agent_id: string;
    agents?: { name: string } | null;
  } | null;
  plans?: { name: string; type: string } | null;
}

interface ChannelOption {
  id: string;
  display_name: string | null;
  platform_uid: string;
  platform: string;
  agent_id: string;
}

export default function SubscriptionsPage() {
  const t = useT();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [filterAgent, setFilterAgent] = useState("all");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [planForm, setPlanForm] = useState({
    agent_id: "",
    name: "",
    type: "time" as "time" | "quota",
    duration_days: 30,
    quota_amount: 100,
    price_cents: 990,
    currency: "usd",
    stripe_payment_link: "",
  });
  const [planSaving, setPlanSaving] = useState(false);
  const [deletePlanTarget, setDeletePlanTarget] = useState<Plan | null>(null);

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantForm, setGrantForm] = useState({
    channel_id: "",
    plan_id: "",
    type: "time" as "time" | "quota",
    duration_days: 30,
    quota_total: 100,
  });
  const [grantChannels, setGrantChannels] = useState<ChannelOption[]>([]);
  const [grantChannelSearch, setGrantChannelSearch] = useState("");
  const [grantSaving, setGrantSaving] = useState(false);

  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  const [stripeSecretConfigured, setStripeSecretConfigured] = useState(false);
  const [stripeWebhookConfigured, setStripeWebhookConfigured] = useState(false);
  const [stripeSaving, setStripeSaving] = useState<string | null>(null);
  const [stripeGuideOpen, setStripeGuideOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"plans" | "stripe">("plans");

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/webhook/stripe`
    : "";

  useEffect(() => {
    fetch("/api/admin/secrets")
      .then((r) => r.json())
      .then((d) => {
        const secrets: Array<{ key_name: string }> = d.secrets ?? [];
        setStripeSecretConfigured(secrets.some((s) => s.key_name === "STRIPE_SECRET_KEY"));
        setStripeWebhookConfigured(secrets.some((s) => s.key_name === "STRIPE_WEBHOOK_SECRET"));
      })
      .catch(() => {});
  }, []);

  const saveStripeKey = async (keyName: string, value: string) => {
    if (!value.trim()) return;
    setStripeSaving(keyName);
    try {
      const res = await fetch("/api/admin/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key_name: keyName, value }),
      });
      if (!res.ok) throw new Error("Failed");
      if (keyName === "STRIPE_SECRET_KEY") { setStripeSecretConfigured(true); setStripeSecretKey(""); }
      if (keyName === "STRIPE_WEBHOOK_SECRET") { setStripeWebhookConfigured(true); setStripeWebhookSecret(""); }
      toast.success(t("subscriptions.stripeKeySaved"));
    } catch {
      toast.error(t("subscriptions.stripeKeySaveFailed"));
    } finally {
      setStripeSaving(null);
    }
  };

  useEffect(() => {
    fetch("/api/admin/agents")
      .then((r) => r.json())
      .then((d) => setAgents((d.agents ?? []).map((a: AgentOption) => ({ id: a.id, name: a.name }))))
      .catch(() => {});
  }, []);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const agentParam = filterAgent !== "all" ? `&agent_id=${filterAgent}` : "";
      const [plansRes, subsRes] = await Promise.all([
        fetch(`/api/admin/subscriptions?view=plans${agentParam}`).then((r) => r.json()),
        fetch(`/api/admin/subscriptions?view=subscriptions${agentParam}`).then((r) => r.json()),
      ]);
      setPlans(plansRes.plans ?? []);
      setSubs(subsRes.subscriptions ?? []);
    } catch {
      toast.error(t("subscriptions.loadFailed"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t, filterAgent]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanForm({
      agent_id: filterAgent !== "all" ? filterAgent : (agents[0]?.id ?? ""),
      name: "", type: "time", duration_days: 30, quota_amount: 100, price_cents: 990, currency: "usd", stripe_payment_link: "",
    });
    setPlanDialogOpen(true);
  };

  const openEditPlan = (plan: Plan) => {
    setEditingPlan(plan);
    setPlanForm({
      agent_id: plan.agent_id,
      name: plan.name,
      type: plan.type,
      duration_days: plan.duration_days ?? 30,
      quota_amount: plan.quota_amount ?? 100,
      price_cents: plan.price_cents,
      currency: plan.currency,
      stripe_payment_link: plan.stripe_payment_link ?? "",
    });
    setPlanDialogOpen(true);
  };

  const savePlan = async () => {
    if (!planForm.name.trim() || !planForm.agent_id) { toast.error("Name and Agent required"); return; }
    setPlanSaving(true);
    try {
      if (editingPlan) {
        const res = await fetch("/api/admin/subscriptions", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingPlan.id, target: "plan", ...planForm }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        toast.success(t("subscriptions.planUpdated"));
      } else {
        const res = await fetch("/api/admin/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create_plan", ...planForm }),
        });
        if (!res.ok) throw new Error((await res.json()).error);
        toast.success(t("subscriptions.planCreated"));
      }
      setPlanDialogOpen(false);
      fetchData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setPlanSaving(false);
    }
  };

  const deletePlan = async () => {
    if (!deletePlanTarget) return;
    try {
      const res = await fetch(`/api/admin/subscriptions?id=${deletePlanTarget.id}&target=plan`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(t("subscriptions.planDeleted"));
      setDeletePlanTarget(null);
      fetchData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const togglePlanActive = async (plan: Plan) => {
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: plan.id, target: "plan", is_active: !plan.is_active }),
      });
      if (!res.ok) throw new Error("Failed");
      fetchData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const openGrant = async () => {
    try {
      const params = new URLSearchParams({ page_size: "100" });
      if (filterAgent !== "all") params.set("agent_id", filterAgent);
      const res = await fetch(`/api/admin/channels?${params.toString()}`);
      const data = await res.json();
      setGrantChannels((data.channels ?? []).map((c: ChannelOption & Record<string, unknown>) => ({
        id: c.id, display_name: c.display_name, platform_uid: c.platform_uid, platform: c.platform, agent_id: c.agent_id,
      })));
    } catch { setGrantChannels([]); }
    setGrantForm({ channel_id: "", plan_id: "", type: "time", duration_days: 30, quota_total: 100 });
    setGrantChannelSearch("");
    setGrantOpen(true);
  };

  const saveGrant = async () => {
    if (!grantForm.channel_id) { toast.error("Select a channel"); return; }
    setGrantSaving(true);
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "grant_subscription",
          ...grantForm,
          plan_id: grantForm.plan_id || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success(t("subscriptions.subscriptionGranted"));
      setGrantOpen(false);
      fetchData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setGrantSaving(false);
    }
  };

  const cancelSub = async (sub: SubRow) => {
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sub.id, target: "subscription", status: "cancelled" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(t("subscriptions.subscriptionCancelled"));
      fetchData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const formatPrice = (cents: number, currency: string) => {
    const sym: Record<string, string> = { usd: "$", cny: "¥", eur: "€", gbp: "£" };
    return `${sym[currency] || currency.toUpperCase() + " "}${(cents / 100).toFixed(2)}`;
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const filteredGrantChannels = useMemo(() => {
    if (!grantChannelSearch.trim()) return grantChannels;
    const q = grantChannelSearch.toLowerCase();
    return grantChannels.filter(
      (c) =>
        (c.display_name ?? "").toLowerCase().includes(q) ||
        c.platform_uid.toLowerCase().includes(q) ||
        c.platform.toLowerCase().includes(q)
    );
  }, [grantChannels, grantChannelSearch]);

  const selectedChannel = grantChannels.find((c) => c.id === grantForm.channel_id);

  const tabClass = (tab: string) =>
    `px-4 py-2 rounded-md text-sm font-medium transition-colors ${
      activeTab === tab
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("subscriptions.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subscriptions.subtitle")}</p>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
          <button onClick={() => setActiveTab("plans")} className={tabClass("plans")}>
            <CreditCard className="inline-block mr-1.5 size-4" />
            {t("subscriptions.tabs.plans")}
          </button>
          <button onClick={() => setActiveTab("stripe")} className={tabClass("stripe")}>
            <ExternalLink className="inline-block mr-1.5 size-4" />
            {t("subscriptions.tabs.stripe")}
            {(!stripeSecretConfigured || !stripeWebhookConfigured) && (
              <span className="ml-1.5 inline-block size-2 rounded-full bg-amber-500" />
            )}
          </button>
        </div>

        {activeTab === "plans" && (
          <div className="flex items-center gap-2">
            <Select value={filterAgent} onValueChange={(v) => setFilterAgent(v ?? "all")}>
              <SelectTrigger className="w-[180px]">
                {filterAgent === "all" ? t("subscriptions.allAgents") : agents.find((a) => a.id === filterAgent)?.name || filterAgent}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("subscriptions.allAgents")}</SelectItem>
                {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={refreshing}>
              <RefreshCw className={`size-3.5 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
              {t("common.refresh")}
            </Button>
          </div>
        )}
      </div>

      {/* ═══════ Tab: Plans & Subscriptions ═══════ */}
      {activeTab === "plans" && (
        <>
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {/* Plans */}
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
                  <div>
                    <CardTitle className="text-lg">{t("subscriptions.plansTitle")}</CardTitle>
                    <CardDescription>{t("subscriptions.plansDesc")}</CardDescription>
                  </div>
                  <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
                    <DialogTrigger render={<Button size="sm" onClick={openCreatePlan} />}>
                      <Plus className="size-4 mr-1.5" />
                      {t("subscriptions.addPlan")}
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                      <DialogHeader>
                        <DialogTitle>{editingPlan ? t("subscriptions.editPlan") : t("subscriptions.addPlan")}</DialogTitle>
                        <DialogDescription>{t("subscriptions.plansDesc")}</DialogDescription>
                      </DialogHeader>
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                          <Label>Agent</Label>
                          <Select value={planForm.agent_id} onValueChange={(v) => setPlanForm((f) => ({ ...f, agent_id: v ?? "" }))}>
                            <SelectTrigger>
                              {agents.find((a) => a.id === planForm.agent_id)?.name || "Select Agent"}
                            </SelectTrigger>
                            <SelectContent>
                              {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>{t("subscriptions.planName")}</Label>
                          <Input value={planForm.name} onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))} placeholder={t("subscriptions.planNamePlaceholder")} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <Label>{t("subscriptions.planType")}</Label>
                            <Select value={planForm.type} onValueChange={(v) => setPlanForm((f) => ({ ...f, type: (v ?? "time") as "time" | "quota" }))}>
                              <SelectTrigger>
                                {planForm.type === "time" ? t("subscriptions.planTypeTime") : t("subscriptions.planTypeQuota")}
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="time">{t("subscriptions.planTypeTime")}</SelectItem>
                                <SelectItem value="quota">{t("subscriptions.planTypeQuota")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {planForm.type === "time" ? (
                            <div className="flex flex-col gap-1.5">
                              <Label>{t("subscriptions.durationDays")}</Label>
                              <Input type="number" value={planForm.duration_days} onChange={(e) => setPlanForm((f) => ({ ...f, duration_days: parseInt(e.target.value) || 30 }))} />
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              <Label>{t("subscriptions.quotaAmount")}</Label>
                              <Input type="number" value={planForm.quota_amount} onChange={(e) => setPlanForm((f) => ({ ...f, quota_amount: parseInt(e.target.value) || 100 }))} />
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <Label>{t("subscriptions.priceCents")}</Label>
                            <Input type="number" value={planForm.price_cents} onChange={(e) => setPlanForm((f) => ({ ...f, price_cents: parseInt(e.target.value) || 0 }))} />
                            <p className="text-xs text-muted-foreground">{t("subscriptions.priceCentsHint")}</p>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label>{t("subscriptions.currency")}</Label>
                            <Select value={planForm.currency} onValueChange={(v) => setPlanForm((f) => ({ ...f, currency: v ?? "usd" }))}>
                              <SelectTrigger>{planForm.currency.toUpperCase()}</SelectTrigger>
                              <SelectContent>
                                <SelectItem value="usd">USD</SelectItem>
                                <SelectItem value="cny">CNY</SelectItem>
                                <SelectItem value="eur">EUR</SelectItem>
                                <SelectItem value="gbp">GBP</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label>{t("subscriptions.stripePaymentLink")}</Label>
                          <Input value={planForm.stripe_payment_link} onChange={(e) => setPlanForm((f) => ({ ...f, stripe_payment_link: e.target.value }))} placeholder="https://buy.stripe.com/..." />
                          <p className="text-xs text-muted-foreground">{t("subscriptions.stripePaymentLinkHint")}</p>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="ghost" onClick={() => setPlanDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button onClick={savePlan} disabled={planSaving}>{planSaving ? t("common.saving") : t("common.save")}</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {plans.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">{t("subscriptions.noPlan")}</p>
                  ) : (
                    <div className="space-y-2">
                      {plans.map((plan) => (
                        <div key={plan.id} className="flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/40">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                            {plan.type === "time" ? <Clock className="size-4 text-muted-foreground" /> : <Hash className="size-4 text-muted-foreground" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">{plan.name}</span>
                              <Badge variant="outline" className="text-xs shrink-0">
                                {plan.type === "time" ? `${plan.duration_days}d` : `${plan.quota_amount} msg`}
                              </Badge>
                              {plan.agents?.name && (
                                <span className="text-xs text-muted-foreground truncate">{plan.agents.name}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs font-mono text-muted-foreground">{formatPrice(plan.price_cents, plan.currency)}</span>
                              {plan.stripe_payment_link && (
                                <Badge variant="secondary" className="text-xs gap-1">
                                  <CreditCard className="size-3" />
                                  Stripe
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch checked={plan.is_active} onCheckedChange={() => togglePlanActive(plan)} />
                            <Button variant="ghost" size="icon-sm" onClick={() => openEditPlan(plan)}><Pencil className="size-3.5" /></Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => setDeletePlanTarget(plan)} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Subscriptions */}
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
                  <div>
                    <CardTitle className="text-lg">{t("subscriptions.subscriptionsTitle")}</CardTitle>
                    <CardDescription>{t("subscriptions.subscriptionsDesc")}</CardDescription>
                  </div>
                  <Button size="sm" variant="outline" onClick={openGrant}>
                    <Gift className="size-4 mr-1.5" />
                    {t("subscriptions.addSubscription")}
                  </Button>
                </CardHeader>
                <CardContent>
                  {subs.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">{t("subscriptions.noSubscriptions")}</p>
                  ) : (
                    <div className="space-y-2">
                      {subs.map((sub) => (
                        <div key={sub.id} className="flex items-center gap-4 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/40">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {sub.channels?.display_name || sub.channels?.platform_uid || "—"}
                              </span>
                              <Badge variant={sub.status === "active" ? "secondary" : sub.status === "expired" ? "outline" : "destructive"} className="text-xs">
                                {sub.status === "active" ? t("subscriptions.statusActive") : sub.status === "expired" ? t("subscriptions.statusExpired") : t("subscriptions.statusCancelled")}
                              </Badge>
                              {sub.payment_provider === "manual" && (
                                <Badge variant="outline" className="text-xs">{t("subscriptions.grantedManually")}</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                              <span>{sub.channels?.agents?.name || "—"}</span>
                              <span>{sub.plans?.name || (sub.type === "time" ? t("subscriptions.planTypeTime") : t("subscriptions.planTypeQuota"))}</span>
                              {sub.type === "time" && <span>{t("subscriptions.expiresAt")}: {formatDate(sub.expires_at)}</span>}
                              {sub.type === "quota" && <span>{t("subscriptions.quotaUsed")}: {sub.quota_used}/{sub.quota_total}</span>}
                            </div>
                          </div>
                          {sub.status === "active" && (
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => cancelSub(sub)}>
                              {t("subscriptions.cancelSubscription")}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* ═══════ Tab: Stripe Payment Setup ═══════ */}
      {activeTab === "stripe" && (
        <div className="flex flex-col gap-6">
          {/* Setup guide */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t("subscriptions.stripeGuideTitle")}</CardTitle>
              <CardDescription>{t("subscriptions.stripeConfigDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30 p-4 text-sm space-y-1">
                {t("subscriptions.stripeGuideSteps").split("\n").map((step, i) => (
                  <p key={i} className="text-blue-800 dark:text-blue-300 text-xs leading-relaxed">{step}</p>
                ))}
                <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-blue-200 dark:border-blue-800">
                  <Info className="size-3.5 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    {t("subscriptions.stripeTestMode")}: {t("subscriptions.stripeTestModeHint")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Keys */}
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Secret Key */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t("subscriptions.stripeSecretKey")}</CardTitle>
                  {stripeSecretConfigured ? (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <CheckCircle2 className="size-3 text-green-600" />
                      {t("subscriptions.stripeKeyConfigured")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <XCircle className="size-3 text-muted-foreground" />
                      {t("subscriptions.stripeKeyNotConfigured")}
                    </Badge>
                  )}
                </div>
                <CardDescription>{t("subscriptions.stripeSecretKeyHint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder={t("subscriptions.stripeKeyPlaceholder")}
                    value={stripeSecretKey}
                    onChange={(e) => setStripeSecretKey(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() => saveStripeKey("STRIPE_SECRET_KEY", stripeSecretKey)}
                    disabled={!stripeSecretKey.trim() || stripeSaving === "STRIPE_SECRET_KEY"}
                  >
                    {stripeSaving === "STRIPE_SECRET_KEY" ? t("common.saving") : t("subscriptions.stripeSaveKey")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Webhook Secret */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t("subscriptions.stripeWebhookSecret")}</CardTitle>
                  {stripeWebhookConfigured ? (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <CheckCircle2 className="size-3 text-green-600" />
                      {t("subscriptions.stripeKeyConfigured")}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <XCircle className="size-3 text-muted-foreground" />
                      {t("subscriptions.stripeKeyNotConfigured")}
                    </Badge>
                  )}
                </div>
                <CardDescription>{t("subscriptions.stripeWebhookSecretHint")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder={t("subscriptions.stripeKeyPlaceholder")}
                    value={stripeWebhookSecret}
                    onChange={(e) => setStripeWebhookSecret(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() => saveStripeKey("STRIPE_WEBHOOK_SECRET", stripeWebhookSecret)}
                    disabled={!stripeWebhookSecret.trim() || stripeSaving === "STRIPE_WEBHOOK_SECRET"}
                  >
                    {stripeSaving === "STRIPE_WEBHOOK_SECRET" ? t("common.saving") : t("subscriptions.stripeSaveKey")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Webhook URL */}
          {webhookUrl && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t("subscriptions.stripeWebhookUrl")}</CardTitle>
                  <div className="flex gap-1.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        navigator.clipboard.writeText(webhookUrl);
                        toast.success(t("settings.copySuccess"));
                      }}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => window.open("https://dashboard.stripe.com/webhooks", "_blank")}
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <code className="block text-sm font-mono bg-muted rounded-md px-3 py-2 border select-all break-all">
                  {webhookUrl}
                </code>
                <p className="text-xs text-muted-foreground mt-2">{t("subscriptions.stripeWebhookUrlHint")}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Grant subscription dialog */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("subscriptions.addSubscription")}</DialogTitle>
            <DialogDescription>{t("subscriptions.grantDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t("subscriptions.selectChannel")}</Label>
              {selectedChannel && (
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
                  <span className="text-sm font-medium truncate flex-1">
                    {selectedChannel.display_name || selectedChannel.platform_uid}
                  </span>
                  <Badge variant="outline" className="text-xs shrink-0">{selectedChannel.platform}</Badge>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => setGrantForm((f) => ({ ...f, channel_id: "" }))}
                  >
                    <XCircle className="size-4" />
                  </button>
                </div>
              )}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={t("subscriptions.searchChannel")}
                  value={grantChannelSearch}
                  onChange={(e) => setGrantChannelSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="max-h-40 overflow-y-auto rounded-md border">
                {filteredGrantChannels.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">{t("subscriptions.noChannelFound")}</p>
                ) : (
                  filteredGrantChannels.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 ${
                        grantForm.channel_id === c.id ? "bg-muted" : ""
                      }`}
                      onClick={() => setGrantForm((f) => ({ ...f, channel_id: c.id }))}
                    >
                      <Check className={`size-3.5 shrink-0 ${grantForm.channel_id === c.id ? "text-foreground" : "text-transparent"}`} />
                      <span className="truncate flex-1">{c.display_name || c.platform_uid}</span>
                      <Badge variant="outline" className="text-xs shrink-0">{c.platform}</Badge>
                    </button>
                  ))
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>{t("subscriptions.planType")}</Label>
                <Select value={grantForm.type} onValueChange={(v) => setGrantForm((f) => ({ ...f, type: (v ?? "time") as "time" | "quota" }))}>
                  <SelectTrigger>{grantForm.type === "time" ? t("subscriptions.planTypeTime") : t("subscriptions.planTypeQuota")}</SelectTrigger>
                  <SelectContent>
                    <SelectItem value="time">{t("subscriptions.planTypeTime")}</SelectItem>
                    <SelectItem value="quota">{t("subscriptions.planTypeQuota")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {grantForm.type === "time" ? (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("subscriptions.durationDays")}</Label>
                  <Input type="number" value={grantForm.duration_days} onChange={(e) => setGrantForm((f) => ({ ...f, duration_days: parseInt(e.target.value) || 30 }))} />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("subscriptions.quotaAmount")}</Label>
                  <Input type="number" value={grantForm.quota_total} onChange={(e) => setGrantForm((f) => ({ ...f, quota_total: parseInt(e.target.value) || 100 }))} />
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setGrantOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={saveGrant} disabled={grantSaving}>{grantSaving ? t("common.saving") : t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletePlanTarget}
        onOpenChange={(open) => !open && setDeletePlanTarget(null)}
        title={t("subscriptions.deletePlan")}
        description={t("subscriptions.deletePlanConfirm", { name: deletePlanTarget?.name || "" })}
        confirmText={t("common.delete")}
        onConfirm={deletePlan}
      />
    </div>
  );
}
