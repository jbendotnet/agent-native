type AccessQuery = {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  data?: { canRead: boolean; canContinue: boolean };
};

export function chatThreadAccessState(isDraft: boolean, access: AccessQuery) {
  const canRead =
    isDraft ||
    (!access.isPending && !access.isError && access.data?.canRead === true);
  const refreshing = !isDraft && access.isFetching && canRead;
  return {
    canRead,
    refreshing,
    readOnly: !isDraft && (refreshing || access.data?.canContinue !== true),
  };
}

export const CHAT_THREAD_ACCESS_DENIED_EVENT =
  "agent-chat:thread-access-denied";

export function isThreadAccessDenied(error: unknown): boolean {
  if (!(error instanceof Error) || !("status" in error)) return false;
  return error.status === 403 || error.status === 404;
}
