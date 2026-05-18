import { useLocation } from "wouter";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SETTINGS_CATEGORIES, type SettingsChild } from "@/lib/settingsNavConfig";

interface Props {
  categoryKey: string;
}

export default function SettingsCategoryPage({ categoryKey }: Props) {
  const [, setLocation] = useLocation();
  const category = SETTINGS_CATEGORIES.find((c) => c.key === categoryKey);

  if (!category) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>Category not found.</p>
      </div>
    );
  }

  const Icon = category.icon;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/settings")}
          data-testid="button-back-settings"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-muted shrink-0">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{category.title}</h1>
            <p className="text-sm text-muted-foreground">{category.description}</p>
          </div>
        </div>
      </div>

      {/* Children list */}
      <div className="space-y-1">
        {category.children.map((child: SettingsChild) => {
          const ChildIcon = child.icon;
          return (
            <button
              key={child.key}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-lg border bg-card shadow-sm hover:border-primary/30 hover:shadow-md transition-all text-left group"
              onClick={() => setLocation(child.href)}
            >
              <div className="p-2 rounded-md bg-muted group-hover:bg-primary/10 transition-colors shrink-0">
                <ChildIcon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{child.title}</p>
                <p className="text-helper text-muted-foreground">{child.description}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-50 group-hover:opacity-100 group-hover:text-primary transition-all shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
