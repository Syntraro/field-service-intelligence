/** Client-side DTO types for service templates (mirrors server storage layer). */

export interface ServiceTemplateComponentDto {
  id: string;
  companyId: string;
  templateId: string;
  itemId: string;
  quantity: string;
  unitCostSnapshot: string | null;
  sortOrder: number;
  notes: string | null;
  itemName: string | null;
  itemType: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface ServiceTemplateDto {
  id: string;
  companyId: string;
  userId: string | null;
  name: string;
  internalName: string | null;
  description: string | null;
  internalNotes: string | null;
  category: string | null;
  subcategory: string | null;
  flatRatePrice: string;
  estimatedDurationMinutes: number | null;
  requiredSkillTags: string[];
  teamSizeRequired: number;
  isActive: boolean;
  usageCount: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  components: ServiceTemplateComponentDto[];
}

export interface CreateServiceTemplateBody {
  name: string;
  internalName?: string | null;
  description?: string | null;
  internalNotes?: string | null;
  category?: string | null;
  subcategory?: string | null;
  flatRatePrice: string;
  estimatedDurationMinutes?: number | null;
  requiredSkillTags?: string[];
  teamSizeRequired?: number;
}

export interface UpdateServiceTemplateBody {
  name?: string;
  internalName?: string | null;
  description?: string | null;
  internalNotes?: string | null;
  category?: string | null;
  subcategory?: string | null;
  flatRatePrice?: string;
  estimatedDurationMinutes?: number | null;
  requiredSkillTags?: string[];
  teamSizeRequired?: number;
  isActive?: boolean;
}

export interface ComponentInput {
  itemId: string;
  quantity: string;
  unitCostSnapshot?: string | null;
  sortOrder?: number;
  notes?: string | null;
}

export interface SetComponentsBody {
  components: ComponentInput[];
}
