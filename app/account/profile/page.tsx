import type { Metadata } from "next";
import ProfileSetup from "../../../components/ProfileSetup";

export const metadata: Metadata = { title: "Your profile · Hundredfoldz", robots: { index: false } };

export default function Page() {
  return <ProfileSetup />;
}
