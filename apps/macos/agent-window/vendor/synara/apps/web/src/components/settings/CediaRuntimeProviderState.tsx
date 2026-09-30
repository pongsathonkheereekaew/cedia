// FILE: CediaRuntimeProviderState.tsx
// Purpose: Show owner-visible runtime accounts and service-tier vocabulary.
// Layer: Settings panel

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  serverAccountsQueryOptions,
  serverApplyRoleMutationOptions,
  serverModelRolesQueryOptions,
  serverSetRoleMutationOptions,
  serverModelStateQueryOptions,
  serverPinAccountMutationOptions,
  serverServiceTierMutationOptions,
  type CediaAccountsAnswer,
  type CediaModelRolesAnswer,
  type CediaModelStateAnswer,
} from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  SettingsCard,
  SettingsListRow,
  SettingsSectionShell,
} from "./SettingsPanelPrimitives";

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The provider request failed.";
}

export type CediaRuntimeTaskLike = {
  readonly id: string;
  readonly session: unknown | null | undefined;
};

/** Resolves the only task identity the runtime controls can safely address. */
export function resolveCediaRuntimeSessionId(
  explicitSessionId: string | null | undefined,
  task: CediaRuntimeTaskLike | null | undefined,
): string | null {
  const explicit = explicitSessionId?.trim();
  if (explicit) return explicit;
  return task?.session ? String(task.id) : null;
}

export function CediaAccountsList({
  state,
  pinningCredentialId,
  onPin,
}: {
  readonly state: CediaAccountsAnswer;
  readonly pinningCredentialId?: number | null;
  readonly onPin?: (credentialId: number) => void;
}) {
  if (state.available === false) {
    return <div className="px-4 py-4 text-xs text-muted-foreground">{state.reason}</div>;
  }
  if (!state.supported) {
    return (
      <div className="px-4 py-4 text-xs text-muted-foreground">
        This provider has no account list.
      </div>
    );
  }
  if (state.accounts.length === 0) {
    return <div className="px-4 py-4 text-xs text-muted-foreground">No provider accounts are available.</div>;
  }
  return (
    <div>
      {state.accounts.map((account) => {
        const identity = account.label ?? `Credential ${account.credentialId}`;
        return (
          <SettingsListRow
            key={account.credentialId}
            title={identity}
            description={state.provider ? `Provider: ${state.provider}` : "Provider: unknown"}
            actions={
              account.active ? (
                <span className="text-xs font-medium text-muted-foreground">In use</span>
              ) : onPin ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={pinningCredentialId !== null && pinningCredentialId !== undefined}
                  onClick={() => onPin(account.credentialId)}
                >
                  {pinningCredentialId === account.credentialId ? "Pinning…" : "Pin"}
                </Button>
              ) : null
            }
          />
        );
      })}
      {state.truncated ? (
        <p className="px-4 py-2 text-[11px] text-muted-foreground">
          The runtime shortened this account list.
        </p>
      ) : null}
    </div>
  );
}

export function CediaServiceTierControls({
  state,
  busyFamily,
  onSet,
}: {
  readonly state: CediaModelStateAnswer;
  readonly busyFamily?: string | null;
  readonly onSet?: (family: string, tier: string | null) => void;
}) {
  if (state.available === false) {
    return <div className="px-4 py-4 text-xs text-muted-foreground">{state.reason}</div>;
  }
  const current = new Map(state.serviceTiers.current.map((row) => [row.family, row.tier]));
  const families = [...new Set([...state.serviceTiers.families, ...current.keys()])];
  if (families.length === 0 || state.serviceTiers.tiers.length === 0) {
    return (
      <div className="space-y-1 px-4 py-4 text-xs text-muted-foreground">
        <p>The runtime published no service-tier vocabulary; current values are read-only.</p>
        {state.serviceTiers.current.length > 0 ? (
          <p>
            {state.serviceTiers.current.map((row) => `${row.family}: ${row.tier ?? "no override"}`).join(" · ")}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div>
      {families.map((family) => {
        const tier = current.get(family) ?? null;
        const familyIsPublished = state.serviceTiers.families.includes(family);
        const tierIsPublished = tier === null || state.serviceTiers.tiers.includes(tier);
        return (
          <div
            key={family}
            className="flex items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-4 py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-foreground">{family}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                Current: {tier ?? "no override"}
              </div>
            </div>
            {onSet && familyIsPublished && tierIsPublished ? (
              <select
                aria-label={`${family} service tier`}
                className={cn(
                  "max-w-44 rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-control-opaque)] px-2 py-1.5 text-xs text-foreground",
                  busyFamily === family && "opacity-60",
                )}
                disabled={busyFamily !== null && busyFamily !== undefined}
                value={tier ?? ""}
                onChange={(event) => onSet(family, event.target.value || null)}
              >
                <option value="">No override</option>
                {state.serviceTiers.tiers.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-muted-foreground">Current value is read-only.</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CediaModelRolesControls({
  state,
  busyRole,
  onApply,
  busySetRole,
  onSet,
}: {
  readonly state: CediaModelRolesAnswer;
  readonly busyRole?: string | null;
  readonly onApply?: (role: string) => void;
  readonly busySetRole?: string | null;
  readonly onSet?: (role: string, modelId: string | null) => void;
}) {
  if (state.available === false) {
    return <div className="px-4 py-4 text-xs text-muted-foreground">{state.reason}</div>;
  }
  const busy = busySetRole !== null && busySetRole !== undefined;
  // The runtime owns the role cycle order; the window renders rows in that
  // order instead of incidentally showing wire order. Roles absent from the
  // cycle keep their listed relative order at the end.
  const order = new Map(state.cycleOrder.map((role, index) => [role, index] as const));
  const orderedRoles = [...state.roles].sort((left, right) => {
    const leftIndex = order.get(left.role) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right.role) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
  return (
    <div>
      {state.roles.length === 0 && !onSet ? (
        <div className="px-4 py-4 text-xs text-muted-foreground">
          No model roles are configured. Assign them with the runtime role settings first.
        </div>
      ) : null}
      {orderedRoles.map((entry) => (
        <RoleAssignmentRow
          key={entry.role}
          role={entry.role}
          modelId={entry.modelId}
          source={entry.source}
          busy={busy}
          onApply={onApply}
          onSet={onSet}
        />
      ))}
      {onSet ? (
        <>
          <NewRoleAssignmentRow busy={busy} onSet={onSet} />
          <p className="px-4 pb-2 text-[11px] leading-relaxed text-muted-foreground">
            Assign as provider/model. Clearing a role falls back to its default resolution.
          </p>
        </>
      ) : null}
    </div>
  );
}

function RoleAssignmentRow({
  role,
  modelId,
  source,
  busy,
  onApply,
  onSet,
}: {
  readonly role: string;
  readonly modelId: string;
  readonly source: string;
  readonly busy: boolean;
  readonly onApply?: (role: string) => void;
  readonly onSet?: (role: string, modelId: string | null) => void;
}) {
  const [draft, setDraft] = useState(modelId);
  const trimmed = draft.trim();
  const unchanged = trimmed === modelId;
  return (
    <div>
      <SettingsListRow
        key={role}
        title={role}
        description={`${modelId} · ${source}`}
        actions={
          onApply ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => onApply(role)}
            >
              {busy ? "Applying…" : "Apply"}
            </Button>
          ) : null
        }
      />
      {onSet ? (
        <div className="flex items-center gap-1.5 px-4 pb-2">
          <Input
            aria-label={`Model for role ${role}`}
            className="min-w-0 flex-1"
            size="sm"
            value={draft}
            disabled={busy}
            placeholder="provider/model"
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            type="button"
            size="xs"
            variant="outline"
            aria-label={`Set model for role ${role}`}
            disabled={busy || trimmed.length === 0 || unchanged}
            onClick={() => onSet(role, trimmed)}
          >
            {busy ? "Setting…" : "Set"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={`Clear model for role ${role}`}
            disabled={busy}
            onClick={() => {
              setDraft("");
              onSet(role, null);
            }}
          >
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function NewRoleAssignmentRow({
  busy,
  onSet,
}: {
  readonly busy: boolean;
  readonly onSet?: (role: string, modelId: string | null) => void;
}) {
  const [role, setRole] = useState("");
  const [modelId, setModelId] = useState("");
  if (!onSet) return null;
  const ready = role.trim().length > 0 && modelId.trim().length > 0;
  return (
    <div className="flex items-center gap-1.5 px-4 py-2">
      <Input
        aria-label="New role name"
        className="min-w-0 flex-1"
        size="sm"
        value={role}
        disabled={busy}
        placeholder="role"
        onChange={(event) => setRole(event.target.value)}
      />
      <Input
        aria-label="Model for the new role"
        className="min-w-0 flex-1"
        size="sm"
        value={modelId}
        disabled={busy}
        placeholder="provider/model"
        onChange={(event) => setModelId(event.target.value)}
      />
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={busy || !ready}
        onClick={() => {
          onSet(role.trim(), modelId.trim());
          setRole("");
          setModelId("");
        }}
      >
        {busy ? "Assigning…" : "Assign"}
      </Button>
    </div>
  );
}

export function CediaRuntimeProviderState({
  active,
  sessionId,
}: {
  readonly active: boolean;
  readonly sessionId?: string | null;
}) {
  const queryClient = useQueryClient();
  const hasSession = typeof sessionId === "string" && sessionId.length > 0;
  const modelQuery = useQuery(
    serverModelStateQueryOptions(sessionId ?? "", active && hasSession),
  );
  const accountsQuery = useQuery(
    serverAccountsQueryOptions(sessionId ?? "", active && hasSession),
  );
  const pinMutation = useMutation(
    serverPinAccountMutationOptions({ sessionId: sessionId ?? "", queryClient }),
  );
  const tierMutation = useMutation(
    serverServiceTierMutationOptions({ sessionId: sessionId ?? "", queryClient }),
  );
  const rolesQuery = useQuery(
    serverModelRolesQueryOptions(sessionId ?? "", active && hasSession),
  );
  const applyMutation = useMutation(
    serverApplyRoleMutationOptions({ sessionId: sessionId ?? "", queryClient }),
  );
  const setMutation = useMutation(
    serverSetRoleMutationOptions({ sessionId: sessionId ?? "", queryClient }),
  );

  if (!active) return null;
  return (
    <div className="space-y-6">
      <SettingsSectionShell title="Accounts">
        <SettingsCard>
          {!hasSession ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">
              Accounts appear when a task runtime is active.
            </div>
          ) : accountsQuery.isPending ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">Loading provider accounts…</div>
          ) : accountsQuery.isError ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">{messageOf(accountsQuery.error)}</div>
          ) : accountsQuery.data ? (
            <CediaAccountsList
              state={accountsQuery.data}
              pinningCredentialId={pinMutation.isPending ? pinMutation.variables : null}
              onPin={(credentialId) => pinMutation.mutate(credentialId)}
            />
          ) : null}
        </SettingsCard>
        {pinMutation.isError ? (
          <p className="px-2 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
            {messageOf(pinMutation.error)}
          </p>
        ) : null}
        <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
          Account identities come from the runtime. Cedia never reads or displays credential values.
        </p>
      </SettingsSectionShell>

      <SettingsSectionShell title="Model roles">
        <SettingsCard>
          {!hasSession ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">
              Model roles appear when a task runtime is active.
            </div>
          ) : rolesQuery.isPending ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">Loading runtime model roles…</div>
          ) : rolesQuery.isError ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">{messageOf(rolesQuery.error)}</div>
          ) : rolesQuery.data ? (
            <CediaModelRolesControls
              state={rolesQuery.data}
              busyRole={applyMutation.isPending ? applyMutation.variables ?? null : null}
              onApply={(role) => applyMutation.mutate(role)}
              busySetRole={setMutation.isPending ? (setMutation.variables?.role ?? null) : null}
              onSet={(role, modelId) => setMutation.mutate({ role, modelId })}
            />
          ) : null}
        </SettingsCard>
        {applyMutation.isError ? (
          <p className="px-2 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
            {messageOf(applyMutation.error)}
          </p>
        ) : null}
        {setMutation.isError ? (
          <p className="px-2 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
            {messageOf(setMutation.error)}
          </p>
        ) : null}
        {setMutation.isSuccess && setMutation.data.available === true ? (
          <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
            {setMutation.variables.role} now resolves to{" "}
            {setMutation.variables.modelId ?? "its default resolution"}.
          </p>
        ) : null}
        {applyMutation.isSuccess ? (
          <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
            Role {applyMutation.data.role} is active on {applyMutation.data.provider}/{applyMutation.data.model}.
          </p>
        ) : null}
        <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
          Applying a role switches this task to the role&apos;s configured model without changing any setting.
        </p>
      </SettingsSectionShell>

      <SettingsSectionShell title="Service tiers">
        <SettingsCard>
          {!hasSession ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">
              Service tiers appear when a task runtime is active.
            </div>
          ) : modelQuery.isPending ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">Loading runtime service tiers…</div>
          ) : modelQuery.isError ? (
            <div className="px-4 py-4 text-xs text-muted-foreground">{messageOf(modelQuery.error)}</div>
          ) : modelQuery.data ? (
            <CediaServiceTierControls
              state={modelQuery.data}
              busyFamily={tierMutation.isPending ? tierMutation.variables?.family ?? null : null}
              onSet={(family, tier) => tierMutation.mutate({ family, tier })}
            />
          ) : null}
        </SettingsCard>
        {tierMutation.isError ? (
          <p className="px-2 text-[11px] leading-relaxed text-red-600 dark:text-red-400">
            {messageOf(tierMutation.error)}
          </p>
        ) : null}
      </SettingsSectionShell>
    </div>
  );
}
