import { Suspense } from "react";
import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { UserMenu } from "./UserMenu";

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground"
          >
            <Compass className="size-4" />
          </span>
          <span className="text-lg font-bold tracking-tight">compass</span>
        </Link>

        <nav className="ml-auto flex items-center gap-1">
          <Link
            href="/discover"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            Discover
          </Link>
          <Suspense fallback={null}>
            <UserMenu />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
