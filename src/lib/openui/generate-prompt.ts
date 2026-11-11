import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getOpenUIPrompt } from "./library";

const prompt = getOpenUIPrompt();
const output = `// Generated from src/lib/openui/library.tsx.
// Regenerate with: npx tsx src/lib/openui/generate-prompt.ts
// The server imports this string; it must never import the React library.

export const OPENUI_PROMPT = ${JSON.stringify(prompt)};
`;

writeFileSync(fileURLToPath(new URL("./prompt.ts", import.meta.url)), output);
console.log(`Wrote src/lib/openui/prompt.ts (${prompt.length} chars).`);
