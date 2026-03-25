// anthropic-client.ts — Shared Anthropic SDK client instance.
//
// All modules that call the Claude API import from here instead of
// instantiating their own `new Anthropic()`. This avoids duplicate
// connection pools and ensures consistent configuration.

import Anthropic from "@anthropic-ai/sdk";

export const client = new Anthropic();
