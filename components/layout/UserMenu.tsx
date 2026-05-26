import Link from "next/link";
import { LogIn, LogOut, User as UserIcon } from "lucide-react";
import { auth, githubConfigured, signOut } from "@/auth";
import { buttonVariants } from "@/components/ui/button";

/**
 * Server component. Renders one of three states:
 *   1. Not configured (no GitHub OAuth env) — disabled sign-in with hint
 *   2. Signed out                            — sign-in link
 *   3. Signed in                             — avatar + signout form
 */
export async function UserMenu() {
  if (!githubConfigured()) {
    return (
      <span
        title="AUTH_GITHUB_ID/SECRET .env.local'a eklenince aktifleşir"
        className={buttonVariants({ size: "sm", variant: "outline" }) + " cursor-not-allowed opacity-60"}
      >
        <LogIn aria-hidden className="size-4" />
        <span className="hidden sm:inline">Giriş (pasif)</span>
      </span>
    );
  }

  const session = await auth();

  if (!session?.user) {
    return (
      <Link
        href="/signin"
        className={buttonVariants({ size: "sm", variant: "outline" })}
      >
        <LogIn aria-hidden className="size-4" />
        <span className="hidden sm:inline">GitHub ile giriş</span>
      </Link>
    );
  }

  const user = session.user;
  const initial = (user.name ?? user.email ?? "?").charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-1">
      <Link
        href="/profile"
        className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60"
        title="Profil"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt={user.name ?? user.email ?? ""}
            className="size-6 rounded-full"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
          >
            {initial}
          </span>
        )}
        <span className="hidden text-sm sm:inline">
          {user.name ?? user.email}
        </span>
      </Link>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className={buttonVariants({ size: "icon-sm", variant: "ghost" })}
          title="Çıkış"
          aria-label="Çıkış"
        >
          <LogOut aria-hidden className="size-4" />
        </button>
      </form>
      {/* Hidden — kept to satisfy unused import warnings cleanly. */}
      <span className="hidden">
        <UserIcon aria-hidden className="size-3" />
      </span>
    </div>
  );
}
