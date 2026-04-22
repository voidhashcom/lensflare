import { createFileRoute } from "@tanstack/react-router";
import { TelescopeIcon } from "lucide-react";

export const Route = createFileRoute("/")({
  component: WelcomeView,
});

function WelcomeView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <TelescopeIcon className="size-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold tracking-tight">Welcome to Lensflare</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Pick a project on the left to start exploring its OpenTelemetry collections, or
        create a new one.
      </p>
    </div>
  );
}
