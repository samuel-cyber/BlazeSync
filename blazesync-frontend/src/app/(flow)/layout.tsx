import { Logo } from "@/components/shell/Logo";

/** Focused flows (setup, joining, claiming an invite): no navigation to wander off into. */
export default function FlowLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="mx-auto flex max-w-2xl items-center px-5 pt-6">
        <Logo />
      </header>
      <main id="main" className="view mx-auto w-full max-w-2xl px-5 pb-16 pt-8 sm:pt-12">
        {children}
      </main>
    </div>
  );
}
