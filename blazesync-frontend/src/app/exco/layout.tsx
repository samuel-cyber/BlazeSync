import { AppShell } from "@/components/shell/AppShell";

export default function ExcoLayout({ children }: LayoutProps<"/exco">) {
  return <AppShell role="exco">{children}</AppShell>;
}
