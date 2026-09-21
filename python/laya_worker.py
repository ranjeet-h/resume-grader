#!/usr/bin/env python3
"""JSON-lines worker that keeps one local Laya checkpoint loaded for a CLI run."""

from __future__ import annotations

import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any

os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

MODEL_REPO = "convaiinnovations/laya"
MODEL_SUBFOLDER = "typed-decisions"
MODEL_REVISION = "1c5edc17a7acd8701df6fc341c0d179f1c62c982"
MODEL_ID = f"{MODEL_REPO}:{MODEL_SUBFOLDER}@{MODEL_REVISION}"


def emit(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def encode(tokenizer: Any, text: str) -> list[int]:
    return tokenizer(text, add_special_tokens=False)["input_ids"]


def trim_tokens(tokenizer: Any, text: str, limit: int) -> tuple[str, bool]:
    token_ids = encode(tokenizer, text)
    if len(token_ids) <= limit:
        return text, False
    if limit <= 0:
        return "", True
    if limit < 16:
        return tokenizer.decode(token_ids[:limit], skip_special_tokens=True), True
    head_count = max(1, ((limit - 12) * 2) // 3)
    tail_count = max(0, limit - 12 - head_count)
    beginning = tokenizer.decode(token_ids[:head_count], skip_special_tokens=True)
    ending = tokenizer.decode(token_ids[-tail_count:], skip_special_tokens=True) if tail_count else ""
    return f"{beginning}\n[... middle omitted ...]\n{ending}", True


def build_resume_chunks(state: Any, agent: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not isinstance(state, dict):
        state = {"resumeText": str(state)}

    job = state.get("job") if isinstance(state.get("job"), dict) else {}
    candidate = state.get("candidate") if isinstance(state.get("candidate"), dict) else {}
    title = str(job.get("title") or "")
    description = str(job.get("description") or "")
    seniority = str(job.get("seniority") or "")
    resume = str(candidate.get("resumeText") or state.get("resumeText") or "")

    max_len = int(agent.cfg.get("max_len", 1024))
    head_max_len = int(agent.cfg.get("head_max_len", 256))
    state_budget = max(64, max_len - head_max_len - 40)
    job_text = "\n".join(part for part in (title, seniority, description) if part)
    job_tokens = len(encode(agent.tok, job_text))
    resume_ids = encode(agent.tok, resume)
    resume_tokens = len(resume_ids)

    # Keep complete short JDs when they fit, while reserving up to 400 tokens
    # for resume evidence. Long JDs use a head/tail excerpt to preserve both.
    max_resume_window = min(400, max(32, state_budget // 2))
    min_resume_window = min(resume_tokens, max_resume_window) if resume_tokens else 32
    low, high = 0, job_tokens
    while low < high:
        candidate_limit = (low + high + 1) // 2
        compact_candidate, _ = trim_tokens(agent.tok, job_text, candidate_limit)
        candidate_prefix = (
            f"Job requirements and context:\n{compact_candidate}\n\n"
            "Candidate resume excerpt. This is one of several overlapping excerpts; "
            "judge evidence shown here, with other excerpts evaluated separately:\n"
        )
        candidate_chunk_size = state_budget - len(encode(agent.tok, candidate_prefix)) - 20
        if candidate_chunk_size >= min_resume_window:
            low = candidate_limit
        else:
            high = candidate_limit - 1

    compact_job, job_truncated = trim_tokens(agent.tok, job_text, low)
    prefix = (
        f"Job requirements and context:\n{compact_job}\n\n"
        "Candidate resume excerpt. This is one of several overlapping excerpts; "
        "judge evidence shown here, with other excerpts evaluated separately:\n"
    )
    job_tokens_sent = len(encode(agent.tok, compact_job))
    prefix_tokens = len(encode(agent.tok, prefix))
    chunk_size = state_budget - prefix_tokens - 20
    if chunk_size < min_resume_window:
        raise ValueError("Could not reserve state budget for a resume excerpt")
    overlap = min(64, max(8, chunk_size // 8))

    def make_chunks(size: int) -> tuple[list[dict[str, Any]], int]:
        stride = max(1, size - overlap)
        windows: list[tuple[int, int]] = []
        if not resume_ids:
            windows.append((0, 0))
        else:
            start = 0
            while start < resume_tokens:
                end = min(start + size, resume_tokens)
                windows.append((start, end))
                if end == resume_tokens:
                    break
                start += stride

        chunks = []
        max_state_tokens = 0
        for index, (start, end) in enumerate(windows):
            excerpt = agent.tok.decode(resume_ids[start:end], skip_special_tokens=True)
            state_text = f"{prefix}Resume excerpt {index + 1} of {len(windows)}:\n{excerpt}"
            state_tokens = len(encode(agent.tok, state_text))
            max_state_tokens = max(max_state_tokens, state_tokens)
            previous_end = windows[index - 1][1] if index > 0 else start
            weight = end - start if index == 0 else max(0, end - previous_end)
            chunks.append(
                {
                    "state": state_text,
                    "weight": max(1, weight),
                    "metadata": {
                        "index": index + 1,
                        "startToken": start,
                        "endToken": end,
                        "stateTokensSent": state_tokens,
                    },
                }
            )
        return chunks, max_state_tokens

    chunks, max_state_tokens = make_chunks(chunk_size)
    while max_state_tokens > state_budget:
        chunk_size -= 8
        if chunk_size < 32:
            raise ValueError("Could not fit a resume excerpt inside the Laya state token budget")
        overlap = min(overlap, max(8, chunk_size // 8))
        chunks, max_state_tokens = make_chunks(chunk_size)

    chunk_details = [chunk["metadata"] for chunk in chunks]
    return chunks, {
        "jobTokensOriginal": job_tokens,
        "jobTokensSent": job_tokens_sent,
        "resumeWindowReserveTokens": min_resume_window,
        "resumeTokensOriginal": resume_tokens,
        "resumeTokensUniqueCovered": resume_tokens,
        "resumeTokensSentAcrossChunks": sum(
            detail["endToken"] - detail["startToken"] for detail in chunk_details
        ),
        "resumeChunkCount": len(chunks),
        "resumeChunkOverlapTokens": overlap if len(chunks) > 1 else 0,
        "stateTokensSent": max_state_tokens,
        "stateTokenBudget": state_budget,
        "jobTruncated": job_truncated,
        "resumeTruncated": False,
        "chunks": chunk_details,
    }


def weighted_mean(values: list[float], weights: list[int]) -> float:
    total_weight = sum(weights)
    if total_weight <= 0:
        return sum(values) / max(1, len(values))
    return sum(value * weight for value, weight in zip(values, weights)) / total_weight


def aggregate_chunk_answers(
    answers: list[dict[str, Any]], weights: list[int]
) -> dict[str, Any]:
    if len(answers) == 1:
        return answers[0]
    aggregate: dict[str, Any] = {}
    for key in answers[0]:
        entries = [answer.get(key) for answer in answers]
        first = entries[0]
        if not isinstance(first, dict) or first.get("type") not in ("score", "noul"):
            aggregate[key] = first
            continue
        combined = dict(first)
        if first["type"] == "score":
            distributions = [entry.get("probabilities") for entry in entries]
            if all(isinstance(distribution, dict) for distribution in distributions):
                labels = sorted({label for distribution in distributions for label in distribution})
                averaged = {
                    label: weighted_mean(
                        [float(distribution.get(label, 0.0)) for distribution in distributions],
                        weights,
                    )
                    for label in labels
                }
                total = sum(averaged.values())
                if total > 0:
                    averaged = {label: probability / total for label, probability in averaged.items()}
                    combined["probabilities"] = averaged
                    combined["score"] = sum(float(label) * probability for label, probability in averaged.items())
            else:
                combined["score"] = weighted_mean(
                    [float(entry["score"]) for entry in entries], weights
                )
        else:
            combined["noul"] = weighted_mean(
                [float(entry["noul"]) for entry in entries], weights
            )
        confidences = [entry.get("confidence") for entry in entries]
        if all(isinstance(confidence, (int, float)) for confidence in confidences):
            combined["confidence"] = weighted_mean(
                [float(confidence) for confidence in confidences], weights
            )
        aggregate[key] = combined
    return aggregate


def load_agent() -> tuple[Any, str]:
    import laya
    import torch
    from huggingface_hub import snapshot_download

    with redirect_stdout(sys.stderr):
        snapshot_path = snapshot_download(
            MODEL_REPO,
            revision=MODEL_REVISION,
            allow_patterns=[f"{MODEL_SUBFOLDER}/*"],
        )
        mps = getattr(torch.backends, "mps", None)
        device = "mps" if mps is not None and mps.is_available() else "cpu"
        agent = laya.load(snapshot_path, subfolder=MODEL_SUBFOLDER, device=device)
    revision = Path(snapshot_path).name
    device = str(agent.device)
    if device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("Laya reported MPS without an available PyTorch MPS backend")
    return agent, revision


def main() -> int:
    try:
        agent, revision = load_agent()
    except Exception as exc:  # noqa: BLE001 - report startup failures over the worker protocol
        emit(
            {
                "type": "startup_error",
                "error": type(exc).__name__,
                "message": f"Unable to load the pinned local model ({type(exc).__name__})",
            }
        )
        print(f"Local Laya startup failed ({type(exc).__name__})", file=sys.stderr)
        return 1

    emit(
        {
            "type": "ready",
            "model": MODEL_ID,
            "device": str(agent.device),
            "revision": revision,
        }
    )

    for raw_line in sys.stdin:
        request: Any = None
        try:
            request = json.loads(raw_line)
            if not isinstance(request, dict):
                raise ValueError("worker request must be a JSON object")
            request_id = request.get("id")
            chunks, truncation = build_resume_chunks(request.get("state"), agent)
            responses = []
            chunk_weights = []
            input_tokens = 0
            output_tokens = 0
            for chunk in chunks:
                with redirect_stdout(sys.stderr):
                    response = agent.predict(chunk["state"], request["questions"])
                responses.append(response)
                chunk_weights.append(int(chunk["weight"]))
                usage = response.get("usage") or {}
                input_tokens += int(usage.get("input_tokens", 0))
                output_tokens += int(usage.get("output_tokens", 0))
            answers = aggregate_chunk_answers(
                [response.get("answers") or {} for response in responses], chunk_weights
            )
            emit(
                {
                    "type": "result",
                    "id": request_id,
                    "model": MODEL_ID,
                    "answers": answers,
                    "usage": {
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "cost": 0,
                    },
                    "device": str(agent.device),
                    "revision": revision,
                    "truncation": truncation,
                    "chunking": {
                        "enabled": True,
                        "chunkCount": len(chunks),
                        "aggregation": "probability_mean_weighted_by_nonoverlap_resume_tokens",
                        "weights": chunk_weights,
                    },
                }
            )
        except Exception as exc:  # noqa: BLE001 - return one clear failure for this request
            print(f"Local Laya evaluation failed ({type(exc).__name__})", file=sys.stderr)
            emit(
                {
                    "type": "request_error",
                    "id": request.get("id") if isinstance(request, dict) else None,
                    "error": type(exc).__name__,
                    "message": f"Local resume evaluation failed ({type(exc).__name__})",
                }
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
