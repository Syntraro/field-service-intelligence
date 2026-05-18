import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
  ModalSecondaryAction,
  ModalPrimaryAction,
} from "@/components/ui/modal";
import { FormField, FormLabel, FormErrorText } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useCreateServiceTemplate } from "@/lib/serviceTemplates/useServiceTemplates";
import type { ServiceTemplateDto } from "@/lib/serviceTemplates/serviceTemplateTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (template: ServiceTemplateDto) => void;
}

export function PriceBookCreateServiceTemplateDialog({ open, onOpenChange, onCreated }: Props) {
  const { toast } = useToast();
  const createMutation = useCreateServiceTemplate();

  const [name, setName] = useState("");
  const [flatRatePrice, setFlatRatePrice] = useState("");
  const [category, setCategory] = useState("");
  const [errors, setErrors] = useState<{ name?: string; flatRatePrice?: string }>({});

  function reset() {
    setName("");
    setFlatRatePrice("");
    setCategory("");
    setErrors({});
  }

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Name is required";
    if (!flatRatePrice.trim()) {
      errs.flatRatePrice = "Flat rate price is required";
    } else if (!/^\d+(\.\d{1,2})?$/.test(flatRatePrice.trim())) {
      errs.flatRatePrice = "Enter a valid price (e.g. 150 or 149.99)";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    try {
      const created = await createMutation.mutateAsync({
        name: name.trim(),
        flatRatePrice: flatRatePrice.trim(),
        category: category.trim() || null,
      });
      toast({ title: "Template created" });
      onCreated?.(created);
      onOpenChange(false);
      reset();
    } catch (err: any) {
      const msg = err?.message ?? "Could not create template";
      if (msg.toLowerCase().includes("already exists")) {
        setErrors((e) => ({ ...e, name: msg }));
      } else {
        toast({ title: "Error", description: msg, variant: "destructive" });
      }
    }
  }

  function handleOpenChange(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={handleOpenChange}
      className="sm:max-w-[440px]"
    >
      <ModalHeader>
        <ModalTitle>New Flat-Rate Template</ModalTitle>
        <ModalDescription>
          Set a name and flat rate price. Add components in the template rail after creation.
        </ModalDescription>
      </ModalHeader>

      <ModalBody className="flex flex-col gap-4">
        <FormField>
          <FormLabel srOnly htmlFor="st-name">Template name</FormLabel>
          <Input
            id="st-name"
            placeholder="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {errors.name && <FormErrorText>{errors.name}</FormErrorText>}
        </FormField>

        <FormField>
          <FormLabel srOnly htmlFor="st-price">Flat rate price</FormLabel>
          <Input
            id="st-price"
            placeholder="Flat rate price (e.g. 149.99)"
            value={flatRatePrice}
            onChange={(e) => setFlatRatePrice(e.target.value)}
            inputMode="decimal"
          />
          {errors.flatRatePrice && <FormErrorText>{errors.flatRatePrice}</FormErrorText>}
        </FormField>

        <FormField>
          <FormLabel srOnly htmlFor="st-category">Category (optional)</FormLabel>
          <Input
            id="st-category"
            placeholder="Category (optional)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </FormField>
      </ModalBody>

      <ModalFooter>
        <ModalSecondaryAction onClick={() => handleOpenChange(false)}>
          Cancel
        </ModalSecondaryAction>
        <ModalPrimaryAction
          onClick={handleSubmit}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? "Creating…" : "Create"}
        </ModalPrimaryAction>
      </ModalFooter>
    </ModalShell>
  );
}
