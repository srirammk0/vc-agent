/** Parse JSON from agent/main.py stdout. The script prints one JSON object on the
 * last line; anything before that may be logfire or other stderr-forwarded noise. */
export function parsePythonStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("python script returned empty stdout");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.startsWith("{") && !line.startsWith("[")) continue;
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
    throw new Error(`could not parse JSON from python stdout: ${trimmed.slice(0, 500)}`);
  }
}
