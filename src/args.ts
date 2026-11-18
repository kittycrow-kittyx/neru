/** Return the value of a long option in --name=value or --name value form. */
export function optionValue(args: readonly string[], name: string): string | undefined {
  const joined = args.find(argument => argument.startsWith(`${name}=`));
  if (joined) return joined.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
