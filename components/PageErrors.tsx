"use client";
// Counts uncaught page errors for the /stats page (cleaned messages, no details about the visitor).
import { useEffect } from "react";
import { trackPageErrors } from "../lib/client/track";

export function PageErrors() {
  useEffect(() => trackPageErrors(), []);
  return null;
}
