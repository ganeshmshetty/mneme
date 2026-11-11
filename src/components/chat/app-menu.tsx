"use client";

import {
  KeyRoundIcon,
  MoreHorizontalIcon,
  MoonIcon,
  PlusIcon,
  RotateCcwIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AppMenu({
  dark,
  onToggleTheme,
  onNewChat,
  onAddKey,
  onDeleteChat,
  onResetMemory,
}: {
  dark: boolean;
  onToggleTheme: () => void;
  onNewChat: () => void;
  onAddKey: () => void;
  onDeleteChat?: () => void;
  onResetMemory?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground"
            aria-label="Menu"
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onNewChat}>
          <PlusIcon />
          New chat
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onAddKey}>
          <KeyRoundIcon />
          Add a key
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onToggleTheme}>
          {dark ? <SunIcon /> : <MoonIcon />}
          {dark ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        {onDeleteChat ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDeleteChat}>
              <Trash2Icon />
              Delete chat
            </DropdownMenuItem>
          </>
        ) : null}
        {onResetMemory ? (
          <DropdownMenuItem variant="destructive" onClick={onResetMemory}>
            <RotateCcwIcon />
            Reset memory
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
