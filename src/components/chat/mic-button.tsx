"use client";

import { useEffect, useRef, useState } from "react";
import { MicIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Orb } from "@/components/orb";

interface SpeechAlternative {
  transcript: string;
}

interface SpeechResult {
  readonly length: number;
  [index: number]: SpeechAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  results: {
    readonly length: number;
    [index: number]: SpeechResult;
  };
  resultIndex: number;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

export function MicButton({
  onStart,
  onTranscript,
}: {
  onStart?: () => void;
  onTranscript: (text: string) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(Boolean(getSpeechRecognition()));
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  if (!supported) return null;

  function toggle() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const Constructor = getSpeechRecognition();
    if (!Constructor) return;

    onStart?.();
    const recognition = new Constructor();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? "";
      }
      const text = transcript.trim();
      if (text) onTranscript(text);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={listening ? "Stop voice input" : "Voice input"}
      className="size-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
    >
      {listening ? (
        <Orb size={20} state="listening" />
      ) : (
        <MicIcon className="size-4" />
      )}
    </Button>
  );
}
