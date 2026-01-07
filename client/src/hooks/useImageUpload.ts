import { useState, useCallback, useRef } from "react";
import { toast } from "@/hooks/use-toast";

const DEFAULT_MAX_SIZE = 5 * 1024 * 1024; // 5MB

interface UseImageUploadOptions {
  maxSize?: number;
  onSelect?: (dataUrl: string) => void;
}

/**
 * Hook for handling image file selection and validation.
 * Eliminates duplicate file handling code across dialogs.
 */
export function useImageUpload(options: UseImageUploadOptions = {}) {
  const { maxSize = DEFAULT_MAX_SIZE, onSelect } = options;
  const [preview, setPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > maxSize) {
      toast({
        title: "File too large",
        description: `Maximum file size is ${Math.round(maxSize / 1024 / 1024)}MB`,
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
      setIsLoading(false);
      onSelect?.(dataUrl);
    };
    reader.onerror = () => {
      toast({
        title: "Error",
        description: "Failed to read file",
        variant: "destructive",
      });
      setIsLoading(false);
    };
    reader.readAsDataURL(file);
  }, [maxSize, onSelect]);

  const clear = useCallback(() => {
    setPreview(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }, []);

  const getFile = useCallback(() => {
    return inputRef.current?.files?.[0] || null;
  }, []);

  return {
    preview,
    isLoading,
    inputRef,
    handleSelect,
    clear,
    getFile,
  };
}
