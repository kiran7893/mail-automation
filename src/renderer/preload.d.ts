import type { MailAssistantApi } from '../preload';

declare global {
  interface Window {
    mailAssistant: MailAssistantApi;
  }
}

export {};
