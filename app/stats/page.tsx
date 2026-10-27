import type { Metadata } from "next";
import StatsPage from "../../components/StatsPage";

export const metadata: Metadata = { title: "Stats · Hundredfoldz", robots: { index: false, follow: false } };

export default function Page() {
  return <StatsPage />;
}
