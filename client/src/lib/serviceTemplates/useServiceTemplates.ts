/**
 * Service Templates — TanStack Query hooks (2026-05-18 RALPH Phase 1).
 *
 * Read + mutation hooks for `/api/service-templates`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ServiceTemplateDto, CreateServiceTemplateBody, UpdateServiceTemplateBody, SetComponentsBody } from "./serviceTemplateTypes";

export const SERVICE_TEMPLATES_KEY = ["/api/service-templates"] as const;

export function useServiceTemplates(opts: { enabled?: boolean } = {}) {
  return useQuery<ServiceTemplateDto[]>({
    queryKey: SERVICE_TEMPLATES_KEY,
    queryFn: () => apiRequest<ServiceTemplateDto[]>("/api/service-templates"),
    staleTime: 30_000,
    enabled: opts.enabled ?? true,
  });
}

export function useServiceTemplate(id: string | null) {
  return useQuery<ServiceTemplateDto>({
    queryKey: [...SERVICE_TEMPLATES_KEY, id],
    queryFn: () => apiRequest<ServiceTemplateDto>(`/api/service-templates/${id}`),
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useCreateServiceTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateServiceTemplateBody) =>
      apiRequest<ServiceTemplateDto>("/api/service-templates", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVICE_TEMPLATES_KEY });
    },
  });
}

export function useUpdateServiceTemplate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateServiceTemplateBody) =>
      apiRequest<ServiceTemplateDto>(`/api/service-templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVICE_TEMPLATES_KEY });
    },
  });
}

export function useSetServiceTemplateComponents(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SetComponentsBody) =>
      apiRequest<ServiceTemplateDto>(`/api/service-templates/${id}/components`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVICE_TEMPLATES_KEY });
    },
  });
}

export function useDeleteServiceTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<{ ok: boolean }>(`/api/service-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SERVICE_TEMPLATES_KEY });
    },
  });
}

export function useIncrementServiceTemplateUsage() {
  return useMutation({
    mutationFn: (id: string) =>
      apiRequest<void>(`/api/service-templates/${id}/usage`, { method: "POST" }),
  });
}
