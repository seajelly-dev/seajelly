import { cn } from "@/lib/utils";

export function CrabLogo({
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
      {/* claws */}
      <path
        d="M10 18c-4-6-2-14 4-14s8 6 6 12"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M54 18c4-6 2-14-4-14s-8 6-6 12"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="12" cy="6" r="2.5" fill="currentColor" />
      <circle cx="52" cy="6" r="2.5" fill="currentColor" />
      {/* body */}
      <ellipse cx="32" cy="36" rx="20" ry="16" fill="currentColor" opacity="0.15" />
      <ellipse
        cx="32"
        cy="36"
        rx="20"
        ry="16"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      {/* eyes */}
      <circle cx="25" cy="30" r="3" fill="currentColor" />
      <circle cx="39" cy="30" r="3" fill="currentColor" />
      <circle cx="25.8" cy="29.2" r="1" fill="white" />
      <circle cx="39.8" cy="29.2" r="1" fill="white" />
      {/* mouth */}
      <path
        d="M28 39c2 2 6 2 8 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* legs left */}
      <path d="M14 32l-6 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M13 38l-8 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M14 44l-6 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* legs right */}
      <path d="M50 32l6 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M51 38l8 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M50 44l6 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
