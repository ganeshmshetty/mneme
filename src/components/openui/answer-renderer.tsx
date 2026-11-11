"use client";

import { useState } from "react";
import { Renderer } from "@openuidev/react-lang";
import { openuiLibrary } from "@/lib/openui/library";
import { Markdown } from "@/components/markdown";

export function OpenUIAnswer({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (failed && !isStreaming) {
    return <Markdown>{text}</Markdown>;
  }

  return (
    <div className="openui-answer w-full min-w-0">
      <Renderer
        response={text}
        library={openuiLibrary}
        isStreaming={isStreaming}
        onError={(errors) => {
          if (errors.some((error) => error.severity !== "warning")) {
            setFailed(true);
          }
        }}
      />
    </div>
  );
}
