import { useActionQuery } from "@agent-native/core/client/hooks";
import {
  ChatHistoryList as View,
  type ChatHistoryListProps,
} from "@agent-native/toolkit/chat-history/ChatHistoryList";

export type {
  ChatHistoryItem,
  ChatHistoryListLabels,
  ChatHistoryListProps,
  ChatHistorySection,
} from "@agent-native/toolkit/chat-history/ChatHistoryList";

function useThreadCapabilities(threadId: string, menuOpen: boolean) {
  const query = useActionQuery<{ canManage: boolean }>(
    "get-chat-thread-capabilities",
    { threadId },
    { enabled: menuOpen, staleTime: 0, refetchOnWindowFocus: "always" },
  );
  return {
    canManage: query.data?.canManage === true,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}

export function ChatHistoryList(props: ChatHistoryListProps) {
  return <View {...props} useThreadCapabilities={useThreadCapabilities} />;
}
