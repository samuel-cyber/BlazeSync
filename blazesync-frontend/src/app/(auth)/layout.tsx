import { Logo } from "@/components/shell/Logo";
import { ShieldCheck } from "lucide-react";

/** Auth screens: one narrow column, nothing competing with the form. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="px-5 pt-6 sm:px-8">
        <Logo />
      </header>
      <main id="main" className="view mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        {children}
      </main>
      <footer className="mx-auto flex w-full max-w-md items-start gap-2 px-5 pb-8 text-sm text-ink-3">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p>We store your password as a one-way hash. We can check it when you log in, but no one, including us, can read it back.</p>
      </footer>
    </div>
  );
}
