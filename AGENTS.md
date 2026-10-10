<!-- caveman-begin -->
Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Answer first: Answer, then reason, then next step.
- Kill ceremony: No greeting, hedging, pleasantries, recap, or closer.
- Short word: "fix" not "implement a solution for".
- Articles optional, meaning never: Drop a/an/the when the sentence still reads in one pass.
- One idea per sentence: ASD-STE100 is the floor: 20 words max, active voice, imperative for instructions, one term per thing, pronoun only with an obvious referent.
- Payload verbatim: Code blocks unchanged.
- Tool runs: bounded status: No text between routine calls.
- User's language: Compress the style, not the language.
- Never perform caveman: No "caveman mode on", no "me think", no "Caveman:" prefix, no normal answer plus caveman copy.

Switch: /caveman (default), /ultracave (fragments, each fact once), /megacave (Classical Chinese 文言文)
Stop: "stop caveman" or "normal mode"

Auto-Clarity: plain prose for security warnings, irreversible actions, step order a fragment could scramble, user confused. Resume after.

Boundaries: code, comments, commits, PRs, docs written normal.
Floor: code, commands, paths, numbers and error strings verbatim; never drop not/never/no/only.
<!-- caveman-end -->

# OpenFishTools Web Tools AI Agent Guidelines

## 1. System Architecture & Component Map
- `ai/`: AI vision and matting tools (`rembg-tool.js`, `upscale-tool.js`, `upscale-gpu-enhancer.js`).
- `video/`: Video & audio utilities (`audio-extractor-tool.js`, `video-compressor-tool.js`, `image-sequence-tool.js`, `video-interpolation-tool.js`).
- `converters/`: Animation and project format converters (`ae-to-am-beatmark-tool.js`, `fivemb-generator-tool.js`).
- `tiktok/`: Social media and container tools (`tiktok-downloader-tool.js`, `tiktok-quality-tool.js`, `tiktok-stats-tool.js`).
- `method/`: Core binary atom patching and compression helpers (`finalize.js`, `compress.js`, `emergencymethod.js`, `wmvpatch.js`, `FRYMethod.js`, `binarypatch.js`, `fpspatch.js`, `streamshield.js`).
- `workers/`: Background Web Worker execution scripts for high-load media processing.
- `package.json`: Single source of truth for library version.

## 2. Universal, Headless, Schema-Driven Tool Standard (MANDATORY)
Every tool in this repository MUST comply with the headless tool architecture:
1. **Zero DOM Coupling**: Tools must never access `document.getElementById`, query DOM nodes, or assume specific markup. Any UI host (React, Vue, Vanilla) must be able to drive the tool purely through schema and inputs.
2. **Declarative Schema**: Export a complete `tool.schema.inputs` definition specifying input keys, types (`file`, `select`, `slider`, `number`, `toggle`, `segmented`, `url`, `textarea`), labels, defaults, and validation rules.
3. **Pure Execution Runner**: Every tool must implement an asynchronous `run(inputs, context)` function:
   - `inputs`: Plain object matching the declarative schema keys.
   - `context`: Execution context providing callbacks: `onProgress(percent, statusText)`, `onLog(msg)`, `onPreview(data)`.
4. **Standardized Output**: Returns clean output objects:
   - Binary file: `{ type: 'file', data: Blob, filename: string, mimeType?: string }`.
   - Data payload: `{ type: 'data', data: any }`.

## 3. Strict File Manipulation Tooling (NO SCRIPT-BASED EDITS)
- **STRICTLY FORBIDDEN**: Using Python scripts, Node.js scripts, `sed`, `awk`, `echo >`, `cat << 'EOF'`, or shell redirection to edit or generate code files.
- **MANDATORY**: All file creations and code modifications MUST strictly use the agent's native tool calls (`replace_file_content` or `write_to_file`).

## 4. Error Investigation & Diagnostic Protocol
When debugging tools or processing failures:
1. **Diagnostic Tooling (Read-Only)**: Use `node --check <file>` for syntax checks, and read-only test runners to inspect errors.
2. **Buffer and Memory Safety**: Always release `URL.revokeObjectURL()` and free WebAssembly memory after processing.
3. **Worker Error Boundaries**: Ensure worker scripts communicate failures cleanly via `postMessage({ error: err.message })` without terminating silently.

## 5. Versioning & SSOT
- **Single Source of Truth**: Repository version is strictly defined in `package.json`.
- **Bumping Version**: Update `"version"` in `package.json` directly. Shields badges and external consumers query this value automatically.
- **NO Hardcoded Fallbacks**: Never hardcode fallback version literals in library files.

## 6. Strict Git Safety & Working Tree Protection
- **Zero Silent Git Changes**: STRICTLY FORBIDDEN to run `git checkout`, `git restore`, `git reset`, `git clean`, `git pull`, `git switch`, or any Git command that alters or discards local changes without explicit user consent.
- **Preserve Uncommitted Work**: Always respect and preserve active uncommitted edits and untracked files in the working directory.
- **Zero Emojis**: Git commit messages, comments, and documentation must never contain emojis.
