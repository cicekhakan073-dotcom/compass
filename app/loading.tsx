import { Skeleton } from "@/components/Skeleton";

export default function RootLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-24">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-12 w-full max-w-xl" />
    </div>
  );
}
