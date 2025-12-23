"use client";

import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "@/icons";

type HelpHintProps = {
  title: string;
  brief: string;
  detail?: string | React.ReactNode;
  className?: string;
};

export function HelpHint({ title, brief, detail, className }: HelpHintProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => detail && setOpen(true)}
            className={
              "inline-flex items-center justify-center h-4 w-4 rounded-full text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
              (className || "")
            }
            aria-label={`Más info: ${title}`}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{brief}</TooltipContent>
      </Tooltip>
      {detail ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">{detail}</div>
            <div className="flex justify-end mt-3">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cerrar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

