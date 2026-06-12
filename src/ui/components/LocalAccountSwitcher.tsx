import { useMemo, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Check,
  ChevronUp,
  KeyRound,
  Loader2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/auth";
import {
  listLocalWorkspaceAccounts,
  type LocalWorkspaceAccount,
} from "@/auth/localAccountAuth";
import { cn } from "@/lib/utils";
import { platformService } from "@/services/platformService";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Input } from "./input";
import { Label } from "./label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface LocalAccountSwitcherProps {
  isCompact: boolean;
}

function AccountAvatar({
  account,
  className,
}: {
  account: Pick<LocalWorkspaceAccount, "name" | "profileUrl">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-emerald-600 font-bold text-white shadow-sm",
        className,
      )}
    >
      {account.profileUrl ? (
        <img
          src={
            account.profileUrl.startsWith("http")
              ? account.profileUrl
              : platformService.convertFileSrc(account.profileUrl)
          }
          alt={account.name}
          className="h-full w-full object-cover"
        />
      ) : (
        account.name.charAt(0).toUpperCase() || "U"
      )}
    </span>
  );
}

export function LocalAccountSwitcher({
  isCompact,
}: LocalAccountSwitcherProps) {
  const { t } = useTranslation();
  const { user, switchLocalAccount } = useAuth();
  const [selectedAccount, setSelectedAccount] =
    useState<LocalWorkspaceAccount | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  const storedAccounts = useLiveQuery(
    () => listLocalWorkspaceAccounts(user?.workspaceId ?? ""),
    [user?.workspaceId],
    [],
  );

  const accounts = useMemo(() => {
    if (!user?.workspaceId) return storedAccounts;
    if (storedAccounts.some((account) => account.id === user.id)) {
      return storedAccounts;
    }

    return [
      {
        id: user.id,
        workspaceId: user.workspaceId,
        email: user.email,
        name: user.name,
        role: user.role,
        profileUrl: user.profileUrl,
        hasCredential: false,
      },
      ...storedAccounts,
    ];
  }, [storedAccounts, user]);

  if (!user || user.workspaceMode !== "local") {
    return null;
  }

  const currentAccount: LocalWorkspaceAccount = {
    id: user.id,
    workspaceId: user.workspaceId,
    email: user.email,
    name: user.name,
    role: user.role,
    profileUrl: user.profileUrl,
    hasCredential:
      accounts.find((account) => account.id === user.id)?.hasCredential ?? false,
  };

  const openPasswordDialog = (account: LocalWorkspaceAccount) => {
    setSelectedAccount(account);
    setPassword("");
    setError(null);
  };

  const closePasswordDialog = () => {
    if (isSwitching) return;
    setSelectedAccount(null);
    setPassword("");
    setError(null);
  };

  const handleSwitch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedAccount || !password) return;

    setIsSwitching(true);
    setError(null);
    const result = await switchLocalAccount(selectedAccount.id, password);
    if (result.error) {
      setError(result.error.message);
      setIsSwitching(false);
      return;
    }

    window.location.reload();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-start transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              isCompact && "flex-col gap-1 px-1",
            )}
            title={t("accounts.openSwitcher", {
              defaultValue: "Switch local account",
            })}
          >
            <AccountAvatar account={currentAccount} className="h-9 w-9 text-sm" />
            {!isCompact && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {currentAccount.name}
                </p>
                <p className="truncate text-xs capitalize text-muted-foreground">
                  {currentAccount.role}
                </p>
              </div>
            )}
            <ChevronUp
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground",
                isCompact && "h-3.5 w-3.5",
              )}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-[280px] rounded-xl border-border/70 bg-background/95 p-2 backdrop-blur-xl"
        >
          <DropdownMenuLabel className="pb-2">
            <div className="space-y-1">
              <p>
                {t("accounts.switchAccount", {
                  defaultValue: "Switch Account",
                })}
              </p>
              <p className="text-xs font-normal text-muted-foreground">
                {t("accounts.localWorkspaceOnly", {
                  defaultValue: "Accounts available in this local workspace",
                })}
              </p>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="max-h-[280px] overflow-y-auto">
            {accounts.length === 0 ? (
              <DropdownMenuItem
                disabled
                className="rounded-lg px-3 py-2 text-xs text-muted-foreground data-[disabled]:opacity-100"
              >
                {t("accounts.noneAvailable", {
                  defaultValue: "No local accounts available.",
                })}
              </DropdownMenuItem>
            ) : (
              accounts.map((account) => {
                const isCurrent = account.id === user.id;
                const isCurrentAndReady = isCurrent && account.hasCredential;

                return (
                  <DropdownMenuItem
                    key={account.id}
                    disabled={isCurrentAndReady}
                    onSelect={() => openPasswordDialog(account)}
                    className="gap-3 rounded-lg px-3 py-2 data-[disabled]:opacity-100"
                  >
                    <span className="relative">
                      <AccountAvatar
                        account={account}
                        className="h-8 w-8 text-xs"
                      />
                      {isCurrent && (
                        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
                          <Check className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-foreground">
                        {account.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {account.hasCredential
                          ? t("accounts.offlineReady", {
                              defaultValue: "Offline ready",
                            })
                          : account.email
                            ? t("accounts.setupRequired", {
                                defaultValue: "Password setup required",
                              })
                            : t("accounts.onlineSignInRequired", {
                                defaultValue: "Online sign-in required",
                              })}
                      </p>
                    </div>
                    {account.hasCredential ? (
                      <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <KeyRound className="h-4 w-4 shrink-0 text-amber-500" />
                    )}
                  </DropdownMenuItem>
                );
              })
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={Boolean(selectedAccount)}
        onOpenChange={(open) => {
          if (!open) closePasswordDialog();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSwitch} className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserRound className="h-5 w-5 text-primary" />
                {selectedAccount?.id === user.id
                  ? t("accounts.prepareOffline", {
                      defaultValue: "Prepare Offline Access",
                    })
                  : t("accounts.confirmSwitch", {
                      defaultValue: "Confirm Account Switch",
                    })}
              </DialogTitle>
              <DialogDescription>
                {selectedAccount?.hasCredential
                  ? t("accounts.enterPasswordFor", {
                      defaultValue:
                        "Enter {{name}}'s password to switch accounts.",
                      name: selectedAccount.name,
                    })
                  : t("accounts.firstSetupDescription", {
                      defaultValue:
                        "This account needs one online password validation on this device. Future switches will work fully offline.",
                    })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/35 p-3">
              {selectedAccount && (
                <AccountAvatar
                  account={selectedAccount}
                  className="h-10 w-10 text-sm"
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {selectedAccount?.name}
                </p>
                <p className="truncate text-xs capitalize text-muted-foreground">
                  {selectedAccount?.role}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="local-account-password">
                {t("auth.password", { defaultValue: "Password" })}
              </Label>
              <Input
                id="local-account-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSwitching}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                allowViewer
                onClick={closePasswordDialog}
                disabled={isSwitching}
              >
                {t("common.cancel", { defaultValue: "Cancel" })}
              </Button>
              <Button
                type="submit"
                allowViewer
                disabled={!password || isSwitching}
              >
                {isSwitching && <Loader2 className="h-4 w-4 animate-spin" />}
                {selectedAccount?.id === user.id
                  ? t("accounts.prepare", { defaultValue: "Prepare" })
                  : t("accounts.switch", { defaultValue: "Switch Account" })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
