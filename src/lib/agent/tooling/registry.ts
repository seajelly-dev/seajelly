import { SELF_EVOLUTION_TOOLKIT } from "./toolkits/self-evolution";
import { JELLYBOX_TOOLKIT } from "./toolkits/jellybox";

export const BUILTIN_TOOLKIT_RUNTIME_REGISTRY = [
  SELF_EVOLUTION_TOOLKIT,
  JELLYBOX_TOOLKIT,
] as const;
