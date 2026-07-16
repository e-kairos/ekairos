import { spawn } from "node:child_process"

const model = process.env.EKAIROS_LAB_CODEX_MODEL || "gpt-5.5"
const prompt = "Return exactly: ekairos-lab-codex-smoke-ok"

function psQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

const codexArgs = [
  "exec",
  "--ignore-user-config",
  "--model",
  model,
  "--dangerously-bypass-approvals-and-sandbox",
  prompt,
]

const command =
  process.platform === "win32"
    ? "powershell.exe"
    : "codex"

const args =
  process.platform === "win32"
    ? [
        "-NoProfile",
        "-Command",
        [
          "codex",
          "exec",
          "--ignore-user-config",
          "--model",
          psQuote(model),
          "--dangerously-bypass-approvals-and-sandbox",
          psQuote(prompt),
        ].join(" "),
      ]
    : codexArgs

const child = spawn(
  command,
  args,
  {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  },
)

let stdout = ""
let stderr = ""
child.stdout.on("data", (chunk) => {
  stdout += String(chunk)
})
child.stderr.on("data", (chunk) => {
  stderr += String(chunk)
})

child.on("close", (code) => {
  const output = [stdout, stderr].join("\n")
  const evidence = output
    .split(/\r?\n/)
    .filter((line) =>
      /model:|approval:|sandbox:|session id:|ekairos-lab-codex-smoke-ok|ERROR:|not supported/i.test(line),
    )
    .join("\n")

  console.log(evidence.trim())
  if (code !== 0) {
    process.exit(code ?? 1)
  }
  if (!output.includes("ekairos-lab-codex-smoke-ok")) {
    console.error("Codex smoke did not return the expected marker.")
    process.exit(1)
  }
})
