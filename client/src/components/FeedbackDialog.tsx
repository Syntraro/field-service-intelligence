import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertFeedbackSchema } from "@shared/schema";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  ModalShell,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from "@/components/ui/modal";

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const feedbackFormSchema = insertFeedbackSchema.extend({
  category: z.string().min(1, "Please select a category"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

type FeedbackFormData = z.infer<typeof feedbackFormSchema>;

export default function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const { toast } = useToast();

  const form = useForm<FeedbackFormData>({
    resolver: zodResolver(feedbackFormSchema),
    defaultValues: {
      category: "",
      message: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FeedbackFormData) => {
      return apiRequest("/api/feedback", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      toast({
        title: "Feedback submitted",
        description: "Thank you for your feedback! We'll review it soon.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      form.reset();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to submit feedback",
        description: error.message || "Please try again later",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FeedbackFormData) => {
    createMutation.mutate(data);
  };

  return (
    <ModalShell open={open} onOpenChange={onOpenChange} className="sm:max-w-[550px]" data-testid="dialog-feedback">
      <ModalHeader>
        <ModalTitle>Send Feedback</ModalTitle>
        <ModalDescription>
          Share your recommendations, questions, or report issues with the app.
        </ModalDescription>
      </ModalHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <ModalBody className="space-y-4">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-feedback-category">
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="recommendation" data-testid="option-recommendation">Recommendation</SelectItem>
                      <SelectItem value="question" data-testid="option-question">Question</SelectItem>
                      <SelectItem value="bug" data-testid="option-bug">Bug Report</SelectItem>
                      <SelectItem value="feature" data-testid="option-feature">Feature Request</SelectItem>
                      <SelectItem value="other" data-testid="option-other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Tell us more about your feedback..."
                      className="min-h-[150px] resize-none"
                      data-testid="textarea-feedback-message"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </ModalBody>

          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="button-cancel-feedback"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending}
              data-testid="button-submit-feedback"
            >
              {createMutation.isPending ? "Submitting..." : "Submit Feedback"}
            </Button>
          </ModalFooter>
        </form>
      </Form>
    </ModalShell>
  );
}
