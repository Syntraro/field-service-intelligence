/**
 * AddressAutocompleteField — React Hook Form adapter for AddressAutocomplete.
 *
 * Wraps AddressAutocomplete with RHF Controller so it integrates seamlessly
 * with form state and validation. On place selection, uses form.setValue()
 * to populate related address fields.
 */
import { useFormContext, Controller } from "react-hook-form";
import AddressAutocomplete from "@/components/ui/AddressAutocomplete";
import type { PlaceSelectPayload } from "@/components/ui/AddressAutocomplete";
import { FormItem, FormLabel, FormMessage } from "@/components/ui/form";

interface AddressAutocompleteFieldProps {
  /** RHF field name for the street address value */
  name: string;
  label?: string;
  placeholder?: string;
  className?: string;
  id?: string;
  "data-testid"?: string;
  /**
   * Map from PlaceSelectPayload field → RHF field name.
   * Example: { city: "city", province: "provinceState", postalCode: "postalCode" }
   */
  fieldMapping: {
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
  };
}

export default function AddressAutocompleteField({
  name,
  label,
  placeholder,
  className,
  id,
  "data-testid": testId,
  fieldMapping,
}: AddressAutocompleteFieldProps) {
  const form = useFormContext();

  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          {label && <FormLabel>{label}</FormLabel>}
          <AddressAutocomplete
            id={id}
            value={field.value || ""}
            onChange={(val) => field.onChange(val)}
            onPlaceSelect={(p: PlaceSelectPayload) => {
              field.onChange(p.street);
              if (fieldMapping.city && p.city) form.setValue(fieldMapping.city, p.city);
              if (fieldMapping.province && p.province) form.setValue(fieldMapping.province, p.province);
              if (fieldMapping.postalCode && p.postalCode) form.setValue(fieldMapping.postalCode, p.postalCode);
              if (fieldMapping.country && p.country) form.setValue(fieldMapping.country, p.country);
            }}
            placeholder={placeholder}
            className={className}
            data-testid={testId}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
