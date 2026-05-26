import { Skeleton } from "@/components/Skeleton";

export default function SignInLoading() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
