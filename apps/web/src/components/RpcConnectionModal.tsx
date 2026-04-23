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
import { retryRpcConnection, useRpcConnectionState } from "~/data/rpcConnection";

export function RpcConnectionModal() {
  const { issue, retryError, retrying } = useRpcConnectionState();

  if (issue === null) {
    return null;
  }

  return (
    <AlertDialog open>
      <AlertDialogPopup bottomStickOnMobile={false}>
        <AlertDialogHeader>
          <AlertDialogTitle>{issue.title}</AlertDialogTitle>
          <AlertDialogDescription>{issue.description}</AlertDialogDescription>
          <div className="rounded-lg border bg-muted/50 px-3 py-2 font-mono text-muted-foreground text-xs">
            {issue.detail}
          </div>
          {retryError ? (
            <p className="text-destructive text-sm">{retryError}</p>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button disabled={retrying} onClick={() => void retryRpcConnection()}>
            <RefreshCcwIcon className={retrying ? "animate-spin" : undefined} />
            {retrying ? "Retrying..." : "Retry connection"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
