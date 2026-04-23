import { Logo } from "~/components/Logo";

export function WorkspaceEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Logo className="h-12 w-auto opacity-30" />
      <h1 className="text-xl font-semibold tracking-tight mt-8">Welcome to Lensflare</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Pick a project on the left to start exploring its OpenTelemetry collections, or create a new
        one.
      </p>
    </div>
  );
}
