import { WebClient } from "@slack/web-api";

export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

/** Post a Block Kit message to a channel using a per-repo bot token. */
export async function postMessage(
  token: string,
  channel: string,
  message: SlackMessage,
): Promise<void> {
  const client = new WebClient(token);
  await client.chat.postMessage({
    channel,
    text: message.text,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    blocks: message.blocks as any,
  });
}
