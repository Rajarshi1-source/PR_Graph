import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return (
    <div className="text-muted-foreground flex flex-1 items-center justify-center">
      <LoaderCircle className="size-6 animate-spin" aria-label="Loading" />
    </div>
  );
}
