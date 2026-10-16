# 003 · Separate output contracts from quality evidence

Status: accepted · 2026-10-16

Every provider returns a strict `{ kind, takeaways }` object. Summaries contain one
to three bounded text/evidence pairs; insufficient content contains none. Quotes
must be original source substrings. Refusal, truncation, malformed output and
invented quotes are failures. Notes are untrusted user data; prompts are versioned
code. There are no tools, retrieval, or executable output actions.

Exact quotes do not prove entailment. A frozen synthetic 12-case/40-fact evaluator
uses complete clause matching, contradiction controls and exact fact-source spans.
It rejects unknown claims and unrelated authentic quotes. Its lexical oracle is
intentionally narrow; valid live paraphrases may require human review without
changing failed automatic results.

Manual canonical fixtures validate the harness. Local extraction validates the app
contract. Actual model captures and the optional frozen judge rubric require
separate owner consent, provenance and one persistent candidate+judge budget.
Neither manual answers nor synthetic judge scores establish live model quality.
