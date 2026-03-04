# Design: Screen Context Injection into Groq Conversation History

**Date:** 2026-03-04

## Problem

`sendImageToGeminiHttp()` is a zero-shot call. After Gemini analyzes a screenshot, the result is saved to `screenAnalysisHistory` (a log) but never injected into `groqConversationHistory`. When the user asks a follow-up voice question, Groq has no idea what was on screen.

## Solution

After `sendImageToGeminiHttp()` assembles the full Gemini response, inject it into `groqConversationHistory` as a labeled `user` message before returning.

## Design Decisions

- **Role: `user`** — Groq API only allows one `system` message at position 0. `assistant` is semantically wrong (Groq didn't see the screen). A `user` message with a `[Screen context]:` prefix is clean and API-safe.
- **Full text, not truncated** — Gemini Flash Lite screen analysis responses are typically 100–300 words. Groq models have 128k context. Truncating adds complexity for no real benefit.
- **Silent** — No UI indicator shown to the user.
- **Existing 20-message trim applies** — No new state needed.

## Change

**File:** `src/utils/gemini.js`
**Function:** `sendImageToGeminiHttp()`

Inject after streaming loop, before `saveScreenAnalysis()`:

```js
if (fullText.trim()) {
    groqConversationHistory.push({
        role: 'user',
        content: `[Screen context]: ${fullText.trim()}`
    });
    if (groqConversationHistory.length > 20) {
        groqConversationHistory = groqConversationHistory.slice(-20);
    }
}
```

## Data Flow After Fix

```
Analyze screen → Gemini Flash Lite response
    → groqConversationHistory gets "[Screen context]: ..."
    → screenAnalysisHistory log (unchanged)
    → Next voice/text question → Groq sees screen content → informed answer
```

## Scope

- 1 file: `src/utils/gemini.js`
- ~6 lines added
- No new state, no new functions, no UI changes
