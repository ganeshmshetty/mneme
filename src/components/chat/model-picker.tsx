"use client";

import * as React from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  KeyRoundIcon,
  SearchIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { KeyStatus, ModelOption } from "@/lib/models";
import { cn } from "cn";

function matches(model: ModelOption, query: string): boolean {
  if (!query.trim()) return true;
  return [model.label, model.modelId, model.family]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}

export function ModelPicker({
  value,
  onChange,
  models,
  keys,
  opencode,
  onAddKey,
}: {
  value: string;
  onChange: (id: string) => void;
  models: ModelOption[];
  keys: Record<string, KeyStatus>;
  opencode: boolean;
  onAddKey: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const current = models.find((model) => model.id === value) ?? models[0];
  if (!current) return null;

  const available = (model: ModelOption) =>
    Boolean(keys[model.keyEnv]?.configured) || opencode;

  const visible = models
    .filter((model) => available(model) && matches(model, query))
    .sort((a, b) => {
      if (a.id === value) return -1;
      if (b.id === value) return 1;
      return a.label.localeCompare(b.label);
    });

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-8 max-w-[10.5rem] gap-1 rounded-full px-2 text-xs text-foreground/70 hover:text-foreground"
            aria-label={`Model: ${current.label}`}
          />
        }
      >
        <span className="truncate">{current.label}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-72 gap-0 overflow-hidden rounded-xl p-0"
      >
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            placeholder="Search models…"
            aria-label="Search models"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-[20rem] overflow-y-auto p-1.5">
          {visible.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No models found.
            </div>
          ) : (
            visible.map((model) => {
              const selected = model.id === value;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => select(model.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/30",
                    selected && "bg-accent/70",
                  )}
                >
                  <span className="truncate">{model.label}</span>
                  {selected ? <CheckIcon className="size-4 shrink-0" /> : null}
                </button>
              );
            })
          )}
        </div>

        <div className="border-t border-border/70 p-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false);
              onAddKey();
            }}
            className="h-8 w-full justify-start rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <KeyRoundIcon className="size-3.5" />
            Add or replace a key
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
