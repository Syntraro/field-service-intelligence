import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { QuoteTemplate } from "@shared/schema";
import { QuoteTemplateModal } from "@/components/QuoteTemplateModal";

export default function QuoteTemplatesPage() {
  const { toast } = useToast();
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<QuoteTemplate | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<QuoteTemplate | null>(null);

  const { data: templates = [], isLoading } = useQuery<QuoteTemplate[]>({
    queryKey: ["/api/quote-templates/list", { activeOnly: !showInactive }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("activeOnly", String(!showInactive));
      const res = await fetch(`/api/quote-templates/list?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch templates");
      return res.json();
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/quote-templates/${id}/set-default`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quote-templates"] });
      toast({ title: "Default updated", description: "Template is now the default." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest(`/api/quote-templates/${id}/toggle-active`, {
        method: "POST",
        body: JSON.stringify({ isActive }),
      });
    },
    onSuccess: (_, { isActive }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quote-templates"] });
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
      return apiRequest(`/api/quote-templates/${id}/clone`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quote-templates"] });
      toast({ title: "Template duplicated", description: "A copy of the template has been created." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/quote-templates/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quote-templates"] });
      toast({ title: "Template deleted", description: "The template has been removed." });
      setDeleteConfirmOpen(false);
      setTemplateToDelete(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleDeleteClick = (template: QuoteTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    setTemplateToDelete(template);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (templateToDelete) {
      deleteMutation.mutate(templateToDelete.id);
    }
  };

  const handleEdit = (template: QuoteTemplate) => {
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
        <span className="text-foreground">Quote Templates</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-quote-templates-title">
            Quote Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage reusable line item bundles for quotes.
          </p>
        </div>
        <Button onClick={handleNewTemplate} data-testid="button-new-quote-template">
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
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No templates found.</p>
              <p className="text-sm">Create your first template to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
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
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">
                      {template.description || "-"}
                    </TableCell>
                    <TableCell>
                      {template.isDefault && (
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
                          {template.isActive && !template.isDefault && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                setDefaultMutation.mutate(template.id);
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

      <QuoteTemplateModal
        open={modalOpen}
        onClose={handleModalClose}
        template={editingTemplate}
      />

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{templateToDelete?.name}"? This action cannot be undone.
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
