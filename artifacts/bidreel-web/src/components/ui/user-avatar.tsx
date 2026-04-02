import { cn } from "@/lib/utils";

interface UserAvatarProps {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}

export function UserAvatar({ src, name, size = 28, className }: UserAvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        style={{ width: size, height: size }}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  return (
    <div
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      className={cn(
        "rounded-full bg-primary/30 border border-primary/50 flex items-center justify-center text-white font-bold shrink-0",
        className,
      )}
    >
      {initials}
    </div>
  );
}
