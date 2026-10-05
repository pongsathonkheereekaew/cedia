import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  formatForgeReviewError,
  forgeReviewQueryKeys,
  getForgeReviewApi,
  type ForgeReviewDetail,
  type ForgeReviewDetailInput,
  type ForgeReviewOmpInput,
  type ForgeReviewOmpResult,
  type ForgeReviewTaskAssociation,
  type ForgeReviewTaskAssociationInput,
  type ForgeReviewTaskResult,
} from "~/lib/forgeReview";

import { commandKey, reserveOmpCommand, completeOmpCommand, type StoredOmpCommand } from "./codeReviewOmpCommands";

export type ForgeReviewOmpMode = "review" | "ask";

export interface ForgeReviewOmpRunOptions {
  readonly instructions?: string;
  readonly examples?: readonly string[];
  readonly model?: string;
}

export interface ForgeReviewOmpController {
  readonly status: string | null;
  readonly pending: ForgeReviewOmpMode | null;
  readonly task: ForgeReviewOmpResult | null;
  readonly taskAssociation: ForgeReviewTaskAssociation | null;
  readonly run: (
    mode: ForgeReviewOmpMode,
    prompt?: string,
    options?: ForgeReviewOmpRunOptions,
  ) => Promise<ForgeReviewOmpResult | undefined>;
  readonly readResult: () => Promise<ForgeReviewTaskResult | undefined>;
}

const ForgeReviewOmpContext = createContext<ForgeReviewOmpController | null>(null);

function reviewTaskIdentity(input: ForgeReviewDetailInput, detail: ForgeReviewDetail): string {
  return [
    input.projectId,
    detail.provider,
    detail.repository.hostname,
    detail.repository.path,
    detail.ref.number,
    detail.snapshot.hash,
  ].join(":");
}

function associationInput(input: ForgeReviewDetailInput, detail: ForgeReviewDetail): ForgeReviewTaskAssociationInput {
  return {
    projectId: input.projectId,
    provider: detail.provider,
    hostname: detail.repository.hostname,
    repositoryPath: detail.repository.path,
    number: detail.ref.number,
    snapshotHash: detail.snapshot.hash,
    ...(detail.snapshot.headSha ? { headSha: detail.snapshot.headSha } : {}),
    ...(detail.snapshot.baseSha ? { baseSha: detail.snapshot.baseSha } : {}),
  };
}

function useForgeReviewOmpController(
  detail: ForgeReviewDetail,
  input: ForgeReviewDetailInput,
  enabled: boolean,
): ForgeReviewOmpController {
  const queryClient = useQueryClient();
  const identity = useMemo(() => reviewTaskIdentity(input, detail), [detail.provider, detail.ref.number, detail.repository.hostname, detail.repository.path, detail.snapshot.hash, input.projectId]);
  const taskInput = useMemo(() => associationInput(input, detail), [detail.provider, detail.ref.number, detail.repository.hostname, detail.repository.path, detail.snapshot.baseSha, detail.snapshot.hash, detail.snapshot.headSha, input.projectId]);
  const taskQueryKey = useMemo(() => forgeReviewQueryKeys.task(identity), [identity]);
  const cachedTask = queryClient.getQueryData<ForgeReviewOmpResult>(taskQueryKey);
  const [task, setTask] = useState<ForgeReviewOmpResult | null>(() => cachedTask ?? null);
  const [taskAssociation, setTaskAssociation] = useState<ForgeReviewTaskAssociation | null>(null);
  const [status, setStatus] = useState<string | null>(() => (cachedTask ? "OMP task is available." : null));
  const [pending, setPending] = useState<ForgeReviewOmpMode | null>(null);
  const pendingRef = useRef<ForgeReviewOmpMode | null>(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const taskRef = useRef<ForgeReviewOmpResult | null>(cachedTask ?? null);
  const associationRef = useRef<ForgeReviewTaskAssociation | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++generationRef.current;
    const cached = queryClient.getQueryData<ForgeReviewOmpResult>(taskQueryKey) ?? null;
    taskRef.current = cached;
    associationRef.current = null;
    if (enabled) {
      setTask(cached);
      setTaskAssociation(null);
      pendingRef.current = null;
      setStatus(cached ? "OMP task is available." : null);
      setPending(null);
    }
    if (enabled) {
      const api = getForgeReviewApi();
      void api.readTaskAssociation(taskInput)
        .then((association) => {
          if (!mountedRef.current || generation !== generationRef.current) return;
          associationRef.current = association;
          setTaskAssociation(association);
          if (association && !taskRef.current) {
            const linkedTask: ForgeReviewOmpResult = { threadId: association.threadId, status: "associated" };
            taskRef.current = linkedTask;
            setTask(linkedTask);
            setStatus("OMP task is linked to this pull request.");
          }
        })
        .catch(() => {
          if (mountedRef.current && generation === generationRef.current) {
            setStatus("OMP task association is unavailable; a new task will be linked when the review starts.");
          }
        });
    }
    return () => {
      generationRef.current += 1;
      mountedRef.current = false;
    };
  }, [detail.provider, detail.ref.number, detail.repository.hostname, detail.repository.path, detail.snapshot.baseSha, detail.snapshot.hash, detail.snapshot.headSha, enabled, input.projectId, input.url, queryClient, taskInput, taskQueryKey]);

  useEffect(() => {
    if (!enabled) return;
    queryClient.setQueryDefaults(["cedia", "forge-review", "task"], { gcTime: Infinity });
  }, [enabled, queryClient]);

  const run = async (
    mode: ForgeReviewOmpMode,
    prompt = "",
    options: ForgeReviewOmpRunOptions = {},
  ): Promise<ForgeReviewOmpResult | undefined> => {
    if (!enabled || pendingRef.current !== null) return undefined;
    const api = getForgeReviewApi();
    const promptValue = prompt.trim();
    const generation = generationRef.current;
    pendingRef.current = mode;
    setPending(mode);
    setStatus(null);
    let instructions = options.instructions?.trim() ?? "";
    let examples = options.examples ?? [];
    if (mode === "review" && options.instructions === undefined && options.examples === undefined) {
      try {
        const latest = await api.readInstructions(input.projectId);
        instructions = latest.text.trim();
        examples = latest.examples ?? [];
      } catch (error: unknown) {
        if (mountedRef.current && generation === generationRef.current) {
          setStatus(`Review instructions could not be loaded: ${formatForgeReviewError(error)}`);
          pendingRef.current = null;
          setPending(null);
        }
        return undefined;
      }
    }
    if (!mountedRef.current || generation !== generationRef.current) return undefined;
    const threadId = taskRef.current?.threadId ?? associationRef.current?.threadId ?? "";
    const requestBody: Omit<ForgeReviewOmpInput, "commandId"> = {
      ...input,
      ...(threadId ? { threadId } : {}),
      snapshotHash: detail.snapshot.hash,
      ...(detail.snapshot.headSha ? { headSha: detail.snapshot.headSha } : {}),
      ...(detail.snapshot.baseSha ? { baseSha: detail.snapshot.baseSha } : {}),
      ...(promptValue ? { prompt: promptValue } : {}),
      ...(mode === "review" && instructions ? { reviewInstructions: instructions } : {}),
      ...(mode === "review" && examples.length ? { attachedContext: examples.map((text, index) => ({ name: `review-example-${index + 1}`, text })) } : {}),
      ...(mode === "review" && options.model ? { modelSelection: { provider: "omp", model: options.model } } : {}),
    };
    const key = commandKey(mode, requestBody);
    let reserved: StoredOmpCommand;
    try {
      reserved = reserveOmpCommand(key, requestBody);
    } catch (error: unknown) {
      if (mountedRef.current && generation === generationRef.current) {
        pendingRef.current = null;
        setPending(null);
        setStatus(formatForgeReviewError(error));
      }
      return undefined;
    }
    const commandId = reserved.commandId;
    const request: ForgeReviewOmpInput = { ...reserved.request, commandId };
    try {
      const result = mode === "review" ? await api.reviewWithOmp(request) : await api.ask({ ...request, prompt: promptValue });
      try {
        completeOmpCommand(key);
      } catch (error: unknown) {
        if (mountedRef.current && generation === generationRef.current) setStatus(formatForgeReviewError(error));
        return result;
      }
      if (!mountedRef.current || generation !== generationRef.current) return result;
      queryClient.setQueryData(taskQueryKey, result);
      if (result.taskAssociation) associationRef.current = result.taskAssociation;
      taskRef.current = result;
        if (mountedRef.current) {
        setTask(result);
        if (result.taskAssociation) setTaskAssociation(result.taskAssociation);
        setStatus(result.associationWarning ?? (result.taskAssociation ? "OMP review is linked to this pull request." : result.status ?? (mode === "review" ? "OMP review started." : "OMP follow-up started.")));
      }
      return result;
    } catch (error: unknown) {
      if (mountedRef.current && generation === generationRef.current) setStatus(formatForgeReviewError(error));
      return undefined;
    } finally {
      if (generation === generationRef.current) {
        pendingRef.current = null;
        if (mountedRef.current) setPending(null);
      }
    }
  };

  const readResult = async (): Promise<ForgeReviewTaskResult | undefined> => {
    const threadId = taskRef.current?.threadId;
    const read = getForgeReviewApi().readTaskResult;
    if (!threadId || !read) return undefined;
    const generation = generationRef.current;
    if (mountedRef.current) setStatus("Reading OMP response…");
    try {
      const result = await read(threadId);
      if (!mountedRef.current || generation !== generationRef.current) return undefined;
      if (mountedRef.current && generation === generationRef.current) {
        setStatus(result.status === "truncated" || result.truncated
          ? result.reason ?? "OMP response was truncated; it was not copied into the draft."
          : result.text.trim() ? "OMP response ready for review." : "OMP has not returned a response yet.");
      }
      return result;
    } catch (error: unknown) {
      if (mountedRef.current && generation === generationRef.current) setStatus(formatForgeReviewError(error));
      return undefined;
    }
  };

  return { status, pending, task, taskAssociation, run, readResult };
}

export function ForgeReviewOmpProvider({ detail, input, children }: { readonly detail: ForgeReviewDetail; readonly input: ForgeReviewDetailInput; readonly children: ReactNode }) {
  const controller = useForgeReviewOmpController(detail, input, true);
  return <ForgeReviewOmpContext.Provider value={controller}>{children}</ForgeReviewOmpContext.Provider>;
}

/**
 * Returns the per-review OMP owner. A Surface supplies one provider so the
 * action bar and composer share task state; standalone fixtures get a local
 * owner without introducing another global execution path.
 */
export function useForgeReviewOmp(detail: ForgeReviewDetail, input: ForgeReviewDetailInput): ForgeReviewOmpController {
  const provided = useContext(ForgeReviewOmpContext);
  const local = useForgeReviewOmpController(detail, input, provided === null);
  return provided ?? local;
}
