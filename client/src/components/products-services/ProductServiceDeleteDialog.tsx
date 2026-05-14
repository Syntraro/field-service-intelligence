import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ConfirmModal,
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalPrimaryAction,
  ModalSecondaryAction,
} from "@/components/ui/modal";
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
import { FileText, Loader2 } from "lucide-react";
import { Part } from "./types";

// Single Delete Confirmation — destructive → AlertDialog per CLAUDE.md taxonomy rule #1
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
      <AlertDialogContent data-testid="delete-item-modal">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Item?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete &ldquo;{product?.name}&rdquo;? This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="delete-item-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="delete-item-confirm"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Archive / Restore Confirmation — neutral (reversible) → ConfirmModal stays correct.
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
    <ConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      title={`${isRestoring ? "Restore" : "Archive"} Item?`}
      description={
        isRestoring
          ? `Restore "${product?.name}" to active items?`
          : `Archive "${product?.name}"? It will be hidden from active views but preserved for historical records.`
      }
      confirmLabel={isRestoring ? "Restore" : "Archive"}
      variant="neutral"
      onConfirm={onConfirm}
      testIdPrefix="archive-item"
    />
  );
}

// Bulk Delete Confirmation — destructive → AlertDialog per CLAUDE.md taxonomy rule #1
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
      <AlertDialogContent data-testid="bulk-delete-modal">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {count} Items?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. Consider archiving instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="bulk-delete-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="bulk-delete-confirm"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Bulk Category Dialog — generic form → ModalShell per CLAUDE.md taxonomy rule #2
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
    <ModalShell open={open} onOpenChange={onOpenChange} className="sm:max-w-md">
      <ModalHeader>
        <ModalTitle>Update Category</ModalTitle>
        <ModalDescription>Set the category for {count} selected item(s).</ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-2">
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
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryAction onClick={() => onOpenChange(false)}>Cancel</ModalSecondaryAction>
        <ModalPrimaryAction onClick={onApply} disabled={!value || isPending}>
          Apply
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}

// Import Dialog — generic form → ModalShell per CLAUDE.md taxonomy rule #2
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
    <ModalShell open={open} onOpenChange={onOpenChange} className="sm:max-w-[550px]">
      <ModalHeader>
        <ModalTitle>Import Pricebook items</ModalTitle>
        <ModalDescription>Import from CSV file.</ModalDescription>
      </ModalHeader>
      <ModalBody className="space-y-4">
        <div className="flex items-center gap-3 p-3 bg-muted rounded-md">
          <FileText className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-medium text-sm">{fileName}</p>
            <p className="text-helper text-muted-foreground">{fileContent.split("\n").length - 1} rows</p>
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
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryAction onClick={onCancel}>Cancel</ModalSecondaryAction>
        <ModalPrimaryAction onClick={onImport} disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
          Import
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
