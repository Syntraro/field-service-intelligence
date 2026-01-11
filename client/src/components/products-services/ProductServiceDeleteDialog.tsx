import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, Loader2 } from "lucide-react";
import { Part } from "./types";

// Single Delete Confirmation
interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Part | null;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  product,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Item?</AlertDialogTitle>
          <AlertDialogDescription>Delete "{product?.name}"? This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Archive Confirmation
interface ArchiveConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Part | null;
  onConfirm: () => void;
}

export function ArchiveConfirmDialog({
  open,
  onOpenChange,
  product,
  onConfirm,
}: ArchiveConfirmDialogProps) {
  const isRestoring = product?.isActive === false;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isRestoring ? "Restore" : "Archive"} Item?</AlertDialogTitle>
          <AlertDialogDescription>
            {isRestoring
              ? `Restore "${product?.name}" to active items?`
              : `Archive "${product?.name}"? It will be hidden from active views but preserved for historical records.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {isRestoring ? "Restore" : "Archive"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Bulk Delete Confirmation
interface BulkDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onConfirm: () => void;
}

export function BulkDeleteDialog({
  open,
  onOpenChange,
  count,
  onConfirm,
}: BulkDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {count} Items?</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone. Consider archiving instead.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Bulk Category Dialog
interface BulkCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  value: string;
  onValueChange: (value: string) => void;
  uniqueCategories: string[];
  onApply: () => void;
  isPending: boolean;
}

export function BulkCategoryDialog({
  open,
  onOpenChange,
  count,
  value,
  onValueChange,
  uniqueCategories,
  onApply,
  isPending,
}: BulkCategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update Category</DialogTitle>
          <DialogDescription>Set the category for {count} selected item(s).</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder="Type or select a category"
            list="bulk-category-options"
            data-testid="input-bulk-category"
          />
          <datalist id="bulk-category-options">
            {uniqueCategories.map((cat) => (
              <option key={cat} value={cat} />
            ))}
          </datalist>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onApply} disabled={!value || isPending}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Import Dialog
interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  fileContent: string;
  updateExisting: boolean;
  onUpdateExistingChange: (value: boolean) => void;
  onImport: () => void;
  onCancel: () => void;
  isPending: boolean;
}

export function ImportDialog({
  open,
  onOpenChange,
  fileName,
  fileContent,
  updateExisting,
  onUpdateExistingChange,
  onImport,
  onCancel,
  isPending,
}: ImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Import Products & Services</DialogTitle>
          <DialogDescription>Import from CSV file.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">{fileName}</p>
              <p className="text-xs text-muted-foreground">{fileContent.split("\n").length - 1} rows</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="update-existing" checked={updateExisting} onCheckedChange={(c) => onUpdateExistingChange(c as boolean)} />
            <Label htmlFor="update-existing" className="font-normal cursor-pointer">Update existing items (match by name)</Label>
          </div>
          <div className="text-sm text-muted-foreground">
            <p className="font-medium mb-1">Expected columns:</p>
            <p className="text-xs">name (required), type (required), sku, description, cost, unit_price, category, is_taxable, is_active</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onImport} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
