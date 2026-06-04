export const CHANNELS = {
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  googleSignIn: 'google:sign-in',
  googleSignOut: 'google:sign-out',
  googleStatus: 'google:status',
  inboxRefresh: 'inbox:refresh',
  inboxList: 'inbox:list',
  inboxGet: 'inbox:get',
  agentAnalyzeEmail: 'agent:analyze-email',
  agentChatCommand: 'agent:chat-command',
  agentRegenerate: 'agent:regenerate',
  actionApprove: 'action:approve',
  actionSendEdited: 'action:send-edited',
  actionCancel: 'action:cancel',
  logsList: 'logs:list',
  logsExport: 'logs:export',
  logsForgetContent: 'logs:forget-content',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];
