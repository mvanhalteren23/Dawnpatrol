import { TownPage, townMetadata } from "@/components/site/TownPage";

export const dynamic = "force-dynamic";
export function generateMetadata({ params }: { params: Promise<{ town: string }> }) {
  return townMetadata("mechanics", params);
}

export default function Page({ params }: { params: Promise<{ town: string }> }) {
  return <TownPage trade="mechanics" params={params} />;
}
