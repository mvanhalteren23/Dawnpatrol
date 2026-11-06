import { TownPage, townMetadata } from "@/components/site/TownPage";

export const dynamic = "force-dynamic";
export function generateMetadata({ params }: { params: Promise<{ town: string }> }) {
  return townMetadata("retail", params);
}

export default function Page({ params }: { params: Promise<{ town: string }> }) {
  return <TownPage trade="retail" params={params} />;
}
