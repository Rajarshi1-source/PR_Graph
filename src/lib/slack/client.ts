import { WebClient } from "@slack/web-api";
import { fireSlack } from "@/lib/resilience/breakers";

export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

/** Post a Block Kit message to a channel using a per-repo bot token (behind a circuit breaker). */
export async function postMessage(
  token: string,
  channel: string,
  message: SlackMessage,
): Promise<void> {
  const client = new WebClient(token);
  await fireSlack(() =>
    client.chat.postMessage({
      channel,
      text: message.text,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blocks: message.blocks as any,
    }),
  );
}
