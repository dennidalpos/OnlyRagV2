"""Fail the frozen corpus acceptance gate unless retained independent reviews and mechanics pass."""
import hashlib
import json
from pathlib import Path
import sys


def main():
    evidence = Path(sys.argv[1]).resolve()
    names = ("corpus.json", "preparation.json", "answers.json")
    hashes = {name: hashlib.sha256((evidence / name).read_bytes()).hexdigest() for name in names}
    corpus, preparation, answers = [json.loads((evidence / name).read_text(encoding="utf-8")) for name in names]
    review = json.loads((evidence / "review.json").read_text(encoding="utf-8"))
    if review["artifact_sha256"] != hashes or preparation["corpus_sha256"] != hashes["corpus.json"] or answers["corpus_sha256"] != hashes["corpus.json"]:
        raise ValueError("Review does not match the exact frozen corpus/evidence bytes.")
    if not preparation["complete"] or not answers["complete"]:
        raise ValueError("Partial collections cannot pass acceptance.")
    if not isinstance(review.get("reviewer"), str) or not review["reviewer"].strip():
        raise ValueError("Independent reviewer identity is required.")
    expected = {item["id"] for item in corpus["queries"]}
    answer_ids = [item["id"] for item in answers["cases"]]
    review_ids = [item["id"] for item in review["cases"]]
    if len(answer_ids) != len(expected) or set(answer_ids) != expected or len(review_ids) != len(expected) or set(review_ids) != expected:
        raise ValueError("Each frozen answer case requires exactly one independent review.")
    for case in review["cases"]:
        if not isinstance(case.get("notes"), str) or not case["notes"].strip() or any(type(case.get(key)) is not bool for key in ("content_pass", "language_pass", "citations_pass")):
            raise ValueError("Explicit content/language/citation decisions and supporting notes are required.")
    live_ids = {item["id"] for item in corpus["normalization_live"]}
    normal_ids = [item["id"] for item in review["normalization_live"]]
    captured_ids = [item["id"] for item in preparation["normalization_live"]]
    if set(normal_ids) != live_ids or len(normal_ids) != len(live_ids) or set(captured_ids) != live_ids or len(captured_ids) != len(live_ids):
        raise ValueError("Every live normalization pair requires an independent review.")
    normal = {item["id"]: item for item in preparation["normalization_live"]}
    for case in review["normalization_live"]:
        has_output = bool(normal[case["id"]].get("response"))
        valid_decision = type(case.get("content_safe")) is bool if has_output else case.get("content_safe") is None
        if not valid_decision or not isinstance(case.get("notes"), str) or not case["notes"].strip():
            raise ValueError("Live normalization decisions require a content judgment and supporting notes.")
    counts = {key: sum(case[key] for case in review["cases"]) for key in ("content_pass", "language_pass", "citations_pass")}
    counts["cases"] = len(expected)
    counts["fully_accepted"] = sum(all(case[key] for key in ("content_pass", "language_pass", "citations_pass")) for case in review["cases"])
    counts["live_normalization_unassessed"] = sum(case["content_safe"] is None for case in review["normalization_live"])
    counts["live_normalization_false_acceptance"] = sum(normal[case["id"]]["accepted"] and case["content_safe"] is False for case in review["normalization_live"])
    counts["live_normalization_false_rejection"] = sum(not normal[case["id"]]["accepted"] and case["content_safe"] is True for case in review["normalization_live"])
    transport_pass = all(case["request"] is not None and not case["answer"].get("invalidSourceReferences") for case in answers["cases"])
    policy = preparation.get("normalization_policy")
    if policy is not None:
        if policy != json.loads((evidence / "normalization-policy.json").read_text(encoding="utf-8")) or policy["version"] != "whitespace-only-v1":
            raise ValueError("Captured normalization policy does not match the retained approved version.")
        guard = preparation["normalization_pairs"]
        if any(case["accepted"] != policy["expected_auto_acceptance"][case["id"]] for case in guard):
            transport_pass = False
    # Approved lexical-review refusals remain measured but are not unsafe automatic acceptance.
    rejection_pass = policy is not None or counts["live_normalization_false_rejection"] == 0
    passed = preparation["mechanical_acceptance"] and transport_pass and rejection_pass and counts["fully_accepted"] == counts["cases"] and not counts["live_normalization_unassessed"] and not counts["live_normalization_false_acceptance"]
    result = {"passed": bool(passed), "counts": counts, "artifact_sha256": hashes, "retrieval": preparation["metrics"], "reviewer": review["reviewer"],
              "normalization_policy": policy["version"] if policy else "historical-content-sequence",
              "limits": "Frozen synthetic corpus only; no restarted desktop, native OCR/Vision, broad semantics or hardware certification."}
    (evidence / "acceptance.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(result, ensure_ascii=False))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
