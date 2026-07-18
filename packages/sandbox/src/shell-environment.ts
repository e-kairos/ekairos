function quotePosix(value: string) {
  if (value.includes("\0")) throw new Error("sandbox_env_value_contains_null")
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function withPosixEnvironment(
  command: string,
  environment: Record<string, string> | undefined,
) {
  if (!environment || Object.keys(environment).length === 0) return command
  const assignments = Object.entries(environment).map(([key, value]) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(`sandbox_env_key_invalid:${key}`)
    }
    return `${key}=${quotePosix(value)}; export ${key}`
  })
  return `${assignments.join("; ")}; ${command}`
}
