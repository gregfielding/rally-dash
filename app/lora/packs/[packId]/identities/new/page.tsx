export async function generateStaticParams() {
  // We don't pre-render any specific packs at build time for the "new"
  // identity route; this page relies on client-side data fetching.
  return [];
}

import NewIdentityContent from "./NewIdentityContent";

export default function NewIdentityPage() {
  return <NewIdentityContent />;
}
