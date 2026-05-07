import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, Pencil, Star, Power, Loader2, ArrowLeft, FileText, Copy, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link } from "wouter";
import { format } from "date-fns";
import type { JobTemplate } from "@shared/schema";
import { JobTemplateModal } from "@/components/JobTemplateModal";

const JOB_TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "service_call", label: "Service Call" },
  { value: "pm", label: "PM" },
  { value: "install", label: "Install" },
  { value: "repair", label: "Repair" },
  { value: "inspection", label: "Inspection" },
  { value: "other", label: "Other" },
];

function getJobTypeLabel(jobType: string | null): string {
  if (!jobType) return "-";
  const option = JOB_TYPE_OPTIONS.find((o) => o.value === jobType);
  return option?.label || jobType;
}

export default function JobTemplatesPage() {
  const { toast } = useToast();
  const [jobTypeFilter, setJobTypeFilter] = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<JobTemplate | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<JobTemplate | null>(null);

  const { data: templates = [], isLoading } = useQuery<JobTemplate[]>({
    queryKey: ["/api/job-templates", { jobType: jobTypeFilter, activeOnly: !showInactive }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (jobTypeFilter !== "all") {
        params.set("jobType", jobTypeFilter);
      }
      params.set("activeOnly", String(!showInactive));
      const res = await fetch(`/api/job-templates?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch templates");
      return res.json();
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async ({ id, jobType }: { id: string; jobType: string }) => {
      return apiRequest(`/api/job-templates/${id}/set-default`, {
        method: "POST",
        body: JSON.stringify({ jobType }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/job-templates"] });
      toast({ title: "Default updated", description: "Template is now the default for its job type." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest(`/api/job-templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      });
    },
    onSuccess: (_, { isActive }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/job-templates"] });
      toast({
        title: isActive ? "Template activated" : "Template deactivated",
        description: isActive
          ? "The template is now available for use."
          : "The template has been deactivated.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const cloneMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/job-templates/${id}/clone`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/job-templates"] });
      toast({ title: "Template duplicated", description: "A copy of the template has been created." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/job-templates/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/job-templates"] });
      toast({ title: "Template deleted", description: "The template has been permanently removed." });
      setDeleteConfirmOpen(false);
      setTemplateToDelete(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleDeleteClick = (template: JobTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    setTemplateToDelete(template);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (templateToDelete) {
      deleteMutation.mutate(templateToDelete.id);
    }
  };

  const handleEdit = (template: JobTemplate) => {
    setEditingTemplate(template);
    setModalOpen(true);
  };

  const handleNewTemplate = () => {
    setEditingTemplate(null);
    setModalOpen(true);
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setEditingTemplate(null);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/settings" className="hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4 inline mr-1" />
          Settings
        </Link>
        <span>/</span>
        <span className="text-foreground">Job Templates</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-job-templates-title">
            Job Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage reusable bundles of line items for service calls, maintenance, installs, etc.
          </p>
        </div>
        <Button onClick={handleNewTemplate} data-testid="button-new-template">
          <Plus className="h-4 w-4 mr-1" />
          New Template
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Templates
            </CardTitle>
            <div className="flex items-center gap-4">
              <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-job-type-filter">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  {JOB_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={showInactive}
                  onCheckedChange={(checked) => setShowInactive(checked === true)}
                  data-testid="checkbox-show-inactive"
                />
                Show inactive
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <EmptyState
              icon={FileText}
              message="No templates found"
              description="Create your first template to get started."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Job Type</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => (
                  <TableRow
                    key={template.id}
                    className="cursor-pointer"
                    onClick={() => handleEdit(template)}
                    data-testid={`row-template-${template.id}`}
                  >
                    <TableCell className="font-medium">{template.name}</TableCell>
                    <TableCell>{getJobTypeLabel(template.jobType)}</TableCell>
                    <TableCell>
                      {template.isDefaultForJobType && (
                        <Badge variant="secondary" className="text-xs">
                          <Star className="h-3 w-3 mr-1 fill-current" />
                          Default
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={template.isActive ? "default" : "outline"}>
                        {template.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {template.updatedAt
                        ? format(new Date(template.updatedAt), "MMM d, yyyy")
                        : format(new Date(template.createdAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" data-testid={`button-actions-${template.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(template);
                            }}
                            data-testid={`action-edit-${template.id}`}
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          {template.jobType && template.isActive && !template.isDefaultForJobType && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                setDefaultMutation.mutate({
                                  id: template.id,
                                  jobType: template.jobType!,
                                });
                              }}
                              data-testid={`action-set-default-${template.id}`}
                            >
                              <Star className="h-4 w-4 mr-2" />
                              Set as Default
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleActiveMutation.mutate({
                                id: template.id,
                                isActive: !template.isActive,
                              });
                            }}
                            data-testid={`action-toggle-active-${template.id}`}
                          >
                            <Power className="h-4 w-4 mr-2" />
                            {template.isActive ? "Deactivate" : "Activate"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              cloneMutation.mutate(template.id);
                            }}
                            data-testid={`action-duplicate-${template.id}`}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => handleDeleteClick(template, e)}
                            className="text-destructive focus:text-destructive"
                            data-testid={`action-delete-${template.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <JobTemplateModal
        open={modalOpen}
        onClose={handleModalClose}
        template={editingTemplate}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete "{templateToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
