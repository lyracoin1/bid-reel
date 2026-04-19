import { ShieldCheck } from "lucide-react";

export type TrustColor = "green" | "yellow" | "red" | null;

const COLOR_MAP: Record<NonNullable<TrustColor>, { dot: string; text: string; bg: string; border: string }> = {
  green:  { dot: "bg-emerald-400", text: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/25" },
  yellow: { dot: "bg-amber-400",   text: "text-amber-300",   bg: "bg-amber-500/10",   border: "border-amber-500/25" },
  red:    { dot: "bg-red-400",     text: "text-red-300",     bg: "bg-red-500/10",     border: "border-red-500/25" },
};

export function colorForScore(score: number | null | undefined): TrustColor {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  if (score >= 80) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

interface TrustBadgeProps {
  score: number | null | undefined;
  color?: TrustColor;
  size?: "xs" | "sm" | "md";
  showLabel?: boolean;
  label?: string;
  className?: string;
}

/**
 * Compact trust indicator — colored dot + percentage. Used inline next to a
 * seller name (xs/sm) or as a stat tile (md).
 *
 * Score is the final blended trust value (0–100, completion*0.85 + review*0.15).
 * Null score → neutral gray "new user" pill.
 */
export function TrustBadge({ score, color, size = "sm", showLabel = false, label, className = "" }: TrustBadgeProps) {
  const resolvedColor = color ?? colorForScore(score);
  const palette = resolvedColor ? COLOR_MAP[resolvedColor] : null;
  const pct = score === null || score === undefined ? null : Math.round(score);

  const dim =
    size === "xs" ? { dot: "w-1.5 h-1.5", text: "text-[10px]", pad: "px-1.5 py-0.5", gap: "gap-1" }
    : size === "sm" ? { dot: "w-2 h-2",   text: "text-[11px]", pad: "px-2 py-0.5",   gap: "gap-1.5" }
    : { dot: "w-2.5 h-2.5", text: "text-xs", pad: "px-2.5 py-1", gap: "gap-1.5" };

  if (palette) {
    return (
      <span
        className={[
          "inline-flex items-center rounded-full border font-bold tabular-nums",
          palette.bg, palette.border, palette.text, dim.pad, dim.gap, dim.text, className,
        ].join(" ")}
        title={label ?? `Trust ${pct}%`}
      >
        <span className={`rounded-full ${palette.dot} ${dim.dot}`} />
        <span>{pct}%</span>
        {showLabel && label ? <span className="font-medium opacity-80">{label}</span> : null}
      </span>
    );
  }

  // No score yet (new user)
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border border-white/10 bg-white/5 text-white/45",
        "font-semibold", dim.pad, dim.gap, dim.text, className,
      ].join(" ")}
      title="New user — no completed deals yet"
    >
      <ShieldCheck size={size === "md" ? 12 : 10} />
      <span>New</span>
      {showLabel && label ? <span className="opacity-70">· {label}</span> : null}
    </span>
  );
}

interface TrustStatCardProps {
  title: string;
  score: number | null | undefined;
  color?: TrustColor;
  completed: number;
  total: number;
  reviewsCount?: number;
}

/** Larger stat card for profile pages — shows score + completed/total ratio. */
export function TrustStatCard({ title, score, color, completed, total, reviewsCount }: TrustStatCardProps) {
  const resolved = color ?? colorForScore(score);
  const palette = resolved ? COLOR_MAP[resolved] : null;
  const pct = score === null || score === undefined ? null : Math.round(score);

  return (
    <div className="bg-white/5 border border-white/8 rounded-2xl p-3.5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{title}</span>
        {palette ? (
          <span className={`rounded-full ${palette.dot} w-2 h-2`} />
        ) : (
          <span className="rounded-full bg-white/15 w-2 h-2" />
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        {pct === null ? (
          <span className="text-xl font-bold text-white/40 leading-none">—</span>
        ) : (
          <span className={`text-2xl font-bold leading-none tabular-nums ${palette ? palette.text : "text-white/60"}`}>
            {pct}<span className="text-sm font-semibold opacity-70">%</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-white/45 font-medium">
        <span className="tabular-nums">{completed}/{total} done</span>
        {typeof reviewsCount === "number" && reviewsCount > 0 && (
          <>
            <span className="text-white/20">·</span>
            <span className="tabular-nums">{reviewsCount} reviews</span>
          </>
        )}
      </div>
    </div>
  );
}
