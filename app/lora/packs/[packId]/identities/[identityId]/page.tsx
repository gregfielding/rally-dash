export async function generateStaticParams(): Promise<
  { packId: string; identityId: string }[]
> {
  // We don't pre-render any specific identities at build time; everything
  // is handled via client-side data fetching after hydration.
  return [];
}

import ProtectedRoute from "@/components/ProtectedRoute";
import IdentityDetailContent from "./IdentityDetailContent";

export default function IdentityDetailPage() {
  return (
    <ProtectedRoute requiredRole="ops">
      <IdentityDetailContent />
    </ProtectedRoute>
  );
}


