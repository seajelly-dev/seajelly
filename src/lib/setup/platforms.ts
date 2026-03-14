export type SetupPlatform =
  | "telegram"
  | "feishu"
  | "wecom"
  | "slack"
  | "qqbot"
  | "whatsapp"
  | "none";

export interface SetupPlatformField {
  name: string;
  label: string;
  secret: boolean;
}

export const SETUP_PLATFORM_FIELDS: Record<
  Exclude<SetupPlatform, "none">,
  SetupPlatformField[]
> = {
  telegram: [{ name: "bot_token", label: "Bot Token", secret: true }],
  feishu: [
    { name: "app_id", label: "App ID", secret: true },
    { name: "app_secret", label: "App Secret", secret: true },
    { name: "verification_token", label: "Verification Token", secret: true },
  ],
  wecom: [
    { name: "corp_id", label: "Corp ID", secret: true },
    { name: "corp_secret", label: "Corp Secret", secret: true },
    { name: "agent_id", label: "Agent ID", secret: false },
    { name: "token", label: "Token", secret: true },
    { name: "encoding_aes_key", label: "EncodingAESKey", secret: true },
  ],
  slack: [
    { name: "bot_token", label: "Bot Token", secret: true },
    { name: "signing_secret", label: "Signing Secret", secret: true },
  ],
  qqbot: [
    { name: "app_id", label: "AppID", secret: false },
    { name: "app_secret", label: "AppSecret", secret: true },
  ],
  whatsapp: [
    { name: "access_token", label: "Access Token", secret: true },
    { name: "phone_number_id", label: "Phone Number ID", secret: false },
    { name: "verify_token", label: "Verify Token", secret: true },
    { name: "app_secret", label: "App Secret", secret: true },
  ],
};

export const SETUP_GENERATED_FIELDS: Partial<Record<SetupPlatform, string[]>> = {
  feishu: ["verification_token"],
  whatsapp: ["verify_token"],
};

export function getMissingSetupPlatformFields(
  platform: SetupPlatform,
  credentials: Record<string, string>
) {
  if (platform === "none" || platform === "telegram") {
    return [];
  }

  return SETUP_PLATFORM_FIELDS[platform]
    .map((field) => field.name)
    .filter((fieldName) => !credentials[fieldName]?.trim());
}
