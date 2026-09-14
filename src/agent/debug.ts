export function devLog(
  scope: string,
  message: string,
  data: unknown,
  enabled: boolean,
): void {
  if (!enabled) {
    return;
  }

  let serializedData = "";
  if (data !== undefined) {
    try {
      serializedData = `\n${JSON.stringify(data, null, 2)}`;
    } catch {
      serializedData = "\n[unserializable debug data]";
    }
  }

  console.log(`[dev][${scope}] ${message}${serializedData}`);
}
