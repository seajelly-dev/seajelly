import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

export function AnthropicIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M13.83 3h3.34L22 21h-3.34l-4.83-18Zm-6.49 0h3.34L15.5 21h-3.34L9.12 12.3 6.08 21H2.74l4.6-18Z" fill="currentColor" />
    </svg>
  );
}

export function OpenAIIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M22.28 9.37a6.2 6.2 0 0 0-.53-5.1A6.27 6.27 0 0 0 15 1.26a6.24 6.24 0 0 0-4.72 2.16A6.2 6.2 0 0 0 6.13 2a6.27 6.27 0 0 0-4.33 6.89 6.2 6.2 0 0 0-1.23 4.69 6.27 6.27 0 0 0 6.76 5.01A6.2 6.2 0 0 0 12 22.74a6.27 6.27 0 0 0 5.87-4.15 6.2 6.2 0 0 0 4.14-1.43 6.27 6.27 0 0 0 .27-7.79ZM12 20.93a4.38 4.38 0 0 1-2.82-1.03l.14-.08 4.68-2.7a.76.76 0 0 0 .39-.66v-6.6l1.98 1.14a.07.07 0 0 1 .04.05v5.47a4.43 4.43 0 0 1-4.41 4.41Zm-9.49-4.04a4.37 4.37 0 0 1-.52-2.94l.14.08 4.68 2.7a.77.77 0 0 0 .77 0l5.72-3.3v2.28a.07.07 0 0 1-.03.06l-4.74 2.74a4.43 4.43 0 0 1-6.02-1.62Zm-1.24-10.3a4.38 4.38 0 0 1 2.29-1.92v5.56a.76.76 0 0 0 .38.66l5.72 3.3-1.98 1.14a.07.07 0 0 1-.07 0l-4.73-2.73a4.43 4.43 0 0 1-1.61-6.01Zm16.33 3.8L11.88 7.1l1.98-1.14a.07.07 0 0 1 .07 0l4.73 2.73a4.43 4.43 0 0 1-.68 7.94v-5.56a.77.77 0 0 0-.38-.67Zm1.97-2.95-.14-.08-4.68-2.71a.77.77 0 0 0-.77 0l-5.72 3.3V5.77a.07.07 0 0 1 .03-.06l4.73-2.73a4.43 4.43 0 0 1 6.55 4.56ZM8.68 13.35l-1.98-1.14a.07.07 0 0 1-.04-.05V6.68a4.43 4.43 0 0 1 7.26-3.4l-.14.08-4.68 2.7a.76.76 0 0 0-.39.66l-.03 6.63Zm1.07-2.32L12 9.54l2.25 1.3v2.6L12 14.73l-2.25-1.3v-2.4Z" fill="currentColor" />
    </svg>
  );
}

export function GoogleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853" />
      <path d="M5.84 14.09a6.56 6.56 0 0 1 0-4.18V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84Z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z" fill="#EA4335" />
    </svg>
  );
}

export function DeepSeekIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#4D6BFE" />
      <path d="M7 8h3v8H7V8Zm4 0h3l3 4-3 4h-3l3-4-3-4Z" fill="white" />
    </svg>
  );
}

export function GroqIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#F55036" />
      <path d="M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 9.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" fill="white" />
      <rect x="14" y="11" width="5" height="2.5" rx="1" fill="white" />
    </svg>
  );
}

export function OpenRouterIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#6366F1" />
      <path d="M6 12h12M12 6v12M8 8l8 8M16 8l-8 8" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ZhipuIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#1A56DB" />
      <path d="M6 7h12v2H6V7Zm2 4h8v2H8v-2Zm-2 4h12v2H6v-2Z" fill="white" />
    </svg>
  );
}

export function MoonshotIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#111827" />
      <path d="M12 4a8 8 0 1 0 0 16A6 6 0 0 1 12 4Z" fill="#FBBF24" />
    </svg>
  );
}

export function MiniMaxIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#7C3AED" />
      <path d="M6 16V8l3 4 3-4 3 4 3-4v8" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DashScopeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#FF6A00" />
      <path d="M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" fill="white" />
      <circle cx="12" cy="12" r="2" fill="white" />
    </svg>
  );
}

export function SiliconFlowIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#0EA5E9" />
      <path d="M7 17c2-3 3-7 5-10s3 7 5 10" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function VolcEngineIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#3B82F6" />
      <path d="M12 5 5 19h14L12 5Zm0 4.5L16 17H8l4-7.5Z" fill="white" />
    </svg>
  );
}

const PROVIDER_ICON_MAP: Record<string, React.FC<IconProps>> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  google: GoogleIcon,
  deepseek: DeepSeekIcon,
  groq: GroqIcon,
  openrouter: OpenRouterIcon,
  "zhipu ai": ZhipuIcon,
  moonshot: MoonshotIcon,
  minimax: MiniMaxIcon,
  dashscope: DashScopeIcon,
  siliconflow: SiliconFlowIcon,
  volcengine: VolcEngineIcon,
};

export function ProviderIcon({ name, ...props }: IconProps & { name: string }) {
  const key = name.toLowerCase();
  const Icon = PROVIDER_ICON_MAP[key];
  if (Icon) return <Icon {...props} />;
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="currentColor" opacity="0.15" />
      <text x="12" y="16" textAnchor="middle" fontSize="12" fill="currentColor" fontWeight="bold">
        {name.charAt(0).toUpperCase()}
      </text>
    </svg>
  );
}
