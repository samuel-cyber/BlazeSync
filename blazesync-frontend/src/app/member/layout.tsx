import { AppShell } from "@/components/shell/AppShell";

export default function MemberLayout({ children }: LayoutProps<"/member">) {
  return <AppShell role="member">{children}</AppShell>;
}
