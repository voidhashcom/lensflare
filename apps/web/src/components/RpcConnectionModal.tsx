import { RefreshCcwIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { reloadApp, retryConnection, useConnectionState } from "~/data/rpcConnectionManager";

export function RpcConnectionModal() {
  const { issue, retryError, retrying, autoRetrying, attempts } = useConnectionState();

  if (issue === null) {
    return null;
  }

  const busy = retrying || autoRetrying;
  const exhaustedAutoRetries = attempts >= 4 && retryError !== null;

  const buttonLabel = retrying
    ? "Retrying..."
    : autoRetrying
      ? "Reconnecting..."
      : "Retry connection";

  return (
    <AlertDialog open>
      <AlertDialogPopup bottomStickOnMobile={false}>
        <AlertDialogHeader>
          <AlertDialogTitle>{issue.title}</AlertDialogTitle>
          <AlertDialogDescription>{issue.description}</AlertDialogDescription>
          <div className="rounded-lg border bg-muted/50 px-3 py-2 font-mono text-muted-foreground text-xs">
            {issue.detail}
          </div>
          {retryError ? <p className="text-destructive text-sm">{retryError}</p> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button disabled={busy} onClick={() => void retryConnection()}>
            <RefreshCcwIcon className={busy ? "animate-spin" : undefined} />
            {buttonLabel}
          </Button>
          {exhaustedAutoRetries ? (
            <Button variant="secondary" onClick={reloadApp}>
              Reload Lensflare
            </Button>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
