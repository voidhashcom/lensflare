import { createFileRoute } from "@tanstack/react-router";

import { AboutSettingsPanel } from "~/components/settings/AboutSettingsPanel";

export const Route = createFileRoute("/settings/about")({
  component: AboutSettingsPanel,
});
