import { Button } from "@/components/ui/button";
import { manageBillingAction } from "./actions";

export function ManageBillingButton() {
  return (
    <form action={manageBillingAction}>
      <Button type="submit" variant="outline" size="sm">
        Manage billing
      </Button>
    </form>
  );
}
