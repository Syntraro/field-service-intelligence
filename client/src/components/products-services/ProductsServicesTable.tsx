import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "@/components/ui/action-menu";
import { ChevronUp, ChevronDown, MoreHorizontal, Pencil, Archive, Trash2, Loader2 } from "lucide-react";
import { ListSurface } from "@/components/ui/list-surface";
import { Part, SortField, SortDirection, formatCurrency, formatDuration } from "./types";

interface ProductsServicesTableProps {
  parts: Part[];
  isLoading: boolean;
  searchQuery: string;
  selectedIds: Set<string>;
  onSelectAll: () => void;
  onSelectOne: (id: string, checked: boolean) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  // Inline edit
  inlineEditId: string | null;
  inlineEditField: string | null;
  inlineEditValue: string;
  onInlineEditValueChange: (value: string) => void;
  onInlineEdit: (id: string, field: string, currentValue: string) => void;
  onInlineEditSave: (id: string, field: string) => void;
  // Actions
  onEditClick: (part: Part) => void;
  onArchiveClick: (part: Part) => void;
  onDeleteClick: (part: Part) => void;
}

export function ProductsServicesTable({
  parts,
  isLoading,
  searchQuery,
  selectedIds,
  onSelectAll,
  onSelectOne,
  sortField,
  sortDirection,
  onSort,
  inlineEditId,
  inlineEditField,
  inlineEditValue,
  onInlineEditValueChange,
  onInlineEdit,
  onInlineEditSave,
  onEditClick,
  onArchiveClick,
  onDeleteClick,
}: ProductsServicesTableProps) {
  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer hover:bg-muted/50 select-none"
      onClick={() => onSort(field)}
      data-testid={`sort-${field}`}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortField === field && (
          sortDirection === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        )}
      </div>
    </th>
  );

  return (
    <ListSurface>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900">
            <tr>
              <th className="px-3 py-2 w-10">
                <Checkbox
                  checked={selectedIds.size === parts.length && parts.length > 0}
                  onCheckedChange={onSelectAll}
                  data-testid="checkbox-select-all"
                />
              </th>
              <SortHeader field="name" label="Name" />
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
              <SortHeader field="type" label="Type" />
              <SortHeader field="category" label="Category" />
              <SortHeader field="cost" label="Cost" />
              <SortHeader field="unitPrice" label="Price" />
              <SortHeader field="estimatedDurationMinutes" label="Duration" />
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="py-12 text-center">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </td>
              </tr>
            ) : parts.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-muted-foreground">
                  {searchQuery ? `No results for "${searchQuery}"` : "No products or services found"}
                </td>
              </tr>
            ) : (
              parts.map((part) => (
                <tr
                  key={part.id}
                  className={`border-b border-gray-200 dark:border-gray-800 hover:bg-gray-100/60 dark:hover:bg-gray-800/60 transition-colors ${part.isActive === false ? "opacity-50" : ""}`}
                  data-testid={`row-${part.id}`}
                >
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selectedIds.has(part.id)}
                      onCheckedChange={(checked) => onSelectOne(part.id, checked as boolean)}
                      data-testid={`checkbox-${part.id}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    {inlineEditId === part.id && inlineEditField === "name" ? (
                      <Input
                        value={inlineEditValue}
                        onChange={(e) => onInlineEditValueChange(e.target.value)}
                        onBlur={() => onInlineEditSave(part.id, "name")}
                        onKeyDown={(e) => e.key === "Enter" && onInlineEditSave(part.id, "name")}
                        autoFocus
                        className="h-7 text-sm"
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:underline font-medium"
                        onClick={() => onInlineEdit(part.id, "name", part.name || "")}
                        data-testid={`text-name-${part.id}`}
                      >
                        {part.name || "-"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-[200px]">
                    {inlineEditId === part.id && inlineEditField === "description" ? (
                      <Input
                        value={inlineEditValue}
                        onChange={(e) => onInlineEditValueChange(e.target.value)}
                        onBlur={() => onInlineEditSave(part.id, "description")}
                        onKeyDown={(e) => e.key === "Enter" && onInlineEditSave(part.id, "description")}
                        autoFocus
                        className="h-7 text-sm"
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:underline text-muted-foreground truncate block"
                        onClick={() => onInlineEdit(part.id, "description", part.description || "")}
                      >
                        {part.description || "-"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary" className="text-xs capitalize">
                      {part.type}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    {inlineEditId === part.id && inlineEditField === "category" ? (
                      <Input
                        value={inlineEditValue}
                        onChange={(e) => onInlineEditValueChange(e.target.value)}
                        onBlur={() => onInlineEditSave(part.id, "category")}
                        onKeyDown={(e) => e.key === "Enter" && onInlineEditSave(part.id, "category")}
                        autoFocus
                        className="h-7 text-sm"
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:underline"
                        onClick={() => onInlineEdit(part.id, "category", part.category || "")}
                      >
                        {part.category || "-"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {inlineEditId === part.id && inlineEditField === "cost" ? (
                      <Input
                        type="number"
                        step="0.01"
                        value={inlineEditValue}
                        onChange={(e) => onInlineEditValueChange(e.target.value)}
                        onBlur={() => onInlineEditSave(part.id, "cost")}
                        onKeyDown={(e) => e.key === "Enter" && onInlineEditSave(part.id, "cost")}
                        autoFocus
                        className="h-7 text-sm w-24"
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:underline"
                        onClick={() => onInlineEdit(part.id, "cost", part.cost || "")}
                      >
                        {formatCurrency(part.cost)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {inlineEditId === part.id && inlineEditField === "unitPrice" ? (
                      <Input
                        type="number"
                        step="0.01"
                        value={inlineEditValue}
                        onChange={(e) => onInlineEditValueChange(e.target.value)}
                        onBlur={() => onInlineEditSave(part.id, "unitPrice")}
                        onKeyDown={(e) => e.key === "Enter" && onInlineEditSave(part.id, "unitPrice")}
                        autoFocus
                        className="h-7 text-sm w-24"
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:underline font-medium"
                        onClick={() => onInlineEdit(part.id, "unitPrice", part.unitPrice || "")}
                      >
                        {formatCurrency(part.unitPrice)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {inlineEditId === part.id && inlineEditField === "estimatedDurationMinutes" ? (
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={inlineEditValue}
                        onChange={(e) => onInlineEditValueChange(e.target.value)}
                        onBlur={() => onInlineEditSave(part.id, "estimatedDurationMinutes")}
                        onKeyDown={(e) => e.key === "Enter" && onInlineEditSave(part.id, "estimatedDurationMinutes")}
                        autoFocus
                        className="h-7 text-sm w-20"
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:underline"
                        onClick={() => onInlineEdit(part.id, "estimatedDurationMinutes", part.estimatedDurationMinutes != null ? String(part.estimatedDurationMinutes) : "")}
                      >
                        {formatDuration(part.estimatedDurationMinutes)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <ActionMenu
                      items={[
                        {
                          id: "edit",
                          label: "Edit",
                          icon: Pencil,
                          onSelect: () => onEditClick(part),
                        },
                        {
                          id: "archive",
                          label: part.isActive === false ? "Restore" : "Archive",
                          icon: Archive,
                          onSelect: () => onArchiveClick(part),
                        },
                        {
                          id: "delete",
                          label: "Delete",
                          icon: Trash2,
                          onSelect: () => onDeleteClick(part),
                          tone: "destructive",
                        },
                      ]}
                      trigger={
                        <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`menu-${part.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      }
                      align="end"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </ListSurface>
  );
}
