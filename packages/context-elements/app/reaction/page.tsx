import Link from "next/link";

import { ReactionTemplateClient } from "./reaction-template.client";

export default function ReactionTemplatePage() {
  return (
    <main className="container docs-shell">
      <header className="card doc-top">
        <div className="meta-row">
          <span>Ekairos Reactor</span>
          <Link className="toc-link" href="/">
            Registry landing
          </Link>
        </div>
        <h1>Causal Reaction template</h1>
        <p>
          Press the button to create an input event and run a causal chain of
          Points: compute, parallel branches, join, action, and effect.
        </p>
      </header>

      <ReactionTemplateClient />
    </main>
  );
}
