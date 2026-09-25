import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ClientsLoading() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-9 w-28" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-10 w-80" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
