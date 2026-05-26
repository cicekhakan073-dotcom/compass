import { Skeleton } from "@/components/Skeleton";

export default function InstallLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-8 h-4 w-80" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}
