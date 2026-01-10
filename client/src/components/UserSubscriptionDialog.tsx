import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CreditCard } from "lucide-react";

interface Plan {
  id: string;
  name: string;
  displayName: string;
  price: number;
  locationLimit: number;
  active: boolean;
}

interface UserSubscriptionDialogProps {
  userId: string;
  userEmail: string;
}

export function UserSubscriptionDialog({ userId, userEmail }: UserSubscriptionDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const { toast } = useToast();

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ["/api/subscriptions/plans"],
  });

  const updateSubscriptionMutation = useMutation({
    mutationFn: async (planName: string) => {
      await apiRequest(`/api/admin/users/${userId}/subscription`, { method: "PATCH", body: JSON.stringify({ planName }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Subscription updated",
        description: "User subscription plan has been updated successfully.",
      });
      setOpen(false);
      setSelectedPlan("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update subscription",
        variant: "destructive",
      });
    },
  });

  const handleUpdateSubscription = () => {
    if (!selectedPlan) {
      toast({
        title: "No plan selected",
        description: "Please select a plan to assign to this user.",
        variant: "destructive",
      });
      return;
    }

    updateSubscriptionMutation.mutate(selectedPlan);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          data-testid={`button-manage-subscription-${userId}`}
          title="Manage subscription"
        >
          <CreditCard className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="dialog-manage-subscription">
        <DialogHeader>
          <DialogTitle>Manage Subscription</DialogTitle>
          <DialogDescription>
            Update subscription plan for {userEmail}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="plan">Subscription Plan</Label>
            <Select value={selectedPlan} onValueChange={setSelectedPlan}>
              <SelectTrigger data-testid="select-subscription-plan">
                <SelectValue placeholder="Select a plan" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem 
                    key={plan.id} 
                    value={plan.name}
                    data-testid={`option-plan-${plan.name}`}
                  >
                    {plan.displayName} - 
                    {plan.locationLimit === 9999999 ? " Unlimited" : ` ${plan.locationLimit} locations`}
                    {plan.price > 0 && ` ($${plan.price}/month)`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedPlan && (
            <div className="rounded-lg bg-muted p-4 text-sm">
              <p className="font-medium mb-2">Plan Details</p>
              {plans.find(p => p.name === selectedPlan) && (
                <div className="space-y-1 text-muted-foreground">
                  <p>Plan: {plans.find(p => p.name === selectedPlan)!.displayName}</p>
                  <p>
                    Locations: {plans.find(p => p.name === selectedPlan)!.locationLimit === 9999999 
                      ? "Unlimited" 
                      : plans.find(p => p.name === selectedPlan)!.locationLimit}
                  </p>
                  <p>Price: ${plans.find(p => p.name === selectedPlan)!.price}/month</p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
              setSelectedPlan("");
            }}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpdateSubscription}
            disabled={!selectedPlan || updateSubscriptionMutation.isPending}
            data-testid="button-save-subscription"
          >
            {updateSubscriptionMutation.isPending ? "Updating..." : "Update Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
