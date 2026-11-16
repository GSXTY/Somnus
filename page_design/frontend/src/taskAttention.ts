export type PendingTaskAttention = { key: string; title: string; hash: string; failed: boolean };

type TaskAttention = {
  conversationFinished: (conversationId: string, replyId: string, status: 'complete' | 'error') => Promise<void>;
  watchAnalysis: (id: string) => Promise<void>;
  takePending: () => Promise<PendingTaskAttention[]>;
};

declare global {
  interface Window {
    somnusTaskAttention?: TaskAttention;
  }
}

export function reportConversationFinished(conversationId: string, replyId: string, status: 'complete' | 'error') {
  void window.somnusTaskAttention?.conversationFinished(conversationId, replyId, status).catch(() => {});
}

export function watchAnalysisTask(id: string) {
  void window.somnusTaskAttention?.watchAnalysis(id).catch(() => {});
}

export function linkedConversation() {
  return /^#assistant\?conversation=([a-f0-9]{32})$/.exec(window.location.hash)?.[1];
}
