import { Skeleton } from "@/components/ui/skeleton";

export default function SecretsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-28" />
          <Skeleton className="mt-2 h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
      <div className="rounded-xl p-4 ring-1 ring-foreground/10">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-4 flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}
