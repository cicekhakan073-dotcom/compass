import Link from "next/link";
import { Compass, Home, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata = {
  title: "Bulunamadı · compass",
};

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-24 text-center">
      <p className="font-mono text-7xl font-black tracking-tighter text-primary">
        404
      </p>
      <h1 className="mt-4 flex items-center gap-2 text-2xl font-bold tracking-tight">
        <Compass aria-hidden className="size-5" />
        Yön bulunamadı
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Aradığın repo henüz indekslenmemiş, silinmiş ya da özel olabilir.
      </p>
      <div className="mt-6 flex gap-2">
        <Link href="/" className={buttonVariants({ variant: "default" })}>
          <Home aria-hidden className="size-4" />
          Ana sayfa
        </Link>
        <Link
          href="/discover"
          className={buttonVariants({ variant: "outline" })}
        >
          <Search aria-hidden className="size-4" />
          Discover
        </Link>
      </div>
    </div>
  );
}
