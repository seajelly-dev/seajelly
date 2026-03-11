import { cn } from "@/lib/utils";

export function SeajellyLogo({
  className,
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
    >
      {/* bell / dome */}
      <path
        d="M32 6C18 6 10 18 10 28c0 6 4 10 22 10s22-4 22-10C54 18 46 6 32 6Z"
        fill="currentColor"
        opacity="0.15"
      />
      <path
        d="M32 6C18 6 10 18 10 28c0 6 4 10 22 10s22-4 22-10C54 18 46 6 32 6Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* eyes */}
      <circle cx="25" cy="22" r="3" fill="currentColor" />
      <circle cx="39" cy="22" r="3" fill="currentColor" />
      <circle cx="25.8" cy="21.2" r="1" fill="white" />
      <circle cx="39.8" cy="21.2" r="1" fill="white" />
      {/* smile */}
      <path
        d="M28 29c2 2 6 2 8 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* tentacles */}
      <path d="M18 38c-2 6-1 14 1 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M25 38c-1 7 0 14 0 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M32 38c0 7 0 14 0 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M39 38c1 7 0 14 0 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M46 38c2 6 1 14-1 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
