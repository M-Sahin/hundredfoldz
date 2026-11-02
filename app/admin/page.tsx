import type { Metadata } from "next";
import AdminReports from "../../components/AdminReports";

export const metadata: Metadata = { title: "Reports · Hundredfoldz", robots: { index: false } };

export default function Page() {
  return <AdminReports />;
}
