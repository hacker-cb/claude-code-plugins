import test from "node:test";
import assert from "node:assert/strict";
import { renderHouseStyle } from "../plugins/hcb-dev/lib/prefs.mjs";

test("defaults apply with an empty env, emojis on", () => {
  const out = renderHouseStyle({});
  assert.match(out, /Communicate in Russian\./);
  assert.match(out, /- Use emojis to keep chat friendly/);
  assert.match(out, /Code comments: English\./);
  assert.match(out, /Project documentation: English\./);
  assert.match(out, /GitHub \/ GitLab issues \(titles, descriptions, comments\): Russian\./);
});

test("lower-case key wins, UPPER variant is a fallback, emojis off", () => {
  const out = renderHouseStyle({
    CLAUDE_PLUGIN_OPTION_lang_chat: "Chatish", // lower-case branch
    CLAUDE_PLUGIN_OPTION_LANG_DOCS: "Docish", // upper-case fallback branch (lang_docs unset)
    CLAUDE_PLUGIN_OPTION_use_emojis: "off", // falsy → no emoji bullet
  });
  assert.match(out, /Communicate in Chatish\./);
  assert.match(out, /Project documentation: Docish\./);
  assert.match(out, /Code comments: English\./); // default branch (both unset)
  assert.doesNotMatch(out, /Use emojis/);
});
