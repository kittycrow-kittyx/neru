/** Return the value of a long option in --name=value or --name value form. */
export function optionValue(args: readonly string[], name: string): string | null {
  const joined = args.find(argument => argument.startsWith(`${name}=`)) ?? null;
  if (joined) return joined.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}
