import { useState, useEffect } from "react";
import { Rocket, CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { adminTriggerDeploy, adminGetNotifications } from "@/services/admin-api";

type DeployStatus = "idle" | "deploying" | "success" | "failed";

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "الآن";
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
  return `منذ ${Math.floor(diff / 86400)} يوم`;
}

export function DeployPanel() {
  const [status, setStatus] = useState<DeployStatus>("idle");
  const [lastDeployAt, setLastDeployAt] = useState<string | null>(null);
  const [lastDeploySuccess, setLastDeploySuccess] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch last deploy attempt from notifications on mount
  useEffect(() => {
    adminGetNotifications()
      .then((notifications) => {
        const last = notifications.find((n) => n.type === "deploy_triggered");
        if (last) {
          setLastDeployAt(last.created_at);
          setLastDeploySuccess(last.title.includes("بنجاح"));
        }
      })
      .catch(() => {});
  }, []);

  async function handleDeploy() {
    if (status === "deploying") return;
    setStatus("deploying");
    setErrorMsg(null);

    try {
      const result = await adminTriggerDeploy();
      setLastDeployAt(result.triggeredAt);
      setLastDeploySuccess(true);
      setStatus("success");
      setTimeout(() => setStatus("idle"), 8000);
    } catch (err) {
      const msg = (err as Error & { message?: string }).message ?? "فشل تشغيل النشر";
      setErrorMsg(msg);
      setLastDeploySuccess(false);
      setStatus("failed");
      setTimeout(() => setStatus("idle"), 10000);
    }
  }

  const buttonLabel = {
    idle: "نشر تحديث",
    deploying: "جاري النشر...",
    success: "تم إرسال طلب النشر",
    failed: "فشل النشر — إعادة المحاولة",
  }[status];

  const buttonIcon = {
    idle: <Rocket size={15} />,
    deploying: <Loader2 size={15} className="animate-spin" />,
    success: <CheckCircle2 size={15} />,
    failed: <XCircle size={15} />,
  }[status];

  const buttonStyle = {
    idle: "bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20",
    deploying: "bg-primary/40 text-white/70 cursor-not-allowed",
    success: "bg-emerald-600/20 text-emerald-400 border border-emerald-500/30",
    failed: "bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30",
  }[status];

  return (
    <div className="bg-white/[0.03] border border-border rounded-2xl p-4 space-y-3" dir="rtl">
      <div className="flex items-center gap-2">
        <Rocket size={15} className="text-primary shrink-0" />
        <span className="text-sm font-semibold text-white">نشر وتحديث</span>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        يرسل طلب نشر فوري إلى Vercel. المفتاح السري محفوظ على الخادم فقط.
        يُسمح بنشر واحد كل 60 ثانية.
      </p>

      {/* Last deploy status */}
      {lastDeployAt && (
        <div
          className={cn(
            "flex items-center gap-2 text-[11px] px-3 py-2 rounded-xl border",
            lastDeploySuccess
              ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-400"
              : "bg-red-500/8 border-red-500/20 text-red-400",
          )}
        >
          {lastDeploySuccess ? (
            <CheckCircle2 size={12} className="shrink-0" />
          ) : (
            <XCircle size={12} className="shrink-0" />
          )}
          <span>
            {lastDeploySuccess ? "آخر نشر ناجح" : "فشل آخر نشر"}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground mr-auto">
            <Clock size={10} />
            {timeAgo(lastDeployAt)}
          </span>
        </div>
      )}

      {/* Error detail */}
      {errorMsg && status === "failed" && (
        <div className="text-[11px] text-red-400/80 bg-red-500/5 border border-red-500/15 rounded-xl px-3 py-2">
          {errorMsg}
        </div>
      )}

      {/* Deploy button */}
      <button
        onClick={handleDeploy}
        disabled={status === "deploying"}
        className={cn(
          "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all",
          buttonStyle,
        )}
      >
        {buttonIcon}
        {buttonLabel}
      </button>
    </div>
  );
}
