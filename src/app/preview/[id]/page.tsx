import { notFound } from "next/navigation";
import { createStrictServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function getPreview(id: string) {
  const supabase = createStrictServiceClient();

  const { data, error } = await supabase
    .from("html_previews")
    .select("html, title, created_at, expires_at")
    .eq("id", id)
    .single();

  if (error || !data) return null;

  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  return data as { html: string; title: string; created_at: string };
}

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const preview = await getPreview(id);
  if (!preview) notFound();

  return (
    <html lang="en">
      <head>
        <title>{preview.title}</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
              iframe { border: none; width: 100%; height: 100%; display: block; }
            `,
          }}
        />
      </head>
      <body>
        <iframe
          srcDoc={preview.html}
          sandbox="allow-scripts"
          title={preview.title}
        />
      </body>
    </html>
  );
}
