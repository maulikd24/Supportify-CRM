"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function RouteError({ reset }: { reset: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Something went wrong</CardTitle>
        <CardDescription>This section failed to load. You can try again.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="sm" onClick={() => reset()}>
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}
