import { defineConfig } from "@trigger.dev/sdk/v3";
import { pythonExtension } from "@trigger.dev/python/extension";
import { additionalFiles } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_zkqctocaqceqitxjtbar",

  dirs: ["./src/trigger"],

  maxDuration: 300,

  // cwd matches the build directory in both dev and deploy
  legacyDevProcessCwdBehaviour: false,

  build: {
    extensions: [
      // Installs Python + requirements.txt and copies the agent scripts into the image
      pythonExtension({
        scripts: ["agent/**/*.py"],
        requirementsFile: "./requirements.txt",
        devPythonBinaryPath: ".venv/bin/python",
      }),
      // Only the static thesis is bundled; dynamic memory lives in Vercel Blob.
      additionalFiles({ files: ["brain/thesis.md"] }),
    ],
  },

  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      factor: 1.5,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      randomize: true,
    },
  },
});
