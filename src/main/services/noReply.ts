export const NO_REPLY_RISK =
  'No email reply action was created because the sender is a no-reply notification address.';

export function isNoReplyAddress(address: string | undefined): boolean {
  if (!address) return false;
  const parsedAddress = address.match(/<([^<>@\s]+@[^<>@\s]+)>/)?.[1] ?? address;
  const localPart = parsedAddress.split('@')[0]?.toLowerCase() ?? '';
  const normalized = localPart.replace(/[^a-z0-9]/g, '');
  return normalized.includes('noreply') || normalized.includes('donotreply');
}

export function noReplySendError(address: string): Error {
  return new Error(`Cannot send a reply to no-reply notification address: ${address}`);
}
