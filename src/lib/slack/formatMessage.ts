import type { GraphDiff } from "@/lib/graph/diffGraphs";
import { env } from "@/lib/env";
import type { SlackMessage } from "./client";

/**
 * Block Kit message builder (Builder pattern, plan §8.3). Composes a rich notification for
 * newly-unblocked PRs after a merge.
 */
class SlackMessageBuilder {
  private blocks: unknown[] = [];
  private fallback = "PRGraph update";

  header(text: string): this {
    this.fallback = text;
    this.blocks.push({ type: "header", text: { type: "plain_text", text } });
    return this;
  }

  section(markdown: string): this {
    this.blocks.push({ type: "section", text: { type: "mrkdwn", text: markdown } });
    return this;
  }

  context(markdown: string): this {
    this.blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: markdown }] });
    return this;
  }

  linkButton(text: string, url: string): this {
    this.blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text }, url, style: "primary" }],
    });
    return this;
  }

  build(): SlackMessage {
    return { text: this.fallback, blocks: this.blocks };
  }
}

export function buildUnblockedMessage(input: {
  fullName: string;
  diff: GraphDiff;
}): SlackMessage {
  const { fullName, diff } = input;
  const unblocked = diff.newlyUnblocked;

  const builder = new SlackMessageBuilder().header("PR Dependency Update");

  if (diff.removed.length) {
    builder.section(`✅ ${diff.removed.length} PR(s) merged/closed in *${fullName}*`);
  }

  if (unblocked.length) {
    const list = unblocked.map((c) => `• <#${c.prNumber}> ${c.title}`).join("\n");
    builder.section(`🎉 *Now safe to merge:*\n${list}`);
  } else {
    builder.context("No PRs were unblocked by this change.");
  }

  const [owner, name] = fullName.split("/");
  builder.linkButton("📊 View Dependency Graph", `${env.APP_URL}/repo/${owner}/${name}`);

  return builder.build();
}
