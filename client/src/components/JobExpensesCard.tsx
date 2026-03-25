/**
 * JobExpensesCard — displays and manages job expenses.
 * Supports create, edit, delete, billable toggle, and receipt upload.
 * Reports expense totals to parent for unified job costing.
 *
 * No approval workflow — dispatcher/admin reviews directly via edit/delete/billable.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Loader2, Pencil, Paperclip, ImageIcon } from "lucide-react";
import { format } from "date-fns";

// ── Category metadata ──

const CATEGORY_OPTIONS = [
  { value: "parking", label: "Parking" },
  { value: "materials", label: "Materials" },
  { value: "mileage", label: "Mileage" },
  { value: "travel", label: "Travel" },
  { value: "equipment_rental", label: "Equipment Rental" },
  { value: "permit", label: "Permit" },
  { value: "disposal", label: "Disposal" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "other", label: "Other" },
] as const;

function categoryLabel(value: string): string {
  return CATEGORY_OPTIONS.find((c) => c.value === value)?.label ?? value;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

// ── Types ──

interface Expense {
  id: string;
  jobId: string;
  amount: string;
  category: string;
  date: string;
  notes: string | null;
  createdByUserId: string;
  receiptFileId: string | null;
  isBillable: boolean;
  billingStatus: string;
  reimbursableToUserId: string | null;
  createdAt: string;
  updatedAt: string | null;
  createdByName: string | null;
}

interface JobExpensesCardProps {
  jobId: string;
  onTotalsChange?: (totals: { totalExpenses: number }) => void;
}

// ── Component ──

export function JobExpensesCard({ jobId, onTotalsChange }: JobExpensesCardProps) {
  const { toast } = useToast();
  const [dialogState, setDialogState] = useState<{ open: boolean; editingId: string | null }>({ open: false, editingId: null });
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // Form state — shared between create and edit modes
  const [formAmount, setFormAmount] = useState("");
  const [formCategory, setFormCategory] = useState("other");
  const [formDate, setFormDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [formNotes, setFormNotes] = useState("");
  const [formIsBillable, setFormIsBillable] = useState(false);
  const [formReceiptFileId, setFormReceiptFileId] = useState<string | null>(null);
  const [formReceiptName, setFormReceiptName] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEditMode = dialogState.editingId !== null;

  const resetForm = () => {
    setFormAmount("");
    setFormCategory("other");
    setFormDate(format(new Date(), "yyyy-MM-dd"));
    setFormNotes("");
    setFormIsBillable(false);
    setFormReceiptFileId(null);
    setFormReceiptName(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogState({ open: true, editingId: null });
  };

  const openEditDialog = (expense: Expense) => {
    setFormAmount(expense.amount);
    setFormCategory(expense.category);
    setFormDate(format(new Date(expense.date), "yyyy-MM-dd"));
    setFormNotes(expense.notes || "");
    setFormIsBillable(expense.isBillable);
    setFormReceiptFileId(expense.receiptFileId);
    setFormReceiptName(expense.receiptFileId ? "Receipt attached" : null);
    setDialogState({ open: true, editingId: expense.id });
  };

  const closeDialog = () => {
    resetForm();
    setDialogState({ open: false, editingId: null });
  };

  // ── Query ──

  const { data: expenses = [], isLoading } = useQuery<Expense[]>({
    queryKey: ["/api/jobs", jobId, "expenses"],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}/expenses`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch expenses");
      return res.json();
    },
    enabled: !!jobId,
  });

  // ── Totals ──

  const totalExpenses = useMemo(
    () => expenses.reduce((sum, e) => sum + parseFloat(e.amount || "0"), 0),
    [expenses],
  );

  useEffect(() => {
    onTotalsChange?.({ totalExpenses });
  }, [totalExpenses, onTotalsChange]);

  // ── Mutations ──

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "expenses"] });
    queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "cost-summary"] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) =>
      apiRequest(`/api/jobs/${jobId}/expenses`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Expense Added" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiRequest(`/api/jobs/${jobId}/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Expense Updated" });
      closeDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (expenseId: string) =>
      apiRequest(`/api/jobs/${jobId}/expenses/${expenseId}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Expense Deleted" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Receipt upload — reuses existing /api/uploads endpoint ──

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingReceipt(true);
    try {
      const formData = new FormData();
      formData.append("files", file);
      const res = await fetch("/api/uploads", { method: "POST", credentials: "include", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const results: Array<{ fileId: string; originalName: string }> = await res.json();
      if (results.length > 0) {
        setFormReceiptFileId(results[0].fileId);
        setFormReceiptName(results[0].originalName || file.name);
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploadingReceipt(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── Submit (create or edit) ──

  const handleSubmit = () => {
    if (!formAmount || parseFloat(formAmount) <= 0) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    const payload: Record<string, unknown> = {
      amount: formAmount,
      category: formCategory,
      date: new Date(`${formDate}T00:00:00`).toISOString(),
      notes: formNotes || null,
      isBillable: formIsBillable,
      receiptFileId: formReceiptFileId,
    };

    if (isEditMode) {
      updateMutation.mutate({ id: dialogState.editingId!, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  // ── Render ──

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {expenses.length} expense{expenses.length !== 1 ? "s" : ""}
            </span>
            {totalExpenses > 0 && (
              <span className="text-xs font-medium text-foreground">
                {formatCurrency(totalExpenses)}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-auto p-0 text-primary"
            onClick={openCreateDialog}
            data-testid="button-new-expense"
          >
            <Plus className="h-3 w-3 mr-1" />
            New Expense
          </Button>
        </div>

        {expenses.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No expenses recorded. Track additional job costs here.
          </p>
        ) : (
          <div className="space-y-1.5">
            {expenses.map((expense) => {
              const isInvoiced = expense.billingStatus === "added_to_invoice";
              return (
                <div
                  key={expense.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatCurrency(parseFloat(expense.amount))}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {categoryLabel(expense.category)}
                      </Badge>
                      {expense.isBillable ? (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-200 text-blue-600">
                          Billable
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-slate-200 text-slate-400">
                          Internal
                        </Badge>
                      )}
                      {isInvoiced && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-200 text-green-600">
                          Invoiced
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                      <span>{format(new Date(expense.date), "MMM d, yyyy")}</span>
                      {expense.notes && <span className="truncate max-w-[200px]">· {expense.notes}</span>}
                      {expense.createdByName && <span>· {expense.createdByName}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    {expense.receiptFileId && (
                      <a
                        href={`/api/files/${expense.receiptFileId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View receipt"
                      >
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <ImageIcon className="h-3.5 w-3.5 text-blue-500" />
                        </Button>
                      </a>
                    )}
                    {!isInvoiced && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title="Edit"
                          onClick={() => openEditDialog(expense)}
                        >
                          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          title="Delete"
                          onClick={() => setDeleteTarget(expense.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Create / Edit Expense Dialog ── */}
      <Dialog open={dialogState.open} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditMode ? "Edit Expense" : "Add Expense"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Amount</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  data-testid="input-expense-amount"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Category</label>
                <Select value={formCategory} onValueChange={setFormCategory}>
                  <SelectTrigger data-testid="select-expense-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Date</label>
              <Input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                data-testid="input-expense-date"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
              <Textarea
                placeholder="Description or receipt details..."
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                rows={2}
                className="text-sm resize-none"
                data-testid="input-expense-notes"
              />
            </div>

            {/* Receipt upload */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Receipt</label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={handleReceiptUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingReceipt}
                >
                  {uploadingReceipt ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Paperclip className="h-3 w-3 mr-1" />
                  )}
                  {formReceiptFileId ? "Replace" : "Attach"}
                </Button>
                {formReceiptName && (
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">{formReceiptName}</span>
                )}
                {formReceiptFileId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-red-500 h-auto p-0"
                    onClick={() => { setFormReceiptFileId(null); setFormReceiptName(null); }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={formIsBillable}
                onChange={(e) => setFormIsBillable(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Billable to client</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSaving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="button-save-expense"
            >
              {isSaving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {isEditMode ? "Save Changes" : "Add Expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Expense</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this expense? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
