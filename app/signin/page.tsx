import { redirect } from "next/navigation";
import { GitBranch } from "lucide-react";
import { auth, githubConfigured, signIn } from "@/auth";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Giriş — compass",
};

export default async function SignInPage(props: PageProps<"/signin">) {
  const session = await auth();
  if (session?.user) redirect("/");

  const sp = await props.searchParams;
  const callbackUrl =
    typeof sp.callbackUrl === "string" ? sp.callbackUrl : "/";
  const error = typeof sp.error === "string" ? sp.error : null;
  const configured = githubConfigured();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          compass'a giriş
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Özel repo'larını da indekslemek için GitHub OAuth kullanıyoruz —
          compass yalnızca okur, hiçbir şey yazmaz.
        </p>
      </header>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Giriş hatası: {error}
        </div>
      )}

      {configured ? (
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: callbackUrl });
          }}
        >
          <button
            type="submit"
            className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
          >
            <GitBranch aria-hidden className="size-4" />
            GitHub ile devam et
          </button>
        </form>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-card/40 px-4 py-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            GitHub OAuth yapılandırılmamış.
          </p>
          <p className="mt-2">
            <code>.env.local</code> içine ekle:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs text-foreground">
{`AUTH_GITHUB_ID=Iv1.xxxxxxxxxxxxxxxx
AUTH_GITHUB_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}
          </pre>
          <p className="mt-3 text-xs">
            GitHub OAuth App oluştur:{" "}
            <a
              className="text-primary hover:underline"
              href="https://github.com/settings/developers"
              target="_blank"
              rel="noreferrer"
            >
              github.com/settings/developers
            </a>
            <br />
            Authorization callback URL:{" "}
            <code className="text-foreground">
              {`{origin}/api/auth/callback/github`}
            </code>
          </p>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        İstenilen scope'lar:{" "}
        <code className="text-foreground">read:user</code>,{" "}
        <code className="text-foreground">user:email</code>,{" "}
        <code className="text-foreground">public_repo</code>,{" "}
        <code className="text-foreground">repo</code>
      </p>
    </div>
  );
}
