import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

function AppearanceSettingsRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({ to: "/settings/general", replace: true });
  }, [navigate]);

  return null;
}

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceSettingsRedirect,
});
