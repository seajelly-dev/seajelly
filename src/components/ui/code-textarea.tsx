"use client";

import * as React from "react";
import CodeMirror, { type ReactCodeMirrorProps } from "@uiw/react-codemirror";
import { json as jsonLanguage } from "@codemirror/lang-json";
import { markdown as markdownLanguage } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { placeholder as placeholderExtension } from "@codemirror/view";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

type CodeLanguage = "json" | "markdown" | "plain";

interface CodeEditorProps
  extends Omit<React.ComponentProps<"textarea">, "onChange"> {
  language?: CodeLanguage;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  showLineNumbers?: boolean;
  onFormat?: () => void;
}

function CodeEditor({
  className,
  language = "plain",
  value,
  onChange,
  error,
  showLineNumbers = false,
  onFormat,
  rows = 6,
  id,
  placeholder,
  disabled,
  readOnly,
  autoFocus,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme();
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  const numericRows = typeof rows === "number" ? rows : Number(rows) || 6;
  const editorHeight = Math.max(numericRows * 26, 120);

  const actualLines = React.useMemo(() => value.split("\n").length, [value]);

  React.useEffect(() => {
    if (language !== "json") {
      setJsonError(null);
      return;
    }
    if (!value.trim()) {
      setJsonError(null);
      return;
    }
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }, [value, language]);

  const extensions = React.useMemo(() => {
    const extensionList = [];
    if (language === "json") extensionList.push(jsonLanguage());
    if (language === "markdown") extensionList.push(markdownLanguage());
    if (placeholder) extensionList.push(placeholderExtension(placeholder));
    return extensionList;
  }, [language, placeholder]);

  const showNumbers = showLineNumbers || language === "markdown";
  const basicSetup = React.useMemo<ReactCodeMirrorProps["basicSetup"]>(
    () => ({
      lineNumbers: showNumbers,
      foldGutter: false,
      highlightActiveLineGutter: false,
      highlightSpecialChars: false,
      drawSelection: true,
      dropCursor: false,
      allowMultipleSelections: false,
      indentOnInput: language === "json",
      highlightActiveLine: false,
    }),
    [showNumbers, language],
  );

  const handleFormat = () => {
    if (onFormat) {
      onFormat();
      return;
    }
    if (language === "json" && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        onChange(JSON.stringify(parsed, null, 2));
      } catch {
        // can't format invalid JSON
      }
    }
  };

  const displayError = error || jsonError;

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1.5">
      {language === "json" && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            JSON
          </span>
          <button
            type="button"
            onClick={handleFormat}
            className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Format
          </button>
        </div>
      )}
      {language === "markdown" && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Markdown
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {actualLines} lines
          </span>
        </div>
      )}
      <div
        className={cn(
          "relative min-w-0 max-w-full overflow-hidden rounded-lg border transition-colors",
          displayError
            ? "border-destructive ring-1 ring-destructive/20"
            : "border-input focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          disabled && "opacity-70",
        )}
      >
        <CodeMirror
          id={id}
          value={value}
          onChange={(nextValue) => onChange(nextValue)}
          extensions={extensions}
          basicSetup={basicSetup}
          editable={!disabled && !readOnly}
          readOnly={Boolean(readOnly)}
          autoFocus={Boolean(autoFocus)}
          theme={resolvedTheme === "dark" ? oneDark : "light"}
          height={`${editorHeight}px`}
          className={cn(
            "w-full max-w-full",
            "[&_.cm-editor]:min-w-0 [&_.cm-editor]:max-w-full [&_.cm-editor]:bg-transparent [&_.cm-editor]:outline-none",
            "[&_.cm-scroller]:max-w-full [&_.cm-scroller]:overflow-auto [&_.cm-scroller]:font-mono",
            "[&_.cm-content]:px-3 [&_.cm-content]:py-2 [&_.cm-content]:font-mono [&_.cm-content]:text-sm [&_.cm-content]:leading-6.5",
            "[&_.cm-gutters]:border-r [&_.cm-gutters]:border-input [&_.cm-gutters]:bg-muted/50",
            "[&_.cm-gutterElement]:text-xs [&_.cm-gutterElement]:text-muted-foreground/50",
            "[&_.cm-placeholder]:text-sm [&_.cm-placeholder]:text-muted-foreground",
            !showNumbers && "[&_.cm-gutters]:hidden",
            language === "json" && "tabular-nums",
            className,
          )}
        />
      </div>
      {displayError && (
        <p className="text-xs text-destructive">{displayError}</p>
      )}
    </div>
  );
}

const CodeTextarea = CodeEditor;
type CodeTextareaProps = CodeEditorProps;

export { CodeEditor, CodeTextarea };
export type { CodeEditorProps, CodeTextareaProps, CodeLanguage };
