---
name: grill-me
description: A relentless interview to sharpen a plan or design.
disable-model-invocation: true
---

Run a `/grilling` session to pressure-test and settle a plan or design.

Do not produce a decision summary while material choices are still open, being
revisited, or awaiting the user's confirmation. Keep grilling until the
necessary decisions are resolved, then explicitly ask whether the decisions
are locked.

Only after the user confirms that the decisions are locked, finish with one
concise canonical decision record. Do not emit interim, partial, or
placeholder versions of this record.

- For a commission-feature session, title it `Commission Feature — Decisions`.
- For another subject, title it `<Feature or topic> — Decisions`.
- Include the settled decisions and the key business rules or constraints that
  follow from them. State that there are no open decisions only when that is
  actually true.
- Keep it implementation-ready so it can be passed to a prompt-refinement or
  implementation session without relying on the prior grilling chat.
