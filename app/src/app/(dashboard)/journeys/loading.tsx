import { Skeleton } from "@/components/ui/skeleton";

export default function JourneysLoading() {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <Skeleton className="h-[600px] w-full rounded-lg" />
    </div>
  );
}
