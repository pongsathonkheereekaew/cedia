// FILE: CediaUsageSurface.tsx
// Purpose: Render owner-requested provider usage above the Cedia composer.
// Layer: Chat composer UI

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { UsageGaugeIcon } from "~/lib/icons";
import { Button } from "../ui/button";
import { ComposerStackedPanel } from "./ComposerStackedPanel";
import {
  serverCreditsQueryOptions,
  serverCreditsRedeemMutationOptions,
  serverUsageQueryOptions,
  type CediaCredit,
  type CediaCreditAccount,
  type CediaCreditRedeem,
  type CediaCreditTarget,
  type CediaCreditsAnswer,
  type CediaUsageAmount,
  type CediaUsageAnswer,
  type CediaUsageCredit,
  type CediaUsageLimit,
  type CediaUsageReport,
} from "../../lib/serverReactQuery";

function errorMessage(error: unknown, fallback = "The Cedia usage route is unavailable."): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return fallback;
  }
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0
    ? `${error.message} (${code})`
    : error.message;
}

function fetchedAt(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function amountNumber(value: number | undefined): string {
  return value === undefined ? "unknown" : String(value);
}

function amountText(label: string, value: number | undefined, unit: string): string {
  return `${label}: ${amountNumber(value)}${unit ? ` ${unit}` : ""}`;
}

function UsageAmount({ amount }: { readonly amount: CediaUsageAmount }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground" aria-label={`Amount in ${amount.unit}`}>
      <span>Unit: {amount.unit}</span>
      <span>{amountText("Used", amount.used, amount.unit)}</span>
      <span>{amountText("Limit", amount.limit, amount.unit)}</span>
      <span>Used fraction: {amountNumber(amount.usedFraction)}</span>
      <span>Remaining fraction: {amountNumber(amount.remainingFraction)}</span>
    </div>
  );
}

function UsageLimit({ limit }: { readonly limit: CediaUsageLimit }) {
  return (
    <li className="space-y-1 rounded-md border border-border/60 bg-background/50 px-2 py-1.5" data-usage-limit={limit.id}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="min-w-0 truncate text-[11px] font-medium text-foreground/85">{limit.label}</span>
        {limit.status ? <span className="shrink-0 text-[10px] text-muted-foreground">{limit.status}</span> : null}
      </div>
      {limit.window ? (
        <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          <span>Window: {limit.window.label}</span>
          {limit.window.resetsAt === undefined ? null : <span>Resets: {fetchedAt(limit.window.resetsAt)}</span>}
        </div>
      ) : null}
      <UsageAmount amount={limit.amount} />
      {limit.notes?.length ? <p className="text-[10px] leading-relaxed text-muted-foreground">{limit.notes.join(" · ")}</p> : null}
    </li>
  );
}

function UsageCredit({ credit, index }: { readonly credit: CediaUsageCredit; readonly index: number }) {
  return (
    <li className="text-[10px] text-muted-foreground">
      Credit {index + 1}
      {credit.expiresAt ? ` · expires ${credit.expiresAt}` : ""}
      {credit.grantedAt ? ` · granted ${credit.grantedAt}` : ""}
      {credit.status ? ` · ${credit.status}` : ""}
    </li>
  );
}

export interface CediaRedeemConfirmation {
  readonly key: string;
  readonly accountLabel: string;
  readonly windowLabel: string;
}

function creditAccountLabel(account: CediaCreditAccount): string {
  const labels = [
    account.email ? `email ${account.email}` : null,
    account.accountId ? `account ${account.accountId}` : null,
    account.credentialId === undefined ? null : `credential ${account.credentialId}`,
  ].filter((label): label is string => label !== null);
  return labels.length > 0 ? labels.join(" · ") : "unnamed account";
}

function creditTarget(account: CediaCreditAccount): CediaCreditTarget | null {
  if (account.credentialId !== undefined) return { credentialId: account.credentialId };
  if (account.accountId) return { accountId: account.accountId };
  if (account.email) return { email: account.email };
  return null;
}

function creditTargetKey(target: CediaCreditTarget): string {
  if (target.credentialId !== undefined) return `credential:${target.credentialId}`;
  if (target.accountId !== undefined) return `account:${target.accountId}`;
  return `email:${target.email ?? ""}`;
}

function creditWindowLabel(account: CediaCreditAccount): string {
  const candidates = account.credits.filter((candidate) => candidate.status === undefined || candidate.status === "available");
  const credit = candidates.reduce<CediaCredit | undefined>((soonest, candidate) => {
    if (!soonest) return candidate;
    const soonestExpiry = soonest.expiresAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(soonest.expiresAt);
    const candidateExpiry = candidate.expiresAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(candidate.expiresAt);
    if (!Number.isFinite(candidateExpiry)) return soonest;
    return candidateExpiry < soonestExpiry || !Number.isFinite(soonestExpiry) ? candidate : soonest;
  }, undefined) ?? account.credits[0];
  const value = credit?.resetType;
  if (!value) return "saved reset";
  return value.replace(/[_-]+/g, " ");
}

function creditRedeemOutcome(outcome: CediaCreditRedeem): string {
  switch (outcome.code) {
    case "reset": return "Reset applied (reset).";
    case "already_redeemed": return "Already redeemed; no reset was applied (already_redeemed).";
    case "no_credit": return "No saved reset credit was available; no reset was applied (no_credit).";
    case "nothing_to_reset": return "Nothing to reset; no credit was spent (nothing_to_reset).";
    case "no_account": return "No matching saved account was found; no reset was applied (no_account).";
    case "credit_list_failed": return "Saved reset listing failed; no reset was applied (credit_list_failed).";
    default: return `Redemption outcome: ${outcome.code}.`;
  }
}

function CreditRow({ credit, index }: { readonly credit: CediaCredit; readonly index: number }) {
  return (
    <li className="space-y-0.5 text-[10px] text-muted-foreground" data-credit-id={credit.id}>
      <span className="text-foreground/85">{credit.title ?? `Saved reset ${index + 1}`}</span>
      <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
        <span>Credit ID: {credit.id}</span>
        <span>Status: {credit.status ?? "not reported"}</span>
        <span>Expires: {credit.expiresAt ?? "not reported"}</span>
        {credit.grantedAt ? <span>Granted: {credit.grantedAt}</span> : null}
        {credit.resetType ? <span>Window: {credit.resetType}</span> : null}
      </div>
      {credit.description ? <p className="leading-relaxed">{credit.description}</p> : null}
    </li>
  );
}

interface CediaCreditsSectionProps {
  readonly state: CediaCreditsAnswer | null;
  readonly requested: boolean;
  readonly busy: boolean;
  readonly confirmation?: CediaRedeemConfirmation | null;
  readonly error?: string | null;
  readonly onCheck?: () => void;
  readonly onRedeem?: (account: CediaCreditAccount) => void;
}

function CediaCreditsSection({
  state,
  requested,
  busy,
  confirmation = null,
  error = null,
  onCheck,
  onRedeem,
}: CediaCreditsSectionProps) {
  if (state?.state === "unavailable") {
    return (
      <section aria-label="Saved resets" className="space-y-1.5 border-t border-border/60 pt-2">
        <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{state.reason}</p>
      </section>
    );
  }

  if (!state) {
    return (
      <section aria-label="Saved resets" className="space-y-1.5 border-t border-border/60 pt-2">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="text-[12px] font-medium text-foreground/85">Saved resets</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={onCheck ?? (() => undefined)}
            aria-label="Check saved resets"
          >
            {busy ? "Checking…" : "Check saved resets"}
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {requested && busy ? "Checking asks the providers for current saved reset accounts." : "Saved resets are not checked automatically. Checking asks the providers for current accounts."}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Saved resets" className="space-y-1.5 border-t border-border/60 pt-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-[12px] font-medium text-foreground/85">Saved resets</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={onCheck ?? (() => undefined)}
          aria-label="Check saved resets"
        >
          {busy ? "Checking…" : "Check saved resets"}
        </Button>
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">Checking asks the providers for current saved reset accounts.</p>
      {state.unavailable ? <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{state.unavailable}</p> : null}
      {state.lastRedeem ? <p role="status" className="text-[11px] leading-relaxed text-muted-foreground">{creditRedeemOutcome(state.lastRedeem)}</p> : null}
      {state.accounts.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">No saved reset accounts were reported.</p>
      ) : (
        <ul className="space-y-1.5">
          {state.accounts.map((account, accountIndex) => {
            const label = creditAccountLabel(account);
            const target = creditTarget(account);
            const targetKey = target ? creditTargetKey(target) : null;
            const pending = targetKey !== null && confirmation?.key === targetKey;
            return (
              <li key={`${targetKey ?? "account"}-${accountIndex}`} className="space-y-1 rounded-md border border-border/60 bg-background/50 px-2 py-1.5">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                  <span className="min-w-0 truncate text-[11px] font-medium text-foreground/85">{label}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{account.active ? "Active session account" : "Not the session's active account"}</span>
                </div>
                {account.accountId ? <p className="text-[10px] text-muted-foreground">Account ID: {account.accountId}</p> : null}
                {account.email ? <p className="text-[10px] text-muted-foreground">Account email: {account.email}</p> : null}
                {account.credentialId === undefined ? null : <p className="text-[10px] text-muted-foreground">Credential ID: {account.credentialId}</p>}
                {account.error ? (
                  <p role="alert" className="text-[11px] leading-relaxed text-destructive">Saved reset listing failed for {label}: {account.error}</p>
                ) : (
                  <>
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-[11px] text-muted-foreground">{account.availableCount} available reset credit{account.availableCount === 1 ? "" : "s"}</span>
                      {account.availableCount > 0 && target ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={busy}
                          onClick={() => onRedeem?.(account)}
                          aria-label={pending ? `Confirm redeem for ${label}` : `Redeem a saved reset for ${label}`}
                        >
                          {pending ? "Confirm redeem" : "Redeem"}
                        </Button>
                      ) : null}
                    </div>
                    {account.credits.length > 0 ? (
                      <ul className="space-y-0.5">
                        {account.credits.map((credit, index) => <CreditRow key={`${credit.id}-${index}`} credit={credit} index={index} />)}
                      </ul>
                    ) : null}
                    {pending && confirmation ? (
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        Redeeming for {confirmation.accountLabel} spends one saved reset and refreshes the {confirmation.windowLabel} window. Click Confirm redeem to continue.
                      </p>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p role="alert" className="text-[11px] leading-relaxed text-destructive">{error}</p> : null}
    </section>
  );
}

function UsageReport({ report }: { readonly report: CediaUsageReport }) {
  return (
    <section className="space-y-1.5 border-t border-border/60 pt-2" aria-label={`${report.provider} usage report`}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <span className="text-[12px] font-medium text-foreground/85">{report.provider}</span>
        <span className="text-[10px] text-muted-foreground">Fetched: {fetchedAt(report.fetchedAt)}</span>
      </div>
      {report.accountId ? <p className="text-[10px] text-muted-foreground">Account ID: {report.accountId}</p> : null}
      {report.accountEmail ? <p className="text-[10px] text-muted-foreground">Account email: {report.accountEmail}</p> : null}
      {report.limitReached ? <p className="text-[10px] text-destructive">Limit reached</p> : null}
      {report.limits.length > 0 ? (
        <ul className="space-y-1">
          {report.limits.map((limit) => <UsageLimit key={limit.id} limit={limit} />)}
        </ul>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">No limits were reported.</p>
      )}
      {report.resetCredits ? (
        <section aria-label={`${report.provider} reset credits`} className="space-y-0.5 border-t border-border/60 pt-1.5">
          <p className="text-[11px] text-muted-foreground">
            {report.resetCredits.availableCount} available reset credit{report.resetCredits.availableCount === 1 ? "" : "s"}
          </p>
          {report.resetCredits.credits?.length ? (
            <ul className="space-y-0.5">
              {report.resetCredits.credits.map((credit, index) => <UsageCredit key={`${credit.grantedAt ?? ""}-${credit.expiresAt ?? ""}-${index}`} credit={credit} index={index} />)}
            </ul>
          ) : null}
        </section>
      ) : null}
      {report.notes?.length ? <p className="text-[10px] leading-relaxed text-muted-foreground">{report.notes.join(" · ")}</p> : null}
    </section>
  );
}

export interface CediaUsagePanelProps {
  readonly state: CediaUsageAnswer | null;
  readonly credits?: CediaCreditsAnswer | null;
  readonly requested?: boolean;
  readonly creditsRequested?: boolean;
  readonly busy?: boolean;
  readonly creditsBusy?: boolean;
  readonly redeemConfirmation?: CediaRedeemConfirmation | null;
  readonly creditsRedeemError?: string | null;
  readonly onRefresh?: () => void;
  readonly onCheckCredits?: () => void;
  readonly onRedeemCredit?: (account: CediaCreditAccount) => void;
}

/** Pure usage rendering used by the hook-backed surface and renderer tests. */
export function CediaUsagePanel({
  state,
  credits = null,
  requested = false,
  creditsRequested = false,
  busy = false,
  creditsBusy = false,
  redeemConfirmation = null,
  creditsRedeemError = null,
  onRefresh,
  onCheckCredits,
  onRedeemCredit,
}: CediaUsagePanelProps) {
  const creditsSection = (
    <CediaCreditsSection
      state={credits}
      requested={creditsRequested}
      busy={creditsBusy}
      confirmation={redeemConfirmation}
      error={creditsRedeemError}
      onCheck={onCheckCredits}
      onRedeem={onRedeemCredit}
    />
  );
  if (state?.state === "unavailable") {
    return (
      <ComposerStackedPanel
        data-testid="cedia-usage-surface"
        aria-label="Cedia usage"
        className="px-2.5 py-2"
      >
        <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{state.reason}</p>
        {/* The read is manual, so a transient failure (the runtime restarted, the host was busy) must
            not leave the owner with no way to ask again short of reopening the panel. */}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={onRefresh ?? (() => undefined)}
          aria-label="Refresh usage"
        >
          {busy ? "Refreshing…" : "Refresh usage"}
        </Button>
        {creditsSection}
      </ComposerStackedPanel>
    );
  }

  if (!state) {
    return (
      <ComposerStackedPanel
        data-testid="cedia-usage-surface"
        aria-label="Cedia usage"
        className="space-y-2 px-2.5 py-2"
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <UsageGaugeIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-[12px] font-medium text-foreground/85">Usage</span>
          </div>
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onRefresh ?? (() => undefined)} aria-label="Refresh usage">
            {busy ? "Refreshing…" : "Refresh usage"}
          </Button>
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {requested && busy ? "Refreshing asks the providers for current usage." : "Usage is not read automatically. Refreshing asks the providers for current usage."}
        </p>
        {creditsSection}
      </ComposerStackedPanel>
    );
  }

  return (
    <ComposerStackedPanel
      data-testid="cedia-usage-surface"
      aria-label="Cedia usage"
      className="space-y-2 px-2.5 py-2"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <UsageGaugeIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[12px] font-medium text-foreground/85">Usage</span>
        </div>
        <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onRefresh ?? (() => undefined)} aria-label="Refresh usage">
          {busy ? "Refreshing…" : "Refresh usage"}
        </Button>
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">Refreshing asks the providers for current usage.</p>
      {state.supported === false ? <p className="text-[11px] leading-relaxed text-muted-foreground">The runtime cannot report provider usage.</p> : null}
      {state.unavailable ? <p role="alert" className="text-[11px] leading-relaxed text-muted-foreground">{state.unavailable}</p> : null}
      {state.reports.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">No provider usage was reported.</p>
      ) : (
        state.reports.map((report) => <UsageReport key={`${report.provider}-${report.fetchedAt}`} report={report} />)
      )}
      {creditsSection}
    </ComposerStackedPanel>
  );
}

export function CediaUsageSurface({ sessionId }: { readonly sessionId: string }) {
  const queryClient = useQueryClient();
  const usageQuery = useQuery(serverUsageQueryOptions(sessionId));
  const creditsQuery = useQuery(serverCreditsQueryOptions(sessionId));
  const redeemMutation = useMutation(serverCreditsRedeemMutationOptions({ sessionId, queryClient }));
  const [requestedSessionId, setRequestedSessionId] = useState<string | null>(null);
  const [requestedCreditsSessionId, setRequestedCreditsSessionId] = useState<string | null>(null);
  const [redeemConfirmation, setRedeemConfirmation] = useState<CediaRedeemConfirmation | null>(null);
  const [creditsRedeemError, setCreditsRedeemError] = useState<string | null>(null);
  const requested = requestedSessionId === sessionId;
  const creditsRequested = requestedCreditsSessionId === sessionId;

  const onCheckCredits = useCallback(() => {
    if (sessionId.length === 0 || creditsQuery.isFetching || redeemMutation.isPending) return;
    setRequestedCreditsSessionId(sessionId);
    void creditsQuery.refetch().catch(() => undefined);
  }, [creditsQuery, redeemMutation.isPending, sessionId]);

  const onRefresh = useCallback(() => {
    if (sessionId.length === 0 || usageQuery.isFetching || creditsQuery.isFetching || redeemMutation.isPending) return;
    setRequestedSessionId(sessionId);
    setRequestedCreditsSessionId(sessionId);
    void Promise.all([usageQuery.refetch(), creditsQuery.refetch()]).catch(() => undefined);
  }, [creditsQuery, redeemMutation.isPending, sessionId, usageQuery]);

  const onRedeemCredit = useCallback((account: CediaCreditAccount) => {
    if (account.availableCount <= 0 || account.error || redeemMutation.isPending || creditsQuery.isFetching) return;
    const target = creditTarget(account);
    if (!target) return;
    const key = creditTargetKey(target);
    if (redeemConfirmation?.key !== key) {
      setRedeemConfirmation({ key, accountLabel: creditAccountLabel(account), windowLabel: creditWindowLabel(account) });
      return;
    }
    setRedeemConfirmation(null);
    setCreditsRedeemError(null);
    void redeemMutation.mutateAsync(target).catch((error) => {
      setCreditsRedeemError(errorMessage(error));
    });
  }, [creditsQuery.isFetching, redeemConfirmation?.key, redeemMutation, sessionId]);

  const state = usageQuery.isError
    ? { state: "unavailable" as const, reason: errorMessage(usageQuery.error) }
    : usageQuery.data ?? null;
  const creditsState = creditsQuery.isError
    ? { state: "unavailable" as const, reason: errorMessage(creditsQuery.error, "The Cedia saved reset route is unavailable.") }
    : creditsQuery.data ?? null;
  return (
    <CediaUsagePanel
      state={state}
      credits={creditsState}
      requested={requested}
      creditsRequested={creditsRequested}
      busy={usageQuery.isFetching}
      creditsBusy={creditsQuery.isFetching || redeemMutation.isPending}
      redeemConfirmation={redeemConfirmation}
      creditsRedeemError={creditsRedeemError}
      onRefresh={onRefresh}
      onCheckCredits={onCheckCredits}
      onRedeemCredit={onRedeemCredit}
    />
  );
}
