/** Minimal Telegram Bot API shapes we use. */
export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
}
export interface TgChat {
  id: number;
  type: string;
}
export interface TgVoice {
  file_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  voice?: TgVoice;
  audio?: TgVoice;
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}
export type InlineButton = { text: string; callback_data: string } | { text: string; url: string };
export type InlineKeyboard = InlineButton[][];
