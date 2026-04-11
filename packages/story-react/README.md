# @ekairos/story-react

React client primitives for Ekairos story/context UIs.

## Main hook

- `useStory()`

## What it gives you

- persisted timeline + optimistic overlay
- streaming assistant updates
- optional resumable streams

## Example

```tsx
"use client";

import { useStory } from "@ekairos/story-react";

export function StoryUI({ db, apiUrl, contextId }: { db: any; apiUrl: string; contextId?: string }) {
  const story = useStory(db, {
    apiUrl,
    initialContextId: contextId,
    enableResumableStreams: true,
  });

  return (
    <button onClick={() => story.append({ parts: [{ type: "text", text: "Hola" }] })}>
      Send
    </button>
  );
}
```
