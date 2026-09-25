import { redirect } from "next/navigation";

/** The short link in invite messages (blazesync.app/c/CODE) goes to the claim flow. */
export default async function ShortInvite({ params }: PageProps<"/c/[code]">) {
  const { code } = await params;
  redirect(`/claim/${encodeURIComponent(code)}`);
}
